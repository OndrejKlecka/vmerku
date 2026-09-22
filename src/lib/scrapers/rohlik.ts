/**
 * Rohlík.cz – e-shop, ceny se mění nezávisle na letácích (sekce 2.1).
 *
 * Katalog Rohlíku má desetitisíce položek, takže ho nestahujeme celý:
 * scraper je dotazový. Denní kontrola se ptá jen na názvy, které uživatel
 * hlídá (alias, jinak canonical_name).
 *
 * POZOR: Rohlík nemá veřejné API se zárukou stability. Primárně se používá
 * jeho interní JSON endpoint; když se rozbije, spadne se na parsování HTML.
 * Obojí je potřeba ověřit proti živému webu – viz README, sekce „Ověření
 * scraperů“.
 */
import * as cheerio from "cheerio";

import type { Db } from "@/db/connect";
import type { Store } from "@/db/schema";
import { rohlikStatus, searchRohlikMcp } from "@/lib/rohlik-mcp";

import { itemsFromJson, parsePrice } from "./rohlik-parse";
import { type ScrapedItem, type Scraper, USER_AGENT } from "./types";

const SEARCH_JSON =
  process.env.ROHLIK_SEARCH_URL ??
  "https://www.rohlik.cz/services/frontend-service/search-metadata?search={q}&offset=0&limit=25&companyId=1";

const SEARCH_HTML =
  process.env.ROHLIK_SEARCH_HTML_URL ?? "https://www.rohlik.cz/hledej?q={q}";

async function fetchText(url: string, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: { accept, "user-agent": USER_AGENT, "accept-language": "cs" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Rohlík vrátil ${res.status} pro ${url}`);
  return res.text();
}

/** Záložní cesta: vyparsuje ceny z HTML výsledků hledání. */
function itemsFromHtml(html: string): ScrapedItem[] {
  const $ = cheerio.load(html);
  const out: ScrapedItem[] = [];

  $("[data-product-id], [data-test='product-card']").each((_, el) => {
    const card = $(el);
    const name = card.find("[data-test='product-name'], h3, h4").first().text().trim();
    const priceText = card.find("[data-test='product-price'], .price").first().text();
    const price = parsePrice(priceText);
    if (!name || price == null) return;
    const regular = parsePrice(card.find("[data-test='price-before'], del, s").first().text());
    const href = card.find("a[href]").first().attr("href");
    out.push({
      rawName: name,
      price,
      regularPrice: regular,
      isSale: regular != null && regular > price,
      sourceRef: href ? new URL(href, "https://www.rohlik.cz").toString() : null,
    });
  });

  return out;
}

export const rohlikScraper: Scraper = {
  async search(_store: Store, query: string, db?: Db): Promise<ScrapedItem[]> {
    // Přednost má oficiální MCP server, pokud je v Nastavení připojený účet.
    // Když selže nebo nic nenajde, zkusí se ještě web – ať kontrola nepřijde
    // o data jen kvůli výpadku jedné cesty.
    if (db && (await rohlikStatus(db)).connected) {
      try {
        const items = await searchRohlikMcp(db, query);
        if (items.length > 0) return items;
      } catch (error) {
        console.warn(`Rohlík MCP selhal pro „${query}“, zkouším web:`, (error as Error).message);
      }
    }

    const q = encodeURIComponent(query);

    try {
      const raw = await fetchText(SEARCH_JSON.replace("{q}", q), "application/json");
      const items = itemsFromJson(JSON.parse(raw));
      if (items.length > 0) return items;
    } catch {
      // JSON endpoint se rozbil nebo změnil tvar – zkusíme HTML.
    }

    const html = await fetchText(SEARCH_HTML.replace("{q}", q), "text/html");
    return itemsFromHtml(html);
  },
};
