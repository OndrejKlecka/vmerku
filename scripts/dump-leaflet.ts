/**
 * Diagnostika parsování letáku – `npm run leaflet:dump <soubor-nebo-url> [--raw]`.
 *
 * Nesahá na databázi ani nic neukládá; jen ukáže, co parser z letáku vytáhl.
 * Vznikl proto, aby šlo ověřit velký leták, který se nedá nikam nahrát:
 * pustíš ho lokálně a pošleš výpis.
 *
 *   npm run leaflet:dump ~/Downloads/lidl.pdf
 *   npm run leaflet:dump ~/Downloads/lidl.pdf --raw     # syrové řádky textové vrstvy
 *   npm run leaflet:dump https://.../letak.pdf
 */
import "dotenv/config";
import fs from "node:fs/promises";

import {
  extractCells,
  hasTextLayer,
  itemsFromCells,
  parseValidity,
} from "../src/lib/scrapers/leaflet";
import { USER_AGENT } from "../src/lib/scrapers/types";

const source = process.argv[2];
const raw = process.argv.includes("--raw");
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 40);

if (!source) {
  console.error("Použití: npm run leaflet:dump <soubor-nebo-url> [--raw] [--limit=40]");
  process.exit(1);
}

async function load(): Promise<Buffer> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, {
      headers: { "user-agent": USER_AGENT, accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`stažení selhalo: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFile(source);
}

function money(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(2)} Kč`;
}

async function main(): Promise<void> {
  const pdf = await load();
  console.log(`Soubor: ${source}`);
  const mb = pdf.length / 1024 / 1024;
  console.log(`Velikost: ${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(pdf.length / 1024)} kB`}`);

  const cells = await extractCells(pdf);
  const pages = cells.length > 0 ? Math.max(...cells.map((c) => c.page)) : 0;
  const chars = cells.reduce((n, c) => n + c.text.length, 0);

  console.log(`Stran: ${pages}`);
  console.log(`Buněk textové vrstvy: ${cells.length}`);
  console.log(`Znaků textu: ${chars}${pages > 0 ? ` (${Math.round(chars / pages)} na stránku)` : ""}`);

  if (!hasTextLayer(cells)) {
    console.log("");
    console.log("⚠  Leták nemá použitelnou textovou vrstvu – je to obrázkové PDF.");
    console.log("   Bez OCR z něj nic nevytáhneme. Nastav OCR_COMMAND, viz README.");
    return;
  }

  if (raw) {
    console.log("");
    console.log(`--- syrové buňky (prvních ${limit}) ---`);
    cells
      .slice(0, limit)
      .forEach((c, i) =>
        console.log(`${String(i).padStart(3)} [s${c.page} x=${Math.round(c.x)} y=${Math.round(c.y)}] ${c.text}`),
      );
    return;
  }

  const header = cells.slice(0, 40).map((c) => c.text).join(" ");
  const validity = parseValidity(header);
  console.log(
    `Platnost akce: ${
      validity.from && validity.to
        ? `${validity.from.toLocaleDateString("cs-CZ")} – ${validity.to.toLocaleDateString("cs-CZ")}`
        : "nenalezena (položky se uloží bez platnosti)"
    }`,
  );

  const items = itemsFromCells(cells, validity);
  console.log(`Vyparsovaných položek: ${items.length}`);
  console.log("");

  if (items.length === 0) {
    console.log("Nic se nevytáhlo. Pusť to znovu s --raw a pošli mi ten výpis.");
    return;
  }

  console.log(`--- prvních ${Math.min(limit, items.length)} položek ---`);
  for (const item of items.slice(0, limit)) {
    const regular = item.regularPrice ? ` (běžně ${money(item.regularPrice)})` : "";
    console.log(`${money(item.price).padStart(10)}${regular.padEnd(22)} ${item.sourceRef ?? ""}  ${item.rawName}`);
  }

  console.log("");
  console.log("Dává to smysl? Když jsou názvy rozsekané nebo ceny sedí k jiné položce,");
  console.log("pusť to s --raw a pošli mi výpis – heuristiku doladím.");

}

main().catch((error) => {
  console.error(String((error as Error).message ?? error));
  process.exitCode = 1;
});
