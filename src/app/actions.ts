"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import {
  priceObservations,
  productStoreAliases,
  products,
  storeItems,
  stores,
  userSettings,
} from "@/db/schema";
import { matchPercent, normalize, rankCandidates } from "@/lib/match";
import { disconnectRohlik } from "@/lib/rohlik-mcp";
import { scraperFor } from "@/lib/scrapers";

export type MatchCandidate = {
  storeId: number;
  storeName: string;
  rawName: string;
  price: number;
  regularPrice: number | null;
  isSale: boolean;
  percent: number;
};

export type SearchResult = {
  query: string;
  candidates: MatchCandidate[];
  /** Obchody, kde se nic nenašlo – uživatel tam může doplnit název ručně. */
  missingStores: { id: number; name: string }[];
  warnings: string[];
};

/**
 * Vyhledá kandidáty napříč vybranými obchody (sekce 2.2 a 4.3).
 * U letáků se hledá v poslední stažené nabídce, u e-shopů se hledá živě.
 */
export async function searchCandidates(
  query: string,
  storeIds: number[],
): Promise<SearchResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { query: trimmed, candidates: [], missingStores: [], warnings: [] };
  }

  const selected = await db
    .select()
    .from(stores)
    .where(and(eq(stores.active, true), inArray(stores.id, storeIds.length ? storeIds : [-1])))
    .all();

  const candidates: MatchCandidate[] = [];
  const missingStores: { id: number; name: string }[] = [];
  const warnings: string[] = [];

  for (const store of selected) {
    let pool: { rawName: string; price: number; regularPrice: number | null; isSale: boolean }[] = [];

    try {
      if (store.kind === "weekly-leaflet") {
        const stored = await db
          .select()
          .from(storeItems)
          .where(eq(storeItems.storeId, store.id))
          .all();
        pool = stored.map((i) => ({
          rawName: i.rawName,
          price: i.price,
          regularPrice: i.regularPrice,
          isSale: i.isSale,
        }));
        if (pool.length === 0) {
          warnings.push(`${store.name}: zatím nemáme stažený leták.`);
        }
      } else {
        const scraper = scraperFor(store);
        const found = (await scraper.search?.(store, trimmed, db)) ?? [];
        pool = found.map((i) => ({
          rawName: i.rawName,
          price: i.price,
          regularPrice: i.regularPrice ?? null,
          isSale: i.isSale,
        }));
      }
    } catch (error) {
      warnings.push(`${store.name}: ${(error as Error).message}`);
      continue;
    }

    // Za obchod nabídneme pár nejlepších – obchod může mít víc balení.
    const ranked = rankCandidates(trimmed, pool, (i) => i.rawName, { threshold: 0.4, limit: 3 });
    if (ranked.length === 0) {
      missingStores.push({ id: store.id, name: store.name });
      continue;
    }

    for (const { item, score } of ranked) {
      candidates.push({
        storeId: store.id,
        storeName: store.name,
        rawName: item.rawName,
        price: item.price,
        regularPrice: item.regularPrice,
        isSale: item.isSale,
        percent: matchPercent(score),
      });
    }
  }

  candidates.sort((a, b) => b.percent - a.percent);
  return { query: trimmed, candidates, missingStores, warnings };
}

export type ConfirmedMatch = {
  storeId: number;
  rawName: string;
  price?: number | null;
  regularPrice?: number | null;
  isSale?: boolean;
};

/**
 * Založí produkt a uloží potvrzené aliasy (sekce 2.2).
 * Ceny z potvrzených položek rovnou zapíšeme jako první pozorování,
 * ať má graf od čeho začít a dashboard není prázdný.
 */
export async function addProduct(name: string, matches: ConfirmedMatch[]): Promise<void> {
  const canonicalName = name.trim();
  if (!canonicalName) throw new Error("Název produktu nesmí být prázdný.");

  const now = new Date();

  // Produkt zakládáme první; kdyby další zápis selhal, zůstane sice bez aliasů,
  // ale uživatel ho v appce uvidí a může je doplnit ručně.
  const inserted = await db
    .insert(products)
    .values({ canonicalName, addedAt: now })
    .returning({ id: products.id })
    .get();
  const productId = inserted.id;

  for (const match of matches) {
    const matchedName = match.rawName.trim();
    if (!matchedName) continue;

    await db
      .insert(productStoreAliases)
      .values({
        productId,
        storeId: match.storeId,
        matchedName,
        confidence: 1,
        confirmedByUser: true,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();

    if (match.price != null) {
      await db
        .insert(priceObservations)
        .values({
          productId,
          storeId: match.storeId,
          observedAt: now,
          price: match.price,
          regularPrice: match.regularPrice ?? null,
          isSale: match.isSale ?? false,
        })
        .run();
    }
  }

  revalidatePath("/");
  redirect(`/produkt/${productId}`);
}

export async function removeProduct(productId: number): Promise<void> {
  await db.delete(products).where(eq(products.id, productId)).run();
  revalidatePath("/");
  redirect("/");
}

export async function saveSettings(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const notifyMode = formData.get("notifyMode") === "daily-digest" ? "daily-digest" : "instant";
  const includeUnchanged = formData.get("includeUnchanged") === "on";

  await db
    .insert(userSettings)
    .values({ id: 1, email, notifyMode, includeUnchanged })
    .onConflictDoUpdate({
      target: userSettings.id,
      set: { email, notifyMode, includeUnchanged },
    })
    .run();

  revalidatePath("/nastaveni");
}

/** Zapnutí/vypnutí obchodu. Data se nemažou – jen se přestane hlídat (sekce 2.6). */
export async function setStoreActive(storeId: number, active: boolean): Promise<void> {
  await db.update(stores).set({ active }).where(eq(stores.id, storeId)).run();
  revalidatePath("/nastaveni");
  revalidatePath("/");
}

export async function addStore(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  const kind = formData.get("kind") === "daily-scrape" ? "daily-scrape" : "weekly-leaflet";
  const leafletDayRaw = String(formData.get("leafletDay") ?? "");

  if (!name || !sourceUrl) throw new Error("Vyplň název i URL zdroje.");
  new URL(sourceUrl); // rychlá validace, ať se do DB nedostane nesmysl

  const used = (await db.select().from(stores).all()).length;

  await db
    .insert(stores)
    .values({
      name,
      kind,
      sourceUrl,
      leafletDay: kind === "weekly-leaflet" && leafletDayRaw ? Number(leafletDayRaw) : null,
      active: true,
      colorIndex: used % 4,
    })
    .run();

  revalidatePath("/nastaveni");
  revalidatePath("/");
}

/** Ruční potvrzení aliasu z detailu produktu (když appka spárovala sama). */
export async function confirmAlias(aliasId: number): Promise<void> {
  await db
    .update(productStoreAliases)
    .set({ confirmedByUser: true, confidence: 1 })
    .where(eq(productStoreAliases.id, aliasId))
    .run();
  revalidatePath("/");
}

export { normalize };

/** Odpojí účet Rohlíku; smaže tokeny i registraci klienta. */
export async function disconnectRohlikAction(): Promise<void> {
  await disconnectRohlik(db);
  revalidatePath("/nastaveni");
}
