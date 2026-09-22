/**
 * Čtení produktů z JSON odpovědí Rohlíku – sdílí ho scraper webu i klient
 * oficiálního MCP serveru. Tvar odpovědí se liší a mění, takže se nehledá
 * pevná cesta: projde se celý strom a produkt je každý objekt, který má
 * název a cenu.
 */
import type { ScrapedItem } from "./types";

export function parsePrice(text: string): number | null {
  const m = text.replace(/\s| /g, "").match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Cena může přijít jako číslo, text („29,90 Kč“) nebo objekt s částkou. */
function priceOf(node: unknown): number | null {
  if (typeof node === "number") return Number.isFinite(node) && node > 0 ? node : null;
  if (typeof node === "string") return parsePrice(node);
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    for (const key of ["amount", "full", "value", "price", "current"]) {
      const value = priceOf(o[key]);
      if (value != null) return value;
    }
  }
  return null;
}

const NAME_KEYS = ["productName", "name", "title"];
const PRICE_KEYS = ["price", "currentPrice", "salePrice", "actualPrice", "finalPrice", "priceWithVat"];
const REGULAR_KEYS = ["priceBeforeDiscount", "originalPrice", "regularPrice", "fullPrice", "oldPrice", "priceBefore"];
const SALE_KEYS = ["sales", "sale", "badge", "badges", "discount", "isSale", "inSale", "onSale", "isDiscounted"];

function first<T>(o: Record<string, unknown>, keys: string[], read: (v: unknown) => T | null): T | null {
  for (const key of keys) {
    const value = read(o[key]);
    if (value != null) return value;
  }
  return null;
}

const truthy = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : v != null && v !== false && v !== 0 && v !== "";

export function itemsFromJson(payload: unknown): ScrapedItem[] {
  const out: ScrapedItem[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;

    const name = first(o, NAME_KEYS, (v) => (typeof v === "string" && v.trim() ? v.trim() : null));
    const price = first(o, PRICE_KEYS, priceOf);

    if (name && price != null) {
      const regular = first(o, REGULAR_KEYS, priceOf);
      const link = first(o, ["link", "url", "productUrl"], (v) => (typeof v === "string" ? v : null));
      out.push({
        rawName: name,
        price,
        regularPrice: regular != null && regular > price ? regular : null,
        isSale: SALE_KEYS.some((key) => truthy(o[key])) || (regular != null && regular > price),
        sourceRef: link ? new URL(link, "https://www.rohlik.cz").toString() : null,
      });
      return;
    }

    Object.values(o).forEach(visit);
  };

  visit(payload);
  return out;
}
