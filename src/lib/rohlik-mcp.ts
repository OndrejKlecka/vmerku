/**
 * Oficiální MCP server Rohlíku (https://www.rohlik.cz/mcp-docs).
 *
 * Rohlík ho nabízí AI asistentům a vyžaduje přihlášení zákaznickým účtem
 * přes OAuth. Appka se k němu chová jako každý jiný MCP klient: jednou se
 * uživatel přihlásí (tlačítko v Nastavení), appka si tokeny uloží do
 * databáze a ranní kontrola je pak používá bez něj. Obnovu tokenů i
 * registraci klienta obstarává MCP SDK; tady je jen úložiště a hledání.
 *
 * Jak přesně se jmenuje nástroj na hledání a v jakém tvaru vrací ceny,
 * dokumentace neříká. Nástroj proto vybíráme podle jména a výsledek čteme
 * tolerantně; co server skutečně vrací, ukáže stránka Nastavení → Rohlík.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  auth,
  type OAuthClientProvider,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import type { Db } from "@/db/connect";
import { rohlikAuth, type RohlikAuth } from "@/db/schema";

import { itemsFromJson } from "./scrapers/rohlik-parse";
import type { ScrapedItem } from "./scrapers/types";

export const ROHLIK_MCP_URL = process.env.ROHLIK_MCP_URL ?? "https://mcp.rohlik.cz/mcp";

async function loadRow(db: Db): Promise<RohlikAuth | undefined> {
  return db.select().from(rohlikAuth).where(eq(rohlikAuth.id, 1)).get();
}

async function saveRow(db: Db, patch: Partial<Omit<RohlikAuth, "id">>): Promise<void> {
  await db
    .insert(rohlikAuth)
    .values({ id: 1, ...patch })
    .onConflictDoUpdate({ target: rohlikAuth.id, set: patch })
    .run();
}

const parse = <T>(json: string | null | undefined): T | undefined =>
  json ? (JSON.parse(json) as T) : undefined;

/** Úložiště OAuth stavu v tabulce rohlik_auth. */
class DbAuthProvider implements OAuthClientProvider {
  /** Kam poslat uživatele na přihlášení; vyplní SDK, když ho potřebuje. */
  authorizationUrl: URL | null = null;

  constructor(
    private readonly db: Db,
    row: RohlikAuth | undefined,
    private readonly redirect: string,
  ) {
    this.row = row ? { ...row } : undefined;
  }

  /** Aktuální stav; ukládání ho průběžně přepisuje, aby SDK hned vidělo nový token. */
  private row: Partial<RohlikAuth> | undefined;

  private remember(patch: Partial<RohlikAuth>): void {
    this.row = { ...this.row, ...patch };
  }

  get redirectUrl(): string {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "V merku – hlídač cen",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.row?.state ?? "";
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return parse(this.row?.clientInformation);
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    this.remember({ clientInformation: JSON.stringify(info) });
    await saveRow(this.db, { clientInformation: JSON.stringify(info) });
  }

  tokens(): OAuthTokens | undefined {
    return parse(this.row?.tokens);
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.remember({ tokens: JSON.stringify(tokens) });
    await saveRow(this.db, {
      tokens: JSON.stringify(tokens),
      connectedAt: new Date(),
      lastError: null,
    });
  }

  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.remember({ codeVerifier });
    await saveRow(this.db, { codeVerifier });
  }

  codeVerifier(): string {
    if (!this.row?.codeVerifier) throw new Error("Chybí ověřovací kód z přihlášení, začni znovu.");
    return this.row.codeVerifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") await saveRow(this.db, { clientInformation: null });
    if (scope === "all" || scope === "tokens") await saveRow(this.db, { tokens: null });
    if (scope === "all" || scope === "verifier") await saveRow(this.db, { codeVerifier: null });
  }
}

export type RohlikStatus = {
  connected: boolean;
  connectedAt: Date | null;
  lastError: string | null;
};

export async function rohlikStatus(db: Db): Promise<RohlikStatus> {
  const row = await loadRow(db);
  return {
    connected: Boolean(row?.tokens),
    connectedAt: row?.connectedAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

/**
 * První krok přihlášení. Vrátí adresu přihlašovací stránky Rohlíku.
 * `fresh` zahodí i registraci klienta – pro přihlášení jiným účtem.
 */
/**
 * fetch s časovým limitem pro přihlašování: bez něj by zaseknuté spojení
 * nechalo uživatele věčně koukat na točící se kolečko.
 */
const LOGIN_TIMEOUT_MS = 15_000;
async function fetchWithTimeout(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS) });
  } catch (error) {
    const reason = (error as Error).name === "TimeoutError" ? "neodpověděl do 15 s" : (error as Error).message;
    console.error(`[rohlik] ${url}: ${reason}`, error);
    throw new Error(`Server Rohlíku (${new URL(url).host}) ${reason}. Adresa: ${url}`);
  }
}

export async function startRohlikLogin(
  db: Db,
  redirectUrl: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<string> {
  const state = randomBytes(16).toString("base64url");
  const previous = await loadRow(db);
  // Registrace klienta platí jen pro stejnou návratovou adresu.
  const keepClient = !fresh && previous?.redirectUrl === redirectUrl;
  await saveRow(db, {
    redirectUrl,
    state,
    tokens: null,
    codeVerifier: null,
    clientInformation: keepClient ? previous?.clientInformation ?? null : null,
    lastError: null,
  });

  const provider = new DbAuthProvider(db, await loadRow(db), redirectUrl);
  const result = await auth(provider, { serverUrl: ROHLIK_MCP_URL, fetchFn: fetchWithTimeout });
  if (result === "AUTHORIZED") throw new Error("Rohlík přihlášení nevyžádal – zkus to znovu.");
  if (!provider.authorizationUrl) throw new Error("Rohlík nevrátil přihlašovací stránku.");

  const url = new URL(provider.authorizationUrl);
  // Bez tohohle by Rohlík tiše použil účet, na který je prohlížeč přihlášený.
  if (fresh) url.searchParams.set("prompt", "login");
  return url.toString();
}

/** Druhý krok: Rohlík vrátil uživatele s kódem, vyměníme ho za tokeny. */
export async function finishRohlikLogin(db: Db, code: string, state: string | null): Promise<void> {
  const row = await loadRow(db);
  if (!row?.state || row.state !== state) {
    throw new Error("Návrat z přihlášení nesedí s tím, co appka začala. Zkus se přihlásit znovu.");
  }
  if (!row.redirectUrl) throw new Error("Chybí návratová adresa, začni přihlášení znovu.");

  const provider = new DbAuthProvider(db, row, row.redirectUrl);
  await auth(provider, {
    serverUrl: ROHLIK_MCP_URL,
    authorizationCode: code,
    fetchFn: fetchWithTimeout,
  });
  await saveRow(db, { state: null, codeVerifier: null });
}

export async function disconnectRohlik(db: Db): Promise<void> {
  await db.delete(rohlikAuth).where(eq(rohlikAuth.id, 1)).run();
}

/** Otevře spojení s MCP serverem, nechá `fn` pracovat a zase ho zavře. */
async function withClient<T>(db: Db, fn: (client: Client) => Promise<T>): Promise<T> {
  const row = await loadRow(db);
  if (!row?.tokens || !row.redirectUrl) throw new Error("Rohlík není připojený.");

  const provider = new DbAuthProvider(db, row, row.redirectUrl);
  const transport = new StreamableHTTPClientTransport(new URL(ROHLIK_MCP_URL), {
    authProvider: provider,
  });
  const client = new Client({ name: "v-merku", version: "0.1.0" });

  try {
    await client.connect(transport);
    return await fn(client);
  } catch (error) {
    if (error instanceof UnauthorizedError || provider.authorizationUrl) {
      // Obnova tokenu selhala a server chce nové přihlášení; bez uživatele
      // ho neuděláme, tak to aspoň poznamenáme pro Nastavení.
      await saveRow(db, {
        tokens: null,
        lastError: "Přihlášení k Rohlíku vypršelo, připoj ho v Nastavení znovu.",
      });
      throw new Error("Přihlášení k Rohlíku vypršelo.");
    }
    throw error;
  } finally {
    await client.close().catch(() => undefined);
  }
}

type ToolInfo = {
  name: string;
  description?: string;
  inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] };
};

const QUERY_ARGS = ["query", "q", "search", "searchTerm", "search_term", "keyword", "keywords", "term", "text", "name"];

/** Nástroj na hledání produktů – podle jména, protože ho dokumentace neuvádí. */
export function pickSearchTool(tools: ToolInfo[]): { tool: ToolInfo; argument: string } | null {
  const score = (t: ToolInfo) => {
    const name = t.name.toLowerCase();
    if (/search/.test(name) && /product/.test(name)) return 3;
    if (/search/.test(name) && !/recipe|order|history|list/.test(name)) return 2;
    if (/product/.test(name) && /find|lookup/.test(name)) return 1;
    return 0;
  };
  const tool = [...tools].sort((a, b) => score(b) - score(a))[0];
  if (!tool || score(tool) === 0) return null;

  const props = tool.inputSchema.properties ?? {};
  const argument =
    QUERY_ARGS.find((key) => key in props) ??
    (tool.inputSchema.required ?? []).find((key) => props[key]?.type === "string") ??
    Object.keys(props).find((key) => props[key]?.type === "string");
  return argument ? { tool, argument } : null;
}

/** Co MCP server vrátil, pro diagnostiku v Nastavení. */
export type RohlikProbe = {
  tools: { name: string; description?: string }[];
  searchTool: string | null;
  raw: string;
  items: ScrapedItem[];
};

type ToolResult = {
  structuredContent?: unknown;
  content?: { type: string; text?: string }[];
  isError?: boolean;
};

/** Vytáhne z výsledku nástroje položky s cenou; ví si rady s JSON i textem. */
export function itemsFromToolResult(result: ToolResult): ScrapedItem[] {
  if (result.structuredContent) {
    const items = itemsFromJson(result.structuredContent);
    if (items.length > 0) return items;
  }
  const items: ScrapedItem[] = [];
  for (const part of result.content ?? []) {
    if (part.type !== "text" || !part.text) continue;
    try {
      items.push(...itemsFromJson(JSON.parse(part.text)));
    } catch {
      // Není to JSON – nechá se na diagnostice, jak text vypadá.
    }
  }
  return items;
}

async function searchWith(client: Client, query: string) {
  const { tools } = await client.listTools();
  const picked = pickSearchTool(tools as ToolInfo[]);
  if (!picked) return { tools, picked, result: null as ToolResult | null };
  const result = (await client.callTool({
    name: picked.tool.name,
    arguments: { [picked.argument]: query },
  })) as ToolResult;
  return { tools, picked, result };
}

export async function searchRohlikMcp(db: Db, query: string): Promise<ScrapedItem[]> {
  return withClient(db, async (client) => {
    const { picked, result } = await searchWith(client, query);
    if (!picked || !result) throw new Error("Rohlík MCP nemá nástroj na hledání produktů.");
    if (result.isError) {
      const text = result.content?.map((c) => c.text).join(" ") ?? "";
      throw new Error(`Rohlík MCP hlásí chybu: ${text.slice(0, 200)}`);
    }
    return itemsFromToolResult(result);
  });
}

export async function probeRohlikMcp(db: Db, query: string): Promise<RohlikProbe> {
  return withClient(db, async (client) => {
    const { tools, picked, result } = await searchWith(client, query);
    return {
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      searchTool: picked ? `${picked.tool.name} (${picked.argument})` : null,
      raw: result ? JSON.stringify(result, null, 2).slice(0, 8000) : "",
      items: result ? itemsFromToolResult(result) : [],
    };
  });
}
