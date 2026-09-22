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

import type { Store } from "@/db/schema";
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

/** Z JSON odpovědi vytáhne položky. Tolerantní – tvar odpovědi se mění. */
function itemsFromJson(payload: unknown): ScrapedItem[] {
  const out: ScrapedItem[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;

    const name =
      typeof o.productName === "string"
        ? o.productName
        : typeof o.name === "string"
          ? o.name
          : null;
    const priceNode = (o.price ?? o.currentPrice ?? o.salePrice) as
      | Record<string, unknown>
      | number
      | undefined;
    const price =
      typeof priceNode === "number"
        ? priceNode
        : priceNode && typeof priceNode.amount === "number"
          ? priceNode.amount
          : null;

    if (name && typeof price === "number" && price > 0) {
      const before = (o.priceBeforeDiscount ?? o.originalPrice) as
        | Record<string, unknown>
        | number
        | undefined;
      const regular =
        typeof before === "number"
          ? before
          : before && typeof before.amount === "number"
            ? before.amount
            : null;
      out.push({
        rawName: name,
        price,
        regularPrice: regular,
        isSale: Boolean(o.sales ?? o.badge ?? (regular != null && regular > price)),
        sourceRef:
          typeof o.link === "string"
            ? new URL(o.link, "https://www.rohlik.cz").toString()
            : null,
      });
      return;
    }

    Object.values(o).forEach(visit);
  };

  visit(payload);
  return out;
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

export function parsePrice(text: string): number | null {
  const m = text.replace(/\s| /g, "").match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export const rohlikScraper: Scraper = {
  async search(_store: Store, query: string): Promise<ScrapedItem[]> {
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
