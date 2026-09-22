/**
 * Samostatný plánovač kontrol – `npm run worker`.
 * Běží vedle webu; na hostingu s jedním kontejnerem se místo něj použije
 * SCHEDULER_IN_PROCESS=1, viz src/instrumentation.ts.
 */
import "dotenv/config";

import { connect } from "../src/db/connect";
import { startScheduler } from "../src/lib/scheduler";

startScheduler(connect(), { checkOnStart: process.env.CHECK_ON_START !== "0" });
