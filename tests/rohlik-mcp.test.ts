/**
 * Přihlášení a hledání přes MCP server Rohlíku – proti napodobenině.
 *
 * Skutečný server odsud není dosažitelný, a přihlášení je přitom část, kterou
 * uživatel uvidí jako první. Napodobenina dělá totéž co každý MCP server
 * s OAuth podle specifikace: popis chráněného zdroje, metadata autorizačního
 * serveru, registraci klienta, výměnu kódu i obnovu tokenu. Nástroj na hledání
 * vrací JSON v textu, jak to MCP servery běžně dělají.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";

import type { Db } from "../src/db/connect";
import * as schema from "../src/db/schema";

let server: http.Server;
let base: string;
let db: Db;
let dir: string;
let mcp: typeof import("../src/lib/rohlik-mcp");

/** Kolikrát se vydal přístupový token – aby šlo ověřit obnovu. */
let issued = 0;
let currentToken = "";
let lastAuthorizeUrl: URL | null = null;

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

function newToken() {
  issued += 1;
  currentToken = `at-${issued}`;
  return { access_token: currentToken, token_type: "Bearer", refresh_token: `rt-${issued}`, expires_in: 3600 };
}

function mcpServer() {
  const s = new McpServer({ name: "rohlik-napodobenina", version: "1" });
  s.registerTool(
    "search_recipes",
    { description: "Hledá recepty", inputSchema: { query: z.string() } },
    async () => ({ content: [{ type: "text", text: "[]" }] }),
  );
  s.registerTool(
    "search_products",
    { description: "Hledá produkty", inputSchema: { keyword: z.string(), limit: z.number().optional() } },
    async ({ keyword }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            products: [
              { id: 1, name: `${keyword} Madeta 250 g`, price: { amount: 64.9, currency: "CZK" }, originalPrice: { amount: 79.9 } },
              { id: 2, name: `${keyword} Tatra 250 g`, price: "54,90 Kč" },
            ],
          }),
        },
      ],
    }),
  );
  return s;
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const body = await readBody(req);

    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    }
    if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/register") {
      const meta = JSON.parse(body);
      return json(res, 201, { ...meta, client_id: "klient-1", client_id_issued_at: 1 });
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "authorization_code" && form.get("code") === "kod-od-rohliku") {
        assert.ok(form.get("code_verifier"), "výměna kódu musí poslat code_verifier");
        return json(res, 200, newToken());
      }
      if (form.get("grant_type") === "refresh_token") return json(res, 200, newToken());
      return json(res, 400, { error: "invalid_grant" });
    }
    if (url.pathname === "/mcp") {
      if (req.headers.authorization !== `Bearer ${currentToken}`) {
        res
          .writeHead(401, {
            "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
          })
          .end();
        return;
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const s = mcpServer();
      await s.connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      res.on("close", () => void s.close());
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  process.env.ROHLIK_MCP_URL = `${base}/mcp`;
  mcp = await import("../src/lib/rohlik-mcp");

  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vmerku-rohlik-"));
  const sqlite = new Database(path.join(dir, "t.db"));
  const local = drizzle(sqlite, { schema });
  migrate(local, { migrationsFolder: "./drizzle" });
  db = local as unknown as Db;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("přihlášení k Rohlíku", () => {
  const redirect = "https://vmerku.example/api/rohlik/navrat";

  it("bez přihlášení není připojeno", async () => {
    assert.equal((await mcp.rohlikStatus(db)).connected, false);
  });

  it("první krok vrátí přihlašovací stránku s PKCE a stavem", async () => {
    lastAuthorizeUrl = new URL(await mcp.startRohlikLogin(db, redirect));
    assert.equal(lastAuthorizeUrl.origin + lastAuthorizeUrl.pathname, `${base}/authorize`);
    assert.equal(lastAuthorizeUrl.searchParams.get("client_id"), "klient-1");
    assert.equal(lastAuthorizeUrl.searchParams.get("redirect_uri"), redirect);
    assert.equal(lastAuthorizeUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(lastAuthorizeUrl.searchParams.get("state"));
  });

  it("návrat s cizím stavem odmítne", async () => {
    await assert.rejects(mcp.finishRohlikLogin(db, "kod-od-rohliku", "podvrh"), /nesedí/);
    assert.equal((await mcp.rohlikStatus(db)).connected, false);
  });

  it("návrat s kódem uloží tokeny", async () => {
    await mcp.finishRohlikLogin(db, "kod-od-rohliku", lastAuthorizeUrl!.searchParams.get("state"));
    const status = await mcp.rohlikStatus(db);
    assert.equal(status.connected, true);
    assert.ok(status.connectedAt instanceof Date);
  });

  it("hledání vybere nástroj na produkty, ne recepty, a přečte ceny", async () => {
    const items = await mcp.searchRohlikMcp(db, "Máslo");
    assert.deepEqual(
      items.map((i) => [i.rawName, i.price, i.regularPrice, i.isSale]),
      [
        ["Máslo Madeta 250 g", 64.9, 79.9, true],
        ["Máslo Tatra 250 g", 54.9, null, false],
      ],
    );
  });

  it("když server token odmítne, appka si ho sama obnoví", async () => {
    const before = issued;
    currentToken = "zneplatněný-na-serveru";
    const items = await mcp.searchRohlikMcp(db, "Máslo");
    assert.equal(items.length, 2);
    assert.ok(issued > before, "měl se vydat nový token přes refresh_token");
  });

  it("jiný účet vynutí nové zadání přihlášení", async () => {
    const url = new URL(await mcp.startRohlikLogin(db, redirect, { fresh: true }));
    assert.equal(url.searchParams.get("prompt"), "login");
    // Předchozí tokeny se zahodily, dokud se nový účet nepřihlásí.
    assert.equal((await mcp.rohlikStatus(db)).connected, false);
  });

  it("odhlášení smaže přihlášení", async () => {
    await mcp.disconnectRohlik(db);
    assert.equal((await mcp.rohlikStatus(db)).connected, false);
    await assert.rejects(mcp.searchRohlikMcp(db, "Máslo"), /není připojený/);
  });
});

describe("výběr nástroje na hledání", () => {
  it("dá přednost search_products a najde jméno parametru", () => {
    const picked = mcp.pickSearchTool([
      { name: "search_recipes", inputSchema: { properties: { query: { type: "string" } } } },
      { name: "add_to_cart", inputSchema: { properties: { productId: { type: "number" } } } },
      { name: "search_products", inputSchema: { properties: { keyword: { type: "string" } } } },
    ]);
    assert.equal(picked?.tool.name, "search_products");
    assert.equal(picked?.argument, "keyword");
  });

  it("bez hledacího nástroje vrátí null", () => {
    assert.equal(mcp.pickSearchTool([{ name: "get_cart", inputSchema: {} }]), null);
  });
});
