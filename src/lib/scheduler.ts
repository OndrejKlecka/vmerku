/**
 * Plán pravidelných kontrol (sekce 2.1 zadání).
 *
 * Používá ho jak samostatný worker (`npm run worker`), tak appka samotná,
 * když běží na hostingu, kde je jeden kontejner – viz SCHEDULER_IN_PROCESS.
 */
import cron from "node-cron";

import type { Db } from "@/db/connect";
import { runCheck } from "./check";

const TZ = process.env.TZ || "Europe/Prague";

export async function checkNow(db: Db, only: "daily-scrape" | "weekly-leaflet"): Promise<void> {
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

export function startScheduler(db: Db, { checkOnStart = true } = {}): void {
  // E-shopy – každé ráno.
  cron.schedule("10 6 * * *", () => void checkNow(db, "daily-scrape"), { timezone: TZ });

  // Letáky – ve středu (den vydání) a v sobotu, kdyby některý vyšel později.
  cron.schedule("30 7 * * 3,6", () => void checkNow(db, "weekly-leaflet"), { timezone: TZ });

  console.info(`Plánovač běží (${TZ}). E-shopy 6:10 denně, letáky 7:30 ve středu a v sobotu.`);

  if (checkOnStart) {
    void checkNow(db, "daily-scrape").then(() => checkNow(db, "weekly-leaflet"));
  }
}
