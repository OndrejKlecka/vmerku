import type { Store } from "@/db/schema";
import { leafletScraper } from "./leaflet";
import { rohlikScraper } from "./rohlik";
import type { Scraper } from "./types";

export * from "./types";

/**
 * Registr scraperů. Obchody se přidávají v Nastavení (sekce 2.6) – pokud jde
 * o týdenní leták, stačí zadat URL a použije se obecný `leafletScraper`.
 * Vlastní implementaci potřebují jen e-shopy.
 */
const byHost: Record<string, Scraper> = {
  "rohlik.cz": rohlikScraper,
  // rohlík.cz s čárkou (tak ho lidi píšou) – v URL je to punycode.
  "xn--rohlk-2sa.cz": rohlikScraper,
};

export function scraperFor(store: Store): Scraper {
  if (store.kind === "weekly-leaflet") return leafletScraper;

  const host = safeHost(store.sourceUrl);
  for (const [key, scraper] of Object.entries(byHost)) {
    if (host.endsWith(key)) return scraper;
  }
  throw new Error(
    `Pro obchod ${store.name} (${host}) není scraper. Přidej ho do src/lib/scrapers/index.ts.`,
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
