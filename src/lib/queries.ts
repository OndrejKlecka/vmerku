import "server-only";

import { and, asc, desc, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { priceObservations, products, productStoreAliases, stores, userSettings } from "@/db/schema";
import type { Store } from "@/db/schema";
import { computeInsights, type Insights, type RangeKey, rangeStart, weeklyTrend } from "./insights";

/** Stav jednoho produktu v jednom obchodě – základ pro dashboard i detail. */
export type StoreState = {
  store: Store;
  price: number | null;
  regularPrice: number | null;
  isSale: boolean;
  saleValidFrom: Date | null;
  saleValidTo: Date | null;
  observedAt: Date | null;
  /** Název, pod kterým produkt v tomhle obchodě vedeme. */
  aliasName: string | null;
  aliasConfirmed: boolean;
};

export type ProductRow = {
  id: number;
  name: string;
  addedAt: Date;
  storeStates: StoreState[];
  saleCount: number;
  best: StoreState | null;
  trendPercent: number | null;
};

export function getActiveStores(): Store[] {
  return db.select().from(stores).where(eq(stores.active, true)).orderBy(asc(stores.id)).all();
}

export function getAllStores(): Store[] {
  return db.select().from(stores).orderBy(asc(stores.id)).all();
}

export function getSettings() {
  const existing = db.select().from(userSettings).where(eq(userSettings.id, 1)).get();
  if (existing) return existing;
  db.insert(userSettings).values({ id: 1 }).onConflictDoNothing().run();
  return db.select().from(userSettings).where(eq(userSettings.id, 1)).get()!;
}

/**
 * Poslední známý stav všech hlídaných produktů.
 * Pozorování se drží i pro obchody, které produkt zrovna nemají v akci –
 * dashboard i detail mají ukazovat všechny hlídané obchody (sekce 2.5).
 */
export function getProductRows(): ProductRow[] {
  const activeStores = getActiveStores();
  const allProducts = db.select().from(products).orderBy(asc(products.canonicalName)).all();
  if (allProducts.length === 0) return [];

  const aliases = db.select().from(productStoreAliases).all();
  // Pro trend potřebujeme i starší data, ne jen poslední řádek.
  const recent = db
    .select()
    .from(priceObservations)
    .where(gte(priceObservations.observedAt, rangeStart("3M")))
    .orderBy(asc(priceObservations.observedAt))
    .all();

  return allProducts.map((product) => {
    const storeStates: StoreState[] = activeStores.map((store) => {
      const forStore = recent.filter(
        (o) => o.productId === product.id && o.storeId === store.id,
      );
      const latest = forStore.at(-1) ?? lastObservation(product.id, store.id);
      const alias = aliases.find((a) => a.productId === product.id && a.storeId === store.id);

      return {
        store,
        price: latest?.price ?? null,
        regularPrice: latest?.regularPrice ?? null,
        isSale: isActiveSale(latest),
        saleValidFrom: latest?.saleValidFrom ?? null,
        saleValidTo: latest?.saleValidTo ?? null,
        observedAt: latest?.observedAt ?? null,
        aliasName: alias?.matchedName ?? null,
        aliasConfirmed: alias?.confirmedByUser ?? false,
      };
    });

    const priced = storeStates.filter((s) => s.price != null);
    const best =
      priced.length > 0
        ? priced.reduce((a, b) => ((b.price ?? Infinity) < (a.price ?? Infinity) ? b : a))
        : null;

    const bestHistory = best
      ? recent.filter((o) => o.productId === product.id && o.storeId === best.store.id)
      : [];

    return {
      id: product.id,
      name: product.canonicalName,
      addedAt: product.addedAt,
      storeStates,
      saleCount: storeStates.filter((s) => s.isSale).length,
      best,
      trendPercent: weeklyTrend(bestHistory),
    };
  });
}

export type ProductDetail = {
  id: number;
  name: string;
  addedAt: Date;
  storeStates: StoreState[];
  best: StoreState | null;
  insights: Insights;
  /** Body pro graf: jeden záznam na den, sloupec na obchod. */
  chart: { date: string; [storeName: string]: string | number | null }[];
  seriesStores: Store[];
};

export function getProductDetail(productId: number, range: RangeKey): ProductDetail | null {
  const product = db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) return null;

  const rows = getProductRows();
  const row = rows.find((r) => r.id === productId);
  const storeStates = row?.storeStates ?? [];
  const best = row?.best ?? null;

  const from = rangeStart(range);
  const observations = db
    .select()
    .from(priceObservations)
    .where(
      and(eq(priceObservations.productId, productId), gte(priceObservations.observedAt, from)),
    )
    .orderBy(asc(priceObservations.observedAt))
    .all();

  const seriesStores = storeStates
    .map((s) => s.store)
    .filter((store) => observations.some((o) => o.storeId === store.id));

  // Graf po dnech: za každý den bereme poslední cenu daného obchodu a držíme
  // poslední známou hodnotu, ať čára nemá díry mezi kontrolami.
  const byDay = new Map<string, Record<number, number>>();
  for (const o of observations) {
    const key = o.observedAt.toISOString().slice(0, 10);
    const day = byDay.get(key) ?? {};
    day[o.storeId] = o.price;
    byDay.set(key, day);
  }

  const carried: Record<number, number> = {};
  const chart = [...byDay.keys()].sort().map((date) => {
    Object.assign(carried, byDay.get(date));
    const point: { date: string; [k: string]: string | number | null } = { date };
    for (const store of seriesStores) point[store.name] = carried[store.id] ?? null;
    return point;
  });

  return {
    id: product.id,
    name: product.canonicalName,
    addedAt: product.addedAt,
    storeStates,
    best,
    insights: computeInsights(observations, best?.price ?? null),
    chart,
    seriesStores,
  };
}

function lastObservation(productId: number, storeId: number) {
  return db
    .select()
    .from(priceObservations)
    .where(and(eq(priceObservations.productId, productId), eq(priceObservations.storeId, storeId)))
    .orderBy(desc(priceObservations.observedAt))
    .limit(1)
    .get();
}

/** Akce platí, jen když jí neskončila platnost – starý leták nemá svítit zeleně. */
function isActiveSale(
  observation: { isSale: boolean; saleValidTo: Date | null } | undefined,
): boolean {
  if (!observation?.isSale) return false;
  if (!observation.saleValidTo) return true;
  const endOfDay = new Date(observation.saleValidTo);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay.getTime() >= Date.now();
}

export function getLastCheckedAt(): Date | null {
  const times = getActiveStores()
    .map((s) => s.lastCheckedAt)
    .filter((d): d is Date => d != null);
  return times.length > 0 ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
}
