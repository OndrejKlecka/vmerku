/**
 * Výchozí obsah databáze – `npm run db:seed`.
 *
 * URL letáků jsou zástupné: každý řetězec je publikuje jinde a adresy se mění,
 * takže je potřeba je ověřit a případně upravit v Nastavení. Bez ověření
 * scraper jen zahlásí chybu, nic nerozbije.
 */
import "dotenv/config";

import { connect, schema } from "../src/db/connect";

const db = connect();
const { stores, userSettings } = schema;

const SEED = [
  {
    name: "Rohlík",
    kind: "daily-scrape" as const,
    sourceUrl: "https://www.rohlik.cz",
    leafletDay: null,
  },
  {
    name: "Lidl",
    kind: "weekly-leaflet" as const,
    sourceUrl: "https://www.lidl.cz/c/letaky/s10007339",
    leafletDay: 3,
  },
  {
    name: "Kaufland",
    kind: "weekly-leaflet" as const,
    sourceUrl: "https://www.kaufland.cz/aktualni-nabidky/letaky.html",
    leafletDay: 3,
  },
  {
    name: "Billa",
    kind: "weekly-leaflet" as const,
    sourceUrl: "https://www.billa.cz/letaky",
    leafletDay: 3,
  },
  {
    name: "Albert",
    kind: "weekly-leaflet" as const,
    sourceUrl: "https://www.albert.cz/letaky",
    leafletDay: 3,
  },
];

async function main(): Promise<void> {
  const existing = await db.select().from(stores).all();
  if (existing.length > 0) {
    console.info(`Databáze už obsahuje ${existing.length} obchodů – seed přeskočen.`);
  } else {
    for (const [index, store] of SEED.entries()) {
      await db
        .insert(stores)
        .values({ ...store, active: true, colorIndex: index % 4 })
        .run();
    }
    console.info(`Založeno ${SEED.length} obchodů.`);
  }

  await db.insert(userSettings).values({ id: 1 }).onConflictDoNothing().run();
  console.info("Hotovo. URL letáků ověř a uprav v Nastavení.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
