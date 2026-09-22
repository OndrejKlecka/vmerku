/**
 * Smlouva mezi appkou a D1.
 *
 * Na Cloudflare appka neposílá dotazy do databáze přímo – posílá je jako HTTP
 * na Worker, který je vykoná přes D1 (viz src/db/connect.ts a worker/index.ts).
 * Nejkřehčí na tom je tvar odpovědi: drizzle čeká řádky jako pole hodnot.
 *
 * D1 tady zastupuje better-sqlite3 v režimu `raw()`, který vrací řádky ve
 * stejném tvaru. Server v testu dělá přesně to, co dělá `d1Proxy` ve Workeru.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { chunksForInsert, D1_MAX_PARAMS } from "../src/db/chunks";
import { connect, schema } from "../src/db/connect";
import type { Db } from "../src/db/connect";

const { products, storeItems, stores } = schema;

let sqlite: Database.Database;
let server: http.Server;
let db: Db;
let dbFile: string;

/** Tělem je stejný kód jako v `d1Proxy` – jen nad better-sqlite3. */
function execute(sql: string, params: unknown[], method: string): { rows: unknown[] | null } {
  // Skutečné D1 odmítne dotaz s víc než 100 parametry; SQLite by ho vzalo.
  // Bez tohohle by test pustil hromadný insert, který na Cloudflare spadne.
  if (params.length > D1_MAX_PARAMS) throw new Error("too many SQL variables");
  const statement = sqlite.prepare(sql);
  if (!statement.reader) {
    statement.run(...(params as never[]));
    return { rows: [] };
  }
  const rows = statement.raw().all(...(params as never[]));
  return method === "get" ? { rows: (rows[0] as unknown[]) ?? null } : { rows };
}

before(async () => {
  dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vmerku-")), "test.db");
  sqlite = new Database(dbFile);
  sqlite.pragma("foreign_keys = ON");

  const migration = fs.readFileSync(
    path.join("drizzle", fs.readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()[0]),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) sqlite.exec(statement);
  }

  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      try {
        const { sql, params, method } = JSON.parse(body);
        // Výsledek počítáme dřív, než odejdou hlavičky; jinak by chyba z
        // dotazu přišla až po hlavičce 200 a odpověď by se nikdy neuzavřela.
        const result = execute(sql, params, method);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(500).end(String(error));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as { port: number };
  process.env.D1_PROXY_URL = `http://127.0.0.1:${port}/query`;
  db = connect();
});

after(async () => {
  delete process.env.D1_PROXY_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  sqlite.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

describe("databáze přes D1", () => {
  it("zapíše a přečte obchod", async () => {
    await db
      .insert(stores)
      .values({ name: "Lidl", kind: "weekly-leaflet", sourceUrl: "https://lidl.cz/letak.pdf" })
      .run();

    const all = await db.select().from(stores).all();
    assert.equal(all.length, 1);
    assert.equal(all[0].name, "Lidl");
    // Pravdivostní hodnoty i data jdou přes SQLite jako čísla – tohle ověřuje,
    // že je drizzle po cestě zpátky převede.
    assert.equal(all[0].active, true);
    assert.equal(all[0].lastCheckedAt, null);
  });

  it("vrátí jeden řádek pro .get()", async () => {
    const one = await db.select().from(stores).get();
    assert.equal(one?.name, "Lidl");
  });

  it("vrátí id z .returning() – na něm stojí zakládání produktu", async () => {
    const inserted = await db
      .insert(products)
      .values({ canonicalName: "Pivo Holba jedenáctka 0,5 l", addedAt: new Date() })
      .returning({ id: products.id })
      .get();
    assert.equal(typeof inserted.id, "number");

    const saved = await db.select().from(products).all();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, inserted.id);
    assert.ok(saved[0].addedAt instanceof Date);
  });

  it("umí update i delete", async () => {
    await db.update(stores).set({ active: false }).run();
    assert.equal((await db.select().from(stores).get())?.active, false);

    await db.delete(products).run();
    assert.equal((await db.select().from(products).all()).length, 0);
  });

  it("prázdný výběr vrátí prázdné pole, ne chybu", async () => {
    assert.deepEqual(await db.select().from(products).all(), []);
    assert.equal(await db.select().from(products).get(), undefined);
  });
});

describe("limit parametrů v D1", () => {
  const item = (i: number) => ({
    storeId: 1,
    rawName: `Zboží ${i}`,
    normalizedName: `zbozi ${i}`,
    price: 10 + i,
    isSale: i % 2 === 0,
    seenAt: new Date(),
  });

  before(async () => {
    await db.insert(stores).values({ name: "Kaufland", kind: "weekly-leaflet", sourceUrl: "https://k" }).run();
  });

  it("jedním příkazem se leták neuloží – přesně to se stalo na skutečném D1", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => item(i));
    const full = { ...rows[0], regularPrice: null, saleValidFrom: null, saleValidTo: null, sourceRef: null };
    await assert.rejects(
      db.insert(storeItems).values(rows.map((r) => ({ ...full, ...r }))).run(),
    );
  });

  it("po dávkách se uloží celý leták", async () => {
    await db.delete(storeItems).run();
    const rows = Array.from({ length: 400 }, (_, i) => item(i));
    for (const chunk of chunksForInsert(storeItems, rows)) {
      await db.insert(storeItems).values(chunk).run();
    }
    assert.equal((await db.select().from(storeItems).all()).length, 400);
  });

  it("dávka se vejde do limitu i při všech sloupcích tabulky", () => {
    const chunks = chunksForInsert(storeItems, Array.from({ length: 95 }, (_, i) => i));
    const columns = 11;
    assert.ok(chunks.every((c) => c.length * columns <= D1_MAX_PARAMS));
    assert.equal(chunks.flat().length, 95);
  });

  it("prázdný vstup nedá žádnou dávku", () => {
    assert.deepEqual(chunksForInsert(storeItems, []), []);
  });
});
