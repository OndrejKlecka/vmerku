/**
 * Vytvoří/aktualizuje schéma lokální SQLite databáze – `npm run db:migrate`.
 * SQL soubory generuje drizzle-kit do složky ./drizzle.
 *
 * Na Cloudflare tenhle skript nepoužívej: tam schéma zavádí
 * `wrangler d1 migrations apply` ze stejných SQL souborů (viz
 * .github/workflows/deploy.yml).
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";

import * as schema from "../src/db/schema";

const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "v-merku.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

migrate(drizzle(new Database(dbPath), { schema }), { migrationsFolder: "./drizzle" });
console.info("Schéma je aktuální.");
