/**
 * Worker před kontejnerem – to je celé nasazení na Cloudflare.
 *
 * Kontejner je obyčejný Node proces s appkou, ale dvě věci sám neumí:
 *
 *  1. Nedosáhne na D1. Bindingy existují jen uvnitř Workeru, takže appka
 *     posílá SQL na `http://db.internal/query` a `outboundByHost` ho tady
 *     vykoná (viz src/db/connect.ts).
 *  2. Neudrží plánovač. Kontejner po nečinnosti usne, takže ho místo
 *     node-cronu budí Cron Triggery níž a volají /api/check.
 */
import { Container, getContainer, type OutboundHandler } from "@cloudflare/containers";

export type Env = {
  HLIDAC: DurableObjectNamespace<VmerkuContainer>;
  DB: D1Database;
  CHECK_TOKEN: string;
  APP_URL?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  SCRAPER_USER_AGENT?: string;
  ROHLIK_SEARCH_URL?: string;
  ROHLIK_SEARCH_HTML_URL?: string;
};

/** Appka běží v jedné instanci; historie cen je jen jedna. */
const INSTANCE = "hlidac";

/** Musí sedět s `triggers.crons` ve wrangler.jsonc (časy jsou v UTC). */
const CRON_ESHOPY = "10 4 * * *";
const CRON_LETAKY = "30 5 * * 3,6";

/**
 * Most mezi appkou v kontejneru a D1. Drizzle posílá hotové SQL i parametry
 * a čeká řádky jako pole hodnot – přesně to vrací `raw()`.
 */
const d1Proxy: OutboundHandler<Env> = async (request, env) => {
  if (request.method !== "POST") return new Response("Jen POST", { status: 405 });

  const { sql, params, method } = (await request.json()) as {
    sql: string;
    params: unknown[];
    method: "run" | "all" | "values" | "get";
  };

  const statement = env.DB.prepare(sql).bind(...params);
  if (method === "get") {
    const rows = await statement.raw();
    // Když řádek není, musí přijít null. Prázdné pole si drizzle vyloží jako
    // nalezený řádek se samými prázdnými sloupci.
    return Response.json({ rows: rows[0] ?? null });
  }
  if (method === "run") {
    await statement.run();
    return Response.json({ rows: [] });
  }
  return Response.json({ rows: await statement.raw() });
};

export class VmerkuContainer extends Container<Env> {
  defaultPort = 3000;
  // Kontejner se po půlhodině ticha uspí; probudí ho další návštěva nebo cron.
  sleepAfter = "30m";
  // Letáky i Rohlík se stahují z internetu a e-maily jdou přes SMTP.
  enableInternet = true;

  envVars = {
    NODE_ENV: "production",
    TZ: "Europe/Prague",
    // Signál pro src/db/connect.ts, že se má jít na D1 přes Worker.
    D1_PROXY_URL: "http://db.internal/query",
    // node-cron uvnitř kontejneru nemá smysl, když kontejner usíná.
    SCHEDULER_IN_PROCESS: "0",
    CHECK_TOKEN: this.env.CHECK_TOKEN ?? "",
    APP_URL: this.env.APP_URL ?? "",
    SMTP_HOST: this.env.SMTP_HOST ?? "",
    SMTP_PORT: this.env.SMTP_PORT ?? "",
    SMTP_USER: this.env.SMTP_USER ?? "",
    SMTP_PASS: this.env.SMTP_PASS ?? "",
    SMTP_FROM: this.env.SMTP_FROM ?? "",
    SCRAPER_USER_AGENT: this.env.SCRAPER_USER_AGENT ?? "",
    ROHLIK_SEARCH_URL: this.env.ROHLIK_SEARCH_URL ?? "",
    ROHLIK_SEARCH_HTML_URL: this.env.ROHLIK_SEARCH_HTML_URL ?? "",
  };
}

VmerkuContainer.outboundByHost = {
  "db.internal": d1Proxy as OutboundHandler,
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.HLIDAC, INSTANCE).fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const only = controller.cron === CRON_LETAKY ? "weekly-leaflet" : "daily-scrape";
    const response = await getContainer(env.HLIDAC, INSTANCE).fetch(
      new Request("http://container/api/check", {
        method: "POST",
        headers: { "content-type": "application/json", "x-check-token": env.CHECK_TOKEN },
        body: JSON.stringify({ only }),
      }),
    );
    // Cron nemá komu odpovědět, tak ať je aspoň v logu vidět, co se stalo.
    console.info(`kontrola ${only}: ${response.status} ${await response.text()}`);
  },
} satisfies ExportedHandler<Env>;
