/**
 * Týdenní letáky kamenných řetězců (sekce 2.1).
 *
 * Postup: stáhne PDF ze `source_url`, spočítá hash (když se nezměnil, končíme),
 * vytáhne textovou vrstvu přes pdfjs a z ní poskládá dvojice název + cena.
 *
 * Leták je mřížka dlaždic, ne text po řádcích: tři produkty vedle sebe leží
 * ve stejné výšce. Proto se text neseskupuje do řádků přes celou stránku, ale
 * do buněk – fragmenty se spojí, jen když na sebe vodorovně navazují – a název
 * se k ceně páruje podle polohy na stránce, ne podle pořadí v souboru.
 *
 * Letáky bez textové vrstvy (čistě obrázkové) potřebují OCR. Bundlovat
 * tesseract do appky je pro MVP zbytečná zátěž, takže se volá externí příkaz
 * z proměnné OCR_COMMAND (např. `ocrmypdf --force-ocr -l ces {in} {out}`).
 * Když není nastavená, scraper to nahlásí jako warning a leták přeskočí.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { Store } from "@/db/schema";
import { type ScrapedItem, type ScrapeResult, type Scraper, USER_AGENT } from "./types";

const execFileAsync = promisify(execFile);

/**
 * Pod tímhle průměrem znaků na stránku považujeme PDF za obrázkové.
 * Měří se na stránku, ne na celý soubor – dvoustránkový leták a
 * čtyřicetistránkový mají jinak úplně jiné absolutní hodnoty.
 */
export const TEXT_LAYER_MIN_CHARS_PER_PAGE = 120;

/** Jeden útržek textu i s polohou na stránce. */
export type Cell = {
  text: string;
  page: number;
  /** Levý okraj a šířka v bodech PDF. */
  x: number;
  width: number;
  /** Svislá pozice; v souřadnicích PDF roste směrem nahoru. */
  y: number;
};

/** Zpětně kompatibilní tvar pro jednosloupcový text (používají ho testy). */
export type Line = { text: string; page: number };

/**
 * Textová vrstva PDF poskládaná do buněk.
 * Exportované kvůli diagnostice `npm run leaflet:dump`.
 */
export async function extractCells(pdf: Buffer): Promise<Cell[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const doc = await task.promise;

  const cells: Cell[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageWidth = page.view[2] - page.view[0];

    // Fragmenty ve stejné výšce patří k sobě jen tehdy, když na sebe
    // vodorovně navazují. Větší mezera znamená vedlejší sloupec letáku.
    const maxGap = Math.max(10, pageWidth * 0.02);

    type Fragment = { x: number; width: number; str: string };
    const rows = new Map<number, Fragment[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round((item.transform[5] as number) / 4) * 4;
      const row = rows.get(y) ?? [];
      row.push({ x: item.transform[4] as number, width: item.width, str: item.str });
      rows.set(y, row);
    }

    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const fragments = rows.get(y)!.sort((a, b) => a.x - b.x);

      let current: Fragment[] = [];
      const flush = () => {
        if (current.length === 0) return;
        const text = current.map((f) => f.str).join(" ").replace(/\s+/g, " ").trim();
        if (text) {
          const x = current[0].x;
          const last = current[current.length - 1];
          cells.push({ text, page: p, x, width: last.x + last.width - x, y });
        }
        current = [];
      };

      for (const fragment of fragments) {
        const previous = current[current.length - 1];
        if (previous && fragment.x - (previous.x + previous.width) > maxGap) flush();
        current.push(fragment);
      }
      flush();
    }
    page.cleanup();
  }
  await task.destroy();
  return cells;
}

/** Má PDF použitelnou textovou vrstvu, nebo potřebuje OCR? */
export function hasTextLayer(cells: Pick<Cell, "text" | "page">[]): boolean {
  if (cells.length === 0) return false;
  const pages = Math.max(...cells.map((c) => c.page));
  const chars = cells.reduce((n, c) => n + c.text.length, 0);
  return chars / pages >= TEXT_LAYER_MIN_CHARS_PER_PAGE;
}

/** „24,90 Kč“, „24.90“, „19,-“ → 24.9 / 19 */
export function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[\s\u00a0]/g, "");
  const m = cleaned.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:kč|kc|czk|,-|-)?/i);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 && value < 10_000 ? value : null;
}

const PRICE_RE = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:Kč|KČ|Kc|CZK|,-)/;

/** „platí od 3. 9. do 9. 9. 2026“ nebo „3.9. – 9.9.2026“ */
export function parseValidity(
  text: string,
  reference = new Date(),
): { from: Date | null; to: Date | null } {
  const re =
    /(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*(\d{4})?\s*(?:-|–|—|do|až)\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*(\d{4})?/;
  const m = text.match(re);
  if (!m) return { from: null, to: null };

  const year = reference.getFullYear();
  const mk = (d: string, mo: string, y?: string) =>
    new Date(Number(y ?? year), Number(mo) - 1, Number(d));

  const from = mk(m[1], m[2], m[3]);
  const to = mk(m[4], m[5], m[6] ?? m[3]);
  // Přelom roku: leták z prosince platící do ledna
  if (to < from) to.setFullYear(to.getFullYear() + 1);
  return { from, to };
}

/** Text vypadá jako název produktu, ne jako číslo stránky nebo slogan. */
function looksLikeName(text: string): boolean {
  return /[a-zá-ž]{3}/i.test(text) && text.length >= 4 && text.length <= 90;
}

/** Nejvyšší svislá vzdálenost mezi cenou a názvem, který k ní ještě patří. */
const MAX_PAIR_DISTANCE = 160;

/** Překrývají se buňky vodorovně natolik, že patří do stejného sloupce? */
function sameColumn(a: Cell, b: Cell): boolean {
  const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  if (overlap > 0) return true;
  const centerA = a.x + a.width / 2;
  const centerB = b.x + b.width / 2;
  return Math.abs(centerA - centerB) < 40;
}

type Pairing = { name: Cell; prices: { cell: Cell; value: number }[] };

/**
 * Z buněk poskládá položky letáku.
 *
 * Buňka, která obsahuje název i cenu, se vyřídí rovnou. Samostatná cena se
 * spáruje s nejbližším názvem ve stejném sloupci. Když k jednomu názvu patří
 * dvě ceny, nižší je akční a vyšší běžná.
 */
export function itemsFromCells(
  cells: Cell[],
  validity: { from: Date | null; to: Date | null },
): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  const priceCells: { cell: Cell; value: number }[] = [];
  const nameCells: Cell[] = [];

  for (const cell of cells) {
    const match = cell.text.match(PRICE_RE);
    if (!match) {
      if (looksLikeName(cell.text)) nameCells.push(cell);
      continue;
    }

    const value = parsePrice(match[1]);
    if (value == null) continue;

    const before = cell.text.slice(0, match.index ?? 0).trim();
    if (looksLikeName(before)) {
      // Název i cena v jedné buňce – druhá cena za ní bývá ta běžná.
      const rest = cell.text.slice((match.index ?? 0) + match[0].length);
      const restMatch = rest.match(PRICE_RE);
      const regular = restMatch ? parsePrice(restMatch[1]) : null;
      items.push(
        buildItem(before, [value, regular].filter((v): v is number => v != null), cell, validity),
      );
      continue;
    }

    priceCells.push({ cell, value });
  }

  // Každou samostatnou cenu přiřadíme k nejbližšímu názvu ve stejném sloupci.
  const pairings = new Map<Cell, Pairing>();
  for (const price of priceCells) {
    let best: Cell | null = null;
    let bestDistance = Infinity;

    for (const name of nameCells) {
      if (name.page !== price.cell.page || !sameColumn(name, price.cell)) continue;
      const distance = Math.abs(name.y - price.cell.y);
      // Při shodné vzdálenosti dáme přednost názvu nad cenou, jak bývá v letáku.
      const weighted = name.y > price.cell.y ? distance : distance * 1.2;
      if (weighted < bestDistance) {
        bestDistance = weighted;
        best = name;
      }
    }

    if (!best || bestDistance > MAX_PAIR_DISTANCE) continue;
    const pairing = pairings.get(best) ?? { name: best, prices: [] };
    pairing.prices.push(price);
    pairings.set(best, pairing);
  }

  for (const pairing of pairings.values()) {
    items.push(
      buildItem(
        pairing.name.text,
        pairing.prices.map((p) => p.value),
        pairing.name,
        validity,
      ),
    );
  }

  // Tentýž název se v letáku opakuje (přehled + detail) – necháme nejnižší cenu.
  const byName = new Map<string, ScrapedItem>();
  for (const item of items) {
    const key = item.rawName.toLowerCase();
    const seen = byName.get(key);
    if (!seen || item.price < seen.price) byName.set(key, item);
  }
  return [...byName.values()];
}

function buildItem(
  rawName: string,
  prices: number[],
  source: Cell,
  validity: { from: Date | null; to: Date | null },
): ScrapedItem {
  const price = Math.min(...prices);
  const highest = Math.max(...prices);
  return {
    rawName: rawName.replace(/\s+/g, " ").trim(),
    price,
    regularPrice: highest > price ? highest : null,
    // Všechno v letáku je akční nabídka.
    isSale: true,
    saleValidFrom: validity.from,
    saleValidTo: validity.to,
    sourceRef: `strana ${source.page}`,
  };
}

/**
 * Jednosloupcová varianta – buňky se odvodí z pořadí řádků.
 * Používá ji testovací sada a zdroje, kde poloha není k dispozici.
 */
export function itemsFromLines(
  lines: Line[],
  validity: { from: Date | null; to: Date | null },
): ScrapedItem[] {
  const cells: Cell[] = lines.map((line, index) => ({
    text: line.text,
    page: line.page,
    x: 0,
    width: 1000,
    y: (lines.length - index) * 20,
  }));
  return itemsFromCells(cells, validity);
}

async function runOcr(pdf: Buffer): Promise<Buffer | null> {
  const command = process.env.OCR_COMMAND;
  if (!command) return null;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vm-ocr-"));
  const input = path.join(dir, "in.pdf");
  const output = path.join(dir, "out.pdf");
  try {
    await fs.writeFile(input, pdf);
    const [bin, ...args] = command
      .replace("{in}", input)
      .replace("{out}", output)
      .split(/\s+/);
    await execFileAsync(bin, args, { timeout: 180_000 });
    return await fs.readFile(output);
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export const leafletScraper: Scraper = {
  async snapshot(store: Store): Promise<ScrapeResult> {
    const warnings: string[] = [];

    const res = await fetch(store.sourceUrl, {
      headers: { "user-agent": USER_AGENT, accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${store.name}: leták vrátil ${res.status}`);

    let pdf: Buffer = Buffer.from(await res.arrayBuffer());
    const sourceHash = crypto.createHash("sha256").update(pdf).digest("hex");

    // Stejný soubor jako minule – leták ještě nevyšel.
    if (sourceHash === store.lastSourceHash) {
      return { items: [], sourceHash, warnings: ["Leták se od poslední kontroly nezměnil."] };
    }

    let cells = await extractCells(pdf);

    if (!hasTextLayer(cells)) {
      const ocred = await runOcr(pdf);
      if (!ocred) {
        warnings.push(
          `${store.name}: leták nemá textovou vrstvu a není nastavené OCR_COMMAND – přeskakuji.`,
        );
        return { items: [], sourceHash, warnings };
      }
      pdf = ocred;
      cells = await extractCells(pdf);
      warnings.push(`${store.name}: leták prošel OCR.`);
    }

    // Platnost akce bývá na titulní straně.
    const header = cells.slice(0, 40).map((c) => c.text).join(" ");
    const validity = parseValidity(header);
    if (!validity.from) {
      warnings.push(`${store.name}: v letáku se nepodařilo najít platnost akce.`);
    }

    const items = itemsFromCells(cells, validity);
    if (items.length === 0) {
      warnings.push(`${store.name}: z letáku se nepodařilo vytáhnout žádné položky.`);
    }

    return { items, sourceHash, warnings };
  },
};
