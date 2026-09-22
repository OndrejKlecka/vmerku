/**
 * Vytvoří/aktualizuje schéma databáze – `npm run db:migrate`.
 * SQL soubory generuje drizzle-kit do složky ./drizzle.
 */
import "dotenv/config";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { connect } from "../src/db/connect";

migrate(connect(), { migrationsFolder: "./drizzle" });
console.info("Schéma je aktuální.");
