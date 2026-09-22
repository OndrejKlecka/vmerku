/**
 * Diagnostika Rohlík MCP: jaké nástroje server nabízí, který z nich appka
 * použila na hledání a co přesně vrátil. Dokumentace Rohlíku tvar odpovědi
 * neuvádí, takže tohle je jediný způsob, jak čtení cen vyladit.
 */
import Link from "next/link";

import { db } from "@/db";
import { probeRohlikMcp, type RohlikProbe, rohlikStatus } from "@/lib/rohlik-mcp";

export const dynamic = "force-dynamic";

const price = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK" });

export default async function RohlikProbePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();
  const status = await rohlikStatus(db);

  let probe: RohlikProbe | null = null;
  let error: string | null = null;
  if (q && status.connected) {
    try {
      probe = await probeRohlikMcp(db, q);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  return (
    <>
      <Link className="back" href="/nastaveni#rohlik">
        ← Nastavení
      </Link>
      <div className="page-head">
        <h1>Rohlík – vyzkoušet hledání</h1>
      </div>

      {!status.connected ? (
        <p className="notice">Nejdřív připoj účet Rohlíku v Nastavení.</p>
      ) : (
        <form className="section card" method="get" style={{ display: "flex", gap: 8 }}>
          <input className="input" name="q" defaultValue={q} placeholder="např. máslo Madeta" />
          <button type="submit" className="btn btn-primary">
            Hledat
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      {probe && (
        <>
          <section className="section card">
            <h2>Nalezené ceny ({probe.items.length})</h2>
            {probe.items.length === 0 ? (
              <p className="muted">
                Appka z odpovědi žádné ceny nevyčetla. Pošli prosím obsah sekce „Syrová odpověď“,
                podle ní čtení upravím.
              </p>
            ) : (
              probe.items.slice(0, 20).map((item, i) => (
                <div key={i} className="settings-row">
                  <span>{item.rawName}</span>
                  <span>
                    {price.format(item.price)}
                    {item.isSale && <span className="badge badge-sale" style={{ marginLeft: 8 }}>akce</span>}
                  </span>
                </div>
              ))
            )}
          </section>

          <section className="section card">
            <h2>Nástroje serveru</h2>
            <p className="muted">Použitý na hledání: {probe.searchTool ?? "žádný nenalezen"}</p>
            <ul>
              {probe.tools.map((t) => (
                <li key={t.name}>
                  <code>{t.name}</code>
                  {t.description && <span className="dim"> – {t.description.slice(0, 140)}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section className="section card">
            <h2>Syrová odpověď</h2>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, overflowX: "auto" }}>
              {probe.raw || "(prázdná)"}
            </pre>
          </section>
        </>
      )}
    </>
  );
}
