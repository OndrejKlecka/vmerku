/**
 * Ruční spuštění kontroly – `npm run check [daily|leaflet]`.
 * Hodí se při ověřování scraperů proti živým datům.
 */
import "dotenv/config";

import { connect } from "../src/db/connect";
import { runCheck } from "../src/lib/check";

const arg = process.argv[2];
const only =
  arg === "daily" ? "daily-scrape" : arg === "leaflet" ? "weekly-leaflet" : undefined;

const db = connect();

runCheck(db, { only })
  .then((report) => {
    console.info("Zkontrolované obchody:", report.checkedStores.join(", ") || "žádné");
    console.info("Zapsaných pozorování:", report.observations);
    console.info("Nových akcí:", report.newSales);
    report.warnings.forEach((w) => console.warn("!", w));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
