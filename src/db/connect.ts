/**
 * Připojení k databázi. Appka umí dvě prostředí:
 *
 *  - lokálně a na běžném Node hostingu: SQLite soubor přes better-sqlite3,
 *  - na Cloudflare: D1, kam se z kontejneru nedá sáhnout přímo. Kontejner
 *    tam posílá SQL jako HTTP požadavek na `D1_PROXY_URL` a Worker ho
 *    vykoná přes svůj binding (viz worker/index.ts).
 *
 * Obojí se navenek tváří stejně: typ `Db` je asynchronní varianta. Na
 * better-sqlite3 je čekání na hotovou hodnotu prázdná operace, takže stejný
 * kód běží v obou prostředích.
 */
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleProxy, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";

export type Db = SqliteRemoteDatabase<typeof schema>;

/** Co pošleme Workeru; `method` říká, jak má výsledek vrátit. */
export type D1ProxyRequest = {
  sql: string;
  params: unknown[];
  method: "run" | "all" | "values" | "get";
};

function connectD1(endpoint: string): Db {
  return drizzleProxy(async (sql, params, method) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql, params, method } satisfies D1ProxyRequest),
    });
    if (!response.ok) {
      throw new Error(`D1 odmítla dotaz (${response.status}): ${await response.text()}`);
    }
    // Drizzle čeká řádky jako pole hodnot, ne objekty – přesně to, co vrací
    // `D1PreparedStatement.raw()`. U `get` je null „řádek nenalezen“.
    const payload = (await response.json()) as { rows: unknown[] | null };
    return { rows: payload.rows as unknown[] };
  }, { schema });
}

function connectSqlite(): Db {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "v-merku.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // better-sqlite3 je synchronní; typ hlásíme jako asynchronní, protože
  // volající na výsledek stejně čeká přes await a to na hodnotě nic nemění.
  return drizzleSqlite(sqlite, { schema }) as unknown as Db;
}

export function connect(): Db {
  const endpoint = process.env.D1_PROXY_URL;
  return endpoint ? connectD1(endpoint) : connectSqlite();
}

export { schema };
