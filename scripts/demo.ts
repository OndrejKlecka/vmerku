/**
 * Ukázková data – `npm run db:demo`.
 *
 * Slouží k vizuálnímu porovnání s wireframem (sekce 7, bod 3) a k vyzkoušení
 * grafu a insightů dřív, než se rozběhnou scrapery. Reálný provoz je nepotřebuje.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";

import { connect, schema } from "../src/db/connect";

const db = connect();
const { stores, products, productStoreAliases, priceObservations } = schema;

const DEMO = [
  {
    name: "Pivo Holba Šerák 11° 0,5 l",
    perStore: {
      Rohlík: { base: 21.9, alias: "Holba Šerák světlé výčepní 0,5 l", sale: null },
      Lidl: { base: 19.9, alias: "Pivo Holba Šerák 11° 0,5l", sale: 15.9 },
      Kaufland: { base: 20.9, alias: "Holba Šerák 11 světlé výčepní 0,5 l", sale: 16.9 },
      Billa: { base: 22.9, alias: "Holba Šerák výčepní 0,5 l", sale: null },
    },
  },
  {
    name: "Máslo Madeta 250 g",
    perStore: {
      Rohlík: { base: 64.9, alias: "Madeta Jihočeské máslo 250 g", sale: null },
      Lidl: { base: 59.9, alias: "Máslo Madeta 250g", sale: null },
      Albert: { base: 62.9, alias: "Jihočeské máslo Madeta 250 g", sale: 49.9 },
    },
  },
  {
    name: "Káva Tchibo Family 250 g",
    perStore: {
      Rohlík: { base: 89.9, alias: "Tchibo Family mletá káva 250 g", sale: null },
      Kaufland: { base: 84.9, alias: "Tchibo Family 250 g mletá", sale: null },
      Billa: { base: 87.9, alias: "Káva Tchibo Family mletá 250 g", sale: null },
    },
  },
];

const now = new Date();
const DAYS = 180;

for (const demo of DEMO) {
  const existing = db
    .select()
    .from(products)
    .where(eq(products.canonicalName, demo.name))
    .get();
  if (existing) {
    console.info(`„${demo.name}“ už existuje – přeskakuji.`);
    continue;
  }

  const addedAt = new Date(now);
  addedAt.setDate(addedAt.getDate() - DAYS);

  const product = db
    .insert(products)
    .values({ canonicalName: demo.name, addedAt })
    .returning({ id: products.id })
    .get();

  for (const [storeName, config] of Object.entries(demo.perStore)) {
    const store = db.select().from(stores).where(eq(stores.name, storeName)).get();
    if (!store) continue;

    db.insert(productStoreAliases)
      .values({
        productId: product.id,
        storeId: store.id,
        matchedName: config.alias,
        confidence: 1,
        confirmedByUser: true,
        createdAt: addedAt,
      })
      .run();

    // Historie po týdnech: běžná cena s drobným kolísáním a občasná akce.
    for (let day = DAYS; day >= 0; day -= 7) {
      const observedAt = new Date(now);
      observedAt.setDate(observedAt.getDate() - day);

      const wobble = 1 + Math.sin((day / 7) * 1.3 + storeName.length) * 0.04;
      const occasionalSale = day > 7 && day % 42 < 7;
      const price = occasionalSale
        ? Math.round(config.base * 0.78 * 10) / 10
        : Math.round(config.base * wobble * 10) / 10;

      db.insert(priceObservations)
        .values({
          productId: product.id,
          storeId: store.id,
          observedAt,
          price,
          regularPrice: occasionalSale ? config.base : null,
          isSale: occasionalSale,
        })
        .run();
    }

    // Aktuální stav – tady se rozhoduje, co dashboard ukáže jako „v akci“.
    const validFrom = new Date(now);
    validFrom.setDate(validFrom.getDate() - 2);
    const validTo = new Date(now);
    validTo.setDate(validTo.getDate() + 4);

    db.insert(priceObservations)
      .values({
        productId: product.id,
        storeId: store.id,
        observedAt: now,
        price: config.sale ?? config.base,
        regularPrice: config.sale ? config.base : null,
        isSale: config.sale != null,
        saleValidFrom: config.sale ? validFrom : null,
        saleValidTo: config.sale ? validTo : null,
      })
      .run();
  }

  console.info(`Založen ukázkový produkt „${demo.name}“.`);
}

// Ať dashboard neukazuje „zatím nekontrolováno“.
for (const store of db.select().from(stores).all()) {
  db.update(stores).set({ lastCheckedAt: now }).where(eq(stores.id, store.id)).run();
}
console.info("Hotovo.");
