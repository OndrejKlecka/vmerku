/**
 * D1 unese v jednom dotazu nejvýš 100 vázaných parametrů. Hromadný insert
 * s položkami letáku (stovky řádků po jedenácti sloupcích) by jinak spadl
 * už na jedenáctém řádku. Rozdělujeme proto řádky na dávky, které se do
 * limitu vejdou; na SQLite souboru to nevadí.
 */
import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

export const D1_MAX_PARAMS = 100;

export function chunksForInsert<T>(table: SQLiteTable, rows: T[]): T[][] {
  // Počítáme se všemi sloupci tabulky, ne jen s vyplněnými: kdyby drizzle
  // někdy vázal i výchozí hodnoty, dávka se pořád vejde.
  const perRow = Object.keys(getTableColumns(table)).length;
  const size = Math.max(1, Math.floor(D1_MAX_PARAMS / perRow));

  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}
