/**
 * Týdenní letáky kamenných řetězců (sekce 2.1).
 *
 * Postup: stáhne PDF ze `source_url`, spočítá hash (když se nezměnil, končíme),
 * vytáhne textovou vrstvu přes pdfjs a z řádků vyparsuje dvojice název + cena.
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

/** Pod touhle délkou textu považujeme PDF za obrázkové. */
const TEXT_LAYER_MIN_CHARS = 400;

type Line = { text: string; page: number };

async function extractLines(pdf: Buffer): Promise<Line[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const doc = await task.promise;

  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    // Text v PDF chodí po útržcích; seskupíme je podle svislé pozice do řádků.
    const rows = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round((item.transform[5] as number) / 4) * 4;
      const row = rows.get(y) ?? [];
      row.push({ x: item.transform[4] as number, str: item.str });
      rows.set(y, row);
    }

    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const text = rows
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((c) => c.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) lines.push({ text, page: p });
    }
    page.cleanup();
  }
  await task.destroy();
  return lines;
}

/** „24,90 Kč“, „24.90“, „19,-“ → 24.9 / 19 */
export function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[\s ]/g, "");
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

/**
 * Z řádků letáku poskládá položky.
 * Heuristika: cena se v letáku tiskne blízko názvu. Bereme text na témže
 * řádku před cenou, a když tam není, poslední smysluplný řádek nad ní.
 */
export function itemsFromLines(lines: Line[], validity: { from: Date | null; to: Date | null }): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  let lastName: string | null = null;

  for (const line of lines) {
    const m = line.text.match(PRICE_RE);
    if (!m) {
      const candidate = line.text.trim();
      // Název má mít písmena a rozumnou délku – ne čísla stránek a slogany.
      if (/[a-zá-ž]{3}/i.test(candidate) && candidate.length >= 4 && candidate.length <= 90) {
        lastName = candidate;
      }
      continue;
    }

    const price = parsePrice(m[1]);
    if (price == null) continue;

    const inline = line.text.slice(0, m.index ?? 0).trim();
    const name = /[a-zá-ž]{3}/i.test(inline) && inline.length >= 4 ? inline : lastName;
    if (!name) continue;

    // Druhá cena na řádku bývá běžná cena přeškrtnutá vedle akční.
    const rest = line.text.slice((m.index ?? 0) + m[0].length);
    const regular = rest.match(PRICE_RE) ? parsePrice(rest.match(PRICE_RE)![1]) : null;

    items.push({
      rawName: name.replace(/\s+/g, " ").trim(),
      price: regular != null && regular < price ? regular : price,
      regularPrice: regular != null && regular > price ? regular : null,
      // Všechno v letáku je akční nabídka.
      isSale: true,
      saleValidFrom: validity.from,
      saleValidTo: validity.to,
      sourceRef: `strana ${line.page}`,
    });
    lastName = null;
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

    let lines = await extractLines(pdf);
    let charCount = lines.reduce((n, l) => n + l.text.length, 0);

    if (charCount < TEXT_LAYER_MIN_CHARS) {
      const ocred = await runOcr(pdf);
      if (!ocred) {
        warnings.push(
          `${store.name}: leták nemá textovou vrstvu a není nastavené OCR_COMMAND – přeskakuji.`,
        );
        return { items: [], sourceHash, warnings };
      }
      pdf = ocred;
      lines = await extractLines(pdf);
      charCount = lines.reduce((n, l) => n + l.text.length, 0);
      warnings.push(`${store.name}: leták prošel OCR.`);
    }

    // Platnost akce bývá na titulní straně.
    const header = lines.slice(0, 40).map((l) => l.text).join(" ");
    const validity = parseValidity(header);
    if (!validity.from) {
      warnings.push(`${store.name}: v letáku se nepodařilo najít platnost akce.`);
    }

    const items = itemsFromLines(lines, validity);
    if (items.length === 0) {
      warnings.push(`${store.name}: z letáku se nepodařilo vytáhnout žádné položky.`);
    }

    return { items, sourceHash, warnings };
  },
};
