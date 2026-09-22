/**
 * Stejné připojení jako src/db/index.ts, ale bez `server-only` –
 * pro skripty spouštěné mimo Next (worker, seed, ruční kontrola).
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";

export function connect() {
  const dbPath =
    process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "v-merku.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof connect>;
export { schema };
