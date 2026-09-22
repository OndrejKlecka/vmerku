import type { Store } from "@/db/schema";

/** Jedna položka tak, jak ji vidí obchod – ještě před spárováním na produkt. */
export type ScrapedItem = {
  rawName: string;
  price: number;
  /** Běžná cena, pokud ji zdroj uvádí vedle akční. */
  regularPrice?: number | null;
  isSale: boolean;
  saleValidFrom?: Date | null;
  saleValidTo?: Date | null;
  /** URL produktu nebo „strana 4“ – ať se dá dohledat, odkud údaj je. */
  sourceRef?: string | null;
};

export type ScrapeResult = {
  items: ScrapedItem[];
  /** Hash zdroje (PDF). Když se nezměnil, nemusíme nic přepisovat. */
  sourceHash?: string | null;
  /** Nefatální poznámky – zobrazí se v logu kontroly. */
  warnings: string[];
};

export interface Scraper {
  /** Stáhne celou aktuální nabídku (týdenní leták). */
  snapshot?(store: Store): Promise<ScrapeResult>;
  /** Vyhledá konkrétní dotaz (e-shop, kde nemá smysl stahovat celý katalog). */
  search?(store: Store, query: string): Promise<ScrapedItem[]>;
}

export const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  "Mozilla/5.0 (compatible; v-merku/0.1; osobní hlídač cen)";
