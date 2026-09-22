import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Obchod, který hlídáme. `kind` určuje, jakým scraperem se sbírají data (sekce 2.1 zadání). */
export const stores = sqliteTable("stores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** 'daily-scrape' = e-shop (Rohlík), 'weekly-leaflet' = týdenní PDF leták */
  kind: text("kind", { enum: ["daily-scrape", "weekly-leaflet"] }).notNull(),
  sourceUrl: text("source_url").notNull(),
  /** 0 = neděle … 3 = středa. Jen u 'weekly-leaflet' – den, kdy typicky vychází leták. */
  leafletDay: integer("leaflet_day"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /** Barva čáry v grafu (viz --series-1..4). Přiřazuje se při založení obchodu. */
  colorIndex: integer("color_index").notNull().default(0),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
  /** Hash posledního staženého letáku – ať nezpracováváme dvakrát tentýž soubor. */
  lastSourceHash: text("last_source_hash"),
});

/** Produkt, který uživatel hlídá. `canonicalName` je jeho vlastní pojmenování. */
export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  canonicalName: text("canonical_name").notNull(),
  addedAt: integer("added_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Potvrzený slovník aliasů – „tenhle produkt se v tomhle obchodě jmenuje takhle“.
 * Tohle je to „učení“ ze sekce 2.2: roste potvrzováním od uživatele, netrénuje se.
 */
export const productStoreAliases = sqliteTable(
  "product_store_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    matchedName: text("matched_name").notNull(),
    confidence: real("confidence").notNull(),
    confirmedByUser: integer("confirmed_by_user", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("alias_product_store_name").on(
      t.productId,
      t.storeId,
      t.matchedName,
    ),
  ],
);

/** Jeden záznam o ceně: co, kde, kdy, za kolik a jestli to byla akce (sekce 2.3). */
export const priceObservations = sqliteTable(
  "price_observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    observedAt: integer("observed_at", { mode: "timestamp" }).notNull(),
    price: real("price").notNull(),
    /** Běžná cena, pokud ji zdroj uvádí vedle akční – jinak null. */
    regularPrice: real("regular_price"),
    isSale: integer("is_sale", { mode: "boolean" }).notNull().default(false),
    saleValidFrom: integer("sale_valid_from", { mode: "timestamp" }),
    saleValidTo: integer("sale_valid_to", { mode: "timestamp" }),
  },
  (t) => [index("obs_product_store_time").on(t.productId, t.storeId, t.observedAt)],
);

/** Deduplikace notifikací – jedna akce = jeden e-mail (sekce 2.4). */
export const notificationLog = sqliteTable(
  "notification_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** Začátek akce – klíč, podle kterého poznáme, že jde o tutéž akci. */
    saleWindowStart: integer("sale_window_start", { mode: "timestamp" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("notif_product_store_window").on(
      t.productId,
      t.storeId,
      t.saleWindowStart,
    ),
  ],
);

/** Nastavení – jeden řádek, appka je jednouživatelská (sekce 1). */
export const userSettings = sqliteTable("user_settings", {
  id: integer("id").primaryKey().default(1),
  email: text("email").notNull().default(""),
  notifyMode: text("notify_mode", { enum: ["instant", "daily-digest"] })
    .notNull()
    .default("instant"),
  includeUnchanged: integer("include_unchanged", { mode: "boolean" })
    .notNull()
    .default(false),
  lastDigestAt: integer("last_digest_at", { mode: "timestamp" }),
});

/**
 * Surový katalog posledního scrapu za každý obchod.
 * V zadání (sekce 3) není, ale sekce 2.2 vyžaduje „vyhledání napříč aktuálně
 * nascrapovanými daty“ – tahle tabulka je to, v čem se hledá. Při každém scrapu
 * se obsah pro daný obchod nahradí.
 */
export const storeItems = sqliteTable(
  "store_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** Název přesně tak, jak ho uvádí obchod. */
    rawName: text("raw_name").notNull(),
    /** Normalizovaný tvar pro fuzzy hledání (bez diakritiky, sjednocené jednotky). */
    normalizedName: text("normalized_name").notNull(),
    price: real("price").notNull(),
    regularPrice: real("regular_price"),
    isSale: integer("is_sale", { mode: "boolean" }).notNull().default(false),
    saleValidFrom: integer("sale_valid_from", { mode: "timestamp" }),
    saleValidTo: integer("sale_valid_to", { mode: "timestamp" }),
    seenAt: integer("seen_at", { mode: "timestamp" }).notNull(),
    /** URL produktu nebo číslo stránky letáku – ať se dá dohledat zdroj. */
    sourceRef: text("source_ref"),
  },
  (t) => [index("items_store_normalized").on(t.storeId, t.normalizedName)],
);

/**
 * Přihlášení k oficiálnímu MCP serveru Rohlíku (OAuth). Jediný řádek s id 1:
 * appka má jednoho uživatele a k Rohlíku ji připojuje jeden účet.
 * Tokeny a registrace klienta se ukládají jako JSON tak, jak je vrátí server.
 */
export const rohlikAuth = sqliteTable("rohlik_auth", {
  id: integer("id").primaryKey().default(1),
  /** Adresa, na kterou Rohlík po přihlášení vrací – musí sedět při obou krocích. */
  redirectUrl: text("redirect_url"),
  clientInformation: text("client_information"),
  tokens: text("tokens"),
  codeVerifier: text("code_verifier"),
  /** Náhodná hodnota proti podvrženému návratu z přihlášení. */
  state: text("state"),
  connectedAt: integer("connected_at", { mode: "timestamp" }),
  lastError: text("last_error"),
});

export type Store = typeof stores.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductStoreAlias = typeof productStoreAliases.$inferSelect;
export type PriceObservation = typeof priceObservations.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type StoreItem = typeof storeItems.$inferSelect;
export type RohlikAuth = typeof rohlikAuth.$inferSelect;
