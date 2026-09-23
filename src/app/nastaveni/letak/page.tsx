/**
 * Diagnostika letáku: co appka z letáku vyčetla a jak vypadá textová vrstva
 * kolem hledaného slova. Slouží k ladění parseru na letácích, které se nedají
 * nahrát do chatu – výpis z téhle stránky stačí zkopírovat.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { storeItems, stores } from "@/db/schema";
import { normalize } from "@/lib/match";
import {
  downloadLeafletPdf,
  extractCells,
  itemsFromCells,
  parseValidity,
} from "@/lib/scrapers/leaflet";

export const dynamic = "force-dynamic";

/** Jak daleko od nalezeného slova ještě ukázat okolní text (body PDF). */
const RADIUS = 160;

export default async function LeafletDiagnostics({
  searchParams,
}: {
  searchParams: Promise<{ obchod?: string; q?: string; surovy?: string }>;
}) {
  const { obchod, q = "", surovy } = await searchParams;
  const leafletStores = (await db.select().from(stores).all()).filter(
    (s) => s.kind === "weekly-leaflet",
  );
  const store =
    leafletStores.find((s) => String(s.id) === obchod) ?? leafletStores[0];
  const needle = normalize(q);

  const stored = store
    ? (
        await db
          .select()
          .from(storeItems)
          .where(eq(storeItems.storeId, store.id))
          .all()
      ).filter((i) => !needle || normalize(i.rawName).includes(needle))
    : [];

  let raw = "";
  if (store && surovy && needle) {
    try {
      const cells = await extractCells(await downloadLeafletPdf(store));
      const hits = cells.filter((c) => normalize(c.text).includes(needle));
      const blocks = hits.slice(0, 8).map((hit) => {
        const near = cells
          .filter(
            (c) =>
              c.page === hit.page &&
              Math.abs(c.x - hit.x) < RADIUS &&
              Math.abs(c.y - hit.y) < RADIUS,
          )
          .sort((a, b) => b.y - a.y || a.x - b.x)
          .map(
            (c) =>
              `  x=${Math.round(c.x)} y=${Math.round(c.y)} w=${Math.round(c.width)}  ${c.text}`,
          );
        return `--- strana ${hit.page}, „${hit.text}“ ---\n${near.join("\n")}`;
      });
      const validity = parseValidity(
        cells
          .slice(0, 40)
          .map((c) => c.text)
          .join(" "),
      );
      const parsed = itemsFromCells(cells, validity).filter((i) =>
        normalize(i.rawName).includes(needle),
      );
      raw =
        `Buněk: ${cells.length}, nečitelných: ${cells.filter((c) => isGarbled(c.text)).length}, výskytů „${q}“: ${hits.length}\n\n` +
        blocks.join("\n\n") +
        `\n\n--- parser z toho udělal ---\n` +
        parsed
          .map(
            (i) => `${i.rawName} | ${i.price} | běžně ${i.regularPrice ?? "—"}`,
          )
          .join("\n");
    } catch (error) {
      raw = `Chyba: ${(error as Error).message}`;
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Diagnostika letáku</h1>
      </div>
      <section className="section card">
        <form>
          <label className="field">
            <span className="field-label">Obchod</span>
            <select
              className="input"
              name="obchod"
              defaultValue={store ? String(store.id) : undefined}
            >
              {leafletStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Hledat v letáku</span>
            <input
              className="input"
              name="q"
              defaultValue={q}
              placeholder="např. milka"
            />
          </label>
          <label
            className="field"
            style={{ display: "flex", gap: 8, alignItems: "center" }}
          >
            <input
              type="checkbox"
              name="surovy"
              value="1"
              defaultChecked={Boolean(surovy)}
            />
            <span>
              Ukázat i syrový text letáku (stáhne ho znovu, trvá déle)
            </span>
          </label>
          <button type="submit" className="btn btn-primary">
            Zobrazit
          </button>
        </form>
      </section>

      <section className="section card">
        <h2>Uložené položky ({stored.length})</h2>
        {stored.slice(0, 200).map((i) => (
          <div key={i.id} className="settings-row">
            <span>{i.rawName}</span>
            <span>
              {i.price} Kč{i.regularPrice ? ` (běžně ${i.regularPrice})` : ""}
            </span>
          </div>
        ))}
      </section>

      {raw && (
        <section className="section card">
          <h2>Syrový text</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{raw}</pre>
        </section>
      )}
    </>
  );
}
