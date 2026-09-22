/**
 * Jedna kontrola cen: stáhne data z obchodů, spáruje je na hlídané produkty,
 * zapíše pozorování a pošle notifikace o nových akcích (sekce 2.1–2.4).
 *
 * Běží mimo Next (worker, CLI), takže si bere DB přes `connect()`.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { chunksForInsert } from "@/db/chunks";
import { type Db, schema } from "@/db/connect";
import type { Store } from "@/db/schema";
import { rangeStart } from "./insights";
import { normalize, rankCandidates, similarity } from "./match";
import { buildSaleMail, type SaleAlert, sendMail } from "./notify";
import { scraperFor, type ScrapedItem } from "./scrapers";

const { stores, products, productStoreAliases, priceObservations, notificationLog, storeItems, userSettings } =
  schema;

/** Nad tímhle skóre se shoda přijme sama, bez potvrzení uživatelem. */
const AUTO_MATCH_THRESHOLD = 0.82;

export type CheckReport = {
  checkedStores: string[];
  observations: number;
  newSales: number;
  warnings: string[];
};

export async function runCheck(
  db: Db,
  { only, now = new Date() }: { only?: Store["kind"]; now?: Date } = {},
): Promise<CheckReport> {
  const report: CheckReport = { checkedStores: [], observations: 0, newSales: 0, warnings: [] };

  const activeStores = (await db.select().from(stores).where(eq(stores.active, true)).all())
    .filter((s) => !only || s.kind === only);

  const watched = await db.select().from(products).all();
  if (watched.length === 0) return report;

  const alerts: SaleAlert[] = [];

  for (const store of activeStores) {
    try {
      const items = await collectStoreItems(db, store, watched, now, report);
      report.checkedStores.push(store.name);

      for (const product of watched) {
        const match = await pickMatch(db, product.id, store.id, items);
        if (!match) continue;

        await recordObservation(db, product.id, store.id, match, now);
        report.observations++;

        const alert = await maybeAlert(db, product.id, product.canonicalName, store, match, now);
        if (alert) {
          alerts.push(alert);
          report.newSales++;
        }
      }

      await db.update(stores).set({ lastCheckedAt: now }).where(eq(stores.id, store.id)).run();
    } catch (error) {
      report.warnings.push(`${store.name}: ${(error as Error).message}`);
    }
  }

  await dispatchAlerts(db, alerts, now);
  return report;
}

/**
 * Získá aktuální nabídku obchodu a uloží ji do `store_items`.
 * Letáky se stahují celé, e-shopy se ptají jen na hlídané názvy.
 */
async function collectStoreItems(
  db: Db,
  store: Store,
  watched: { id: number; canonicalName: string }[],
  now: Date,
  report: CheckReport,
): Promise<ScrapedItem[]> {
  const scraper = scraperFor(store);

  if (store.kind === "weekly-leaflet") {
    if (!scraper.snapshot) throw new Error("scraper neumí stáhnout leták");
    const result = await scraper.snapshot(store);
    report.warnings.push(...result.warnings);

    if (result.sourceHash && result.sourceHash === store.lastSourceHash) {
      // Leták se nezměnil – použijeme, co máme uložené z minula.
      const stored = await db.select().from(storeItems).where(eq(storeItems.storeId, store.id)).all();
      return stored.map(toScraped);
    }

    if (result.items.length > 0) {
      await replaceStoreItems(db, store.id, result.items, now);
      await db
        .update(stores)
        .set({ lastSourceHash: result.sourceHash })
        .where(eq(stores.id, store.id))
        .run();
    }
    return result.items;
  }

  if (!scraper.search) throw new Error("scraper neumí vyhledávat");

  // Hledáme pod aliasem, pokud ho pro tenhle obchod známe – trefí to přesněji.
  const aliases = await db
    .select()
    .from(productStoreAliases)
    .where(
      and(
        eq(productStoreAliases.storeId, store.id),
        inArray(productStoreAliases.productId, watched.map((p) => p.id)),
      ),
    )
    .all();

  const queries = new Set<string>();
  for (const product of watched) {
    const alias = aliases.find((a) => a.productId === product.id);
    queries.add(alias?.matchedName ?? product.canonicalName);
  }

  const found: ScrapedItem[] = [];
  for (const query of queries) {
    try {
      found.push(...(await scraper.search(store, query, db)));
    } catch (error) {
      report.warnings.push(`${store.name} / „${query}“: ${(error as Error).message}`);
    }
  }

  if (found.length > 0) await replaceStoreItems(db, store.id, found, now);
  return found;
}

async function replaceStoreItems(
  db: Db,
  storeId: number,
  items: ScrapedItem[],
  now: Date,
): Promise<void> {
  await db.delete(storeItems).where(eq(storeItems.storeId, storeId)).run();

  const rows = items.map((item) => ({
    storeId,
    rawName: item.rawName,
    normalizedName: normalize(item.rawName),
    price: item.price,
    regularPrice: item.regularPrice ?? null,
    isSale: item.isSale,
    saleValidFrom: item.saleValidFrom ?? null,
    saleValidTo: item.saleValidTo ?? null,
    seenAt: now,
    sourceRef: item.sourceRef ?? null,
  }));

  // Po dávkách kvůli limitu parametrů v D1 (viz src/db/chunks.ts). Snapshot
  // obchodu se při každé kontrole přepíše celý, takže přerušení uprostřed
  // nic trvalého nepoškodí.
  for (const chunk of chunksForInsert(storeItems, rows)) {
    await db.insert(storeItems).values(chunk).run();
  }
}

function toScraped(row: typeof storeItems.$inferSelect): ScrapedItem {
  return {
    rawName: row.rawName,
    price: row.price,
    regularPrice: row.regularPrice,
    isSale: row.isSale,
    saleValidFrom: row.saleValidFrom,
    saleValidTo: row.saleValidTo,
    sourceRef: row.sourceRef,
  };
}

/**
 * Vybere položku odpovídající produktu.
 * Přednost má potvrzený alias (sekce 2.2); bez něj se sáhne po velmi silné
 * shodě, aby appka fungovala i u obchodů, kde uživatel zatím nic nepotvrdil.
 */
async function pickMatch(
  db: Db,
  productId: number,
  storeId: number,
  items: ScrapedItem[],
): Promise<ScrapedItem | null> {
  if (items.length === 0) return null;

  const aliases = await db
    .select()
    .from(productStoreAliases)
    .where(and(eq(productStoreAliases.productId, productId), eq(productStoreAliases.storeId, storeId)))
    .all();

  for (const alias of aliases) {
    const key = normalize(alias.matchedName);
    const exact = items.find((i) => normalize(i.rawName) === key);
    if (exact) return exact;

    // Obchod mohl název mírně přepsat – držíme se blízkého okolí aliasu.
    const near = rankCandidates(alias.matchedName, items, (i) => i.rawName, {
      threshold: 0.75,
      limit: 1,
    });
    if (near.length > 0) return near[0].item;
  }

  if (aliases.length > 0) return null;

  const product = await db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) return null;

  const best = rankCandidates(product.canonicalName, items, (i) => i.rawName, {
    threshold: AUTO_MATCH_THRESHOLD,
    limit: 1,
  });
  if (best.length === 0) return null;

  // Automatickou shodu si zapíšeme jako nepotvrzený alias – uživatel ji uvidí
  // v detailu produktu a může ji zrušit.
  await db
    .insert(productStoreAliases)
    .values({
      productId,
      storeId,
      matchedName: best[0].item.rawName,
      confidence: best[0].score,
      confirmedByUser: false,
    })
    .onConflictDoNothing()
    .run();

  return best[0].item;
}

async function recordObservation(
  db: Db,
  productId: number,
  storeId: number,
  item: ScrapedItem,
  now: Date,
): Promise<void> {
  const last = await db
    .select()
    .from(priceObservations)
    .where(
      and(eq(priceObservations.productId, productId), eq(priceObservations.storeId, storeId)),
    )
    .orderBy(desc(priceObservations.observedAt))
    .limit(1)
    .get();

  // Beze změny zapisujeme nejvýš jednou denně – historie má být čitelná, ne hustá.
  if (last && last.price === item.price && last.isSale === item.isSale) {
    const sameDay = last.observedAt.toDateString() === now.toDateString();
    if (sameDay) return;
  }

  await db
    .insert(priceObservations)
    .values({
      productId,
      storeId,
      observedAt: now,
      price: item.price,
      regularPrice: item.regularPrice ?? null,
      isSale: item.isSale,
      saleValidFrom: item.saleValidFrom ?? null,
      saleValidTo: item.saleValidTo ?? null,
    })
    .run();
}

/**
 * Vrátí upozornění, jen když položka do akce *nově* spadla a za tuhle akci
 * jsme ještě nepsali (sekce 2.4 – deduplikace přes NotificationLog).
 */
async function maybeAlert(
  db: Db,
  productId: number,
  productName: string,
  store: Store,
  item: ScrapedItem,
  now: Date,
): Promise<SaleAlert | null> {
  if (!item.isSale) return null;

  // Klíč akce: buď její vyhlášený začátek, nebo den, kdy jsme ji poprvé viděli.
  const windowStart = item.saleValidFrom ?? startOfDay(now);

  const already = await db
    .select()
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.productId, productId),
        eq(notificationLog.storeId, store.id),
        eq(notificationLog.saleWindowStart, windowStart),
      ),
    )
    .get();
  if (already) return null;

  const halfYear = await db
    .select()
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        gte(priceObservations.observedAt, rangeStart("6M", now)),
      ),
    )
    .all();
  const lowest = halfYear.length > 0 ? Math.min(...halfYear.map((o) => o.price)) : item.price;

  return {
    productId,
    productName,
    storeId: store.id,
    storeName: store.name,
    saleWindowStart: windowStart,
    price: item.price,
    regularPrice: item.regularPrice ?? null,
    validTo: item.saleValidTo ?? null,
    isLowestIn6M: item.price <= lowest + 0.001,
  };
}

/** Rozešle upozornění podle režimu v Nastavení (okamžitě / denní souhrn). */
async function dispatchAlerts(db: Db, alerts: SaleAlert[], now: Date): Promise<void> {
  if (alerts.length === 0) return;

  const settings = await db.select().from(userSettings).where(eq(userSettings.id, 1)).get();
  if (!settings?.email) {
    console.info("[mail] není nastavená adresa – upozornění se neodesílají.");
    return;
  }

  if (settings.notifyMode === "daily-digest") {
    // Souhrn chodí nejvýš jednou za 20 hodin. Do té doby se do logu nic
    // nezapisuje, takže se akce připomene při další kontrole a nezmizí.
    const last = settings.lastDigestAt?.getTime() ?? 0;
    if (now.getTime() - last < 20 * 3600 * 1000) return;
  }

  await sendMail(settings.email, buildSaleMail(alerts));

  // Do logu zapisujeme až po odeslání – jinak by se při chybě e-mail ztratil.
  for (const alert of alerts) {
    await db
      .insert(notificationLog)
      .values({
        productId: alert.productId,
        storeId: alert.storeId,
        saleWindowStart: alert.saleWindowStart,
        sentAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  if (settings.notifyMode === "daily-digest") {
    await db.update(userSettings).set({ lastDigestAt: now }).where(eq(userSettings.id, 1)).run();
  }
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export { AUTO_MATCH_THRESHOLD, similarity };
