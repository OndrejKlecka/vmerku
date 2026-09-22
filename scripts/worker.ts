/**
 * Plánovač kontrol (sekce 7, bod 7).
 *
 * Běží jako samostatný proces vedle Next.js – `npm run worker`.
 * Frekvence podle sekce 2.1: Rohlík denně, letáky dvakrát týdně.
 */
import "dotenv/config";
import cron from "node-cron";

import { connect } from "../src/db/connect";
import { runCheck } from "../src/lib/check";

const TZ = process.env.TZ ?? "Europe/Prague";
const db = connect();

async function check(only: "daily-scrape" | "weekly-leaflet"): Promise<void> {
  const label = only === "daily-scrape" ? "e-shopy" : "letáky";
  console.info(`[${new Date().toISOString()}] kontrola – ${label}`);
  try {
    const report = await runCheck(db, { only });
    console.info(
      `  obchody: ${report.checkedStores.join(", ") || "žádné"} · ` +
        `pozorování: ${report.observations} · nové akce: ${report.newSales}`,
    );
    report.warnings.forEach((w) => console.warn(`  ! ${w}`));
  } catch (error) {
    console.error("  selhalo:", error);
  }
}

// Rohlík a další e-shopy – každé ráno v 6:10.
cron.schedule("10 6 * * *", () => void check("daily-scrape"), { timezone: TZ });

// Letáky – ve středu (den vydání) a v sobotu, kdyby některý vyšel později.
cron.schedule("30 7 * * 3,6", () => void check("weekly-leaflet"), { timezone: TZ });

console.info(`Plánovač běží (${TZ}). E-shopy 6:10 denně, letáky 7:30 ve středu a v sobotu.`);

// Při startu zkontrolujeme hned, ať se nečeká na první cron.
if (process.env.CHECK_ON_START !== "0") {
  void check("daily-scrape").then(() => check("weekly-leaflet"));
}
