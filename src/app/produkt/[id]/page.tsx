import Link from "next/link";
import { notFound } from "next/navigation";

import { PriceChart } from "@/components/price-chart";
import { RemoveProductButton } from "@/components/remove-product";
import { seriesColor } from "@/lib/colors";
import { formatDateShort, formatPrice, formatRelative, type RangeKey } from "@/lib/insights";
import { getProductDetail, type StoreState } from "@/lib/queries";

export const dynamic = "force-dynamic";

const RANGES: RangeKey[] = ["3M", "6M", "1R"];

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rozsah?: string; zobrazeni?: string }>;
}) {
  const { id } = await params;
  const { rozsah, zobrazeni } = await searchParams;

  const range: RangeKey = RANGES.includes(rozsah as RangeKey) ? (rozsah as RangeKey) : "6M";
  const asTable = zobrazeni === "tabulka";

  const detail = getProductDetail(Number(id), range);
  if (!detail) notFound();

  const best = detail.best;
  const rangeLabel = range === "1R" ? "rok" : range === "6M" ? "6 měsíců" : "3 měsíce";

  return (
    <>
      <div className="page-head">
        <Link href="/" className="back">
          ← Zpět
        </Link>
      </div>

      <h1 style={{ marginBottom: 16 }}>{detail.name}</h1>

      <div className="hero">
        <div className="hero-label">Teď nejlevněji</div>
        <div className={best?.isSale ? "hero-price sale" : "hero-price"}>
          {formatPrice(best?.price)}
        </div>
        <div className="hero-meta">
          {best ? best.store.name : "zatím žádná cena"}
          {best?.regularPrice ? ` · běžně ${formatPrice(best.regularPrice)}` : ""}
        </div>
        <div className="hero-badges">
          {detail.insights.isLowestInRange && best && (
            <span className="badge badge-sale">Nejnižší cena za {rangeLabel}</span>
          )}
          {best?.saleValidTo && (
            <span className="badge">Akce do {formatDateShort(best.saleValidTo)}</span>
          )}
        </div>
      </div>

      <section className="section card">
        <h2>Srovnání obchodů</h2>

        <div className="compare-wrap">
          <table className="compare">
            <thead>
              <tr>
                <th>Obchod</th>
                <th>Cena</th>
                <th>Stav</th>
                <th>Platnost</th>
                <th>Aktualizováno</th>
              </tr>
            </thead>
            <tbody>
              {detail.storeStates.map((state) => (
                <tr key={state.store.id} className={state.isSale ? "is-sale" : undefined}>
                  <td>
                    <span
                      className="store-dot"
                      style={{ background: colorOf(state) }}
                      aria-hidden
                    />
                    {state.store.name}
                  </td>
                  <td style={{ fontWeight: 600 }}>{formatPrice(state.price)}</td>
                  <td>{statusText(state)}</td>
                  <td className="muted">{validityText(state)}</td>
                  <td className="muted">{formatRelative(state.observedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="store-cards">
          {detail.storeStates.map((state) => (
            <div
              key={state.store.id}
              className={state.isSale ? "store-card is-sale" : "store-card"}
            >
              <div className="store-card-head">
                <strong>{state.store.name}</strong>
                <span style={{ fontWeight: 700 }}>{formatPrice(state.price)}</span>
              </div>
              <div className="muted" style={{ fontSize: 14 }}>
                {statusText(state)}
                {state.saleValidTo ? ` · ${validityText(state)}` : ""}
              </div>
              <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>
                {formatRelative(state.observedAt)}
                {state.aliasName ? ` · ${state.aliasName}` : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section card">
        <div className="chart-head">
          <h2 style={{ margin: 0 }}>Vývoj ceny</h2>
          <div className="range-switch">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/produkt/${detail.id}?rozsah=${r}${asTable ? "&zobrazeni=tabulka" : ""}`}
                aria-current={r === range}
              >
                {r}
              </Link>
            ))}
          </div>
        </div>

        <div className="chips" style={{ marginBottom: 12 }}>
          <Link
            href={`/produkt/${detail.id}?rozsah=${range}`}
            className="chip"
            aria-pressed={!asTable}
            style={{ textDecoration: "none" }}
          >
            Graf
          </Link>
          <Link
            href={`/produkt/${detail.id}?rozsah=${range}&zobrazeni=tabulka`}
            className="chip"
            aria-pressed={asTable}
            style={{ textDecoration: "none" }}
          >
            Tabulka
          </Link>
        </div>

        {asTable ? (
          <div className="compare-wrap">
            <table className="compare">
              <thead>
                <tr>
                  <th>Datum</th>
                  {detail.seriesStores.map((s) => (
                    <th key={s.id}>{s.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...detail.chart].reverse().map((point) => (
                  <tr key={point.date}>
                    <td>{formatDateShort(new Date(point.date))}</td>
                    {detail.seriesStores.map((s) => (
                      <td key={s.id}>{formatPrice(point[s.name] as number | null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <PriceChart
              data={detail.chart}
              series={detail.seriesStores.map((s) => ({ name: s.name, colorIndex: s.colorIndex }))}
            />
            <div className="legend">
              {detail.seriesStores.map((s) => (
                <span key={s.id} className="legend-item">
                  <span
                    className="legend-swatch"
                    style={{ background: seriesColor(s.colorIndex) }}
                    aria-hidden
                  />
                  {s.name}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="section">
        <div className="insights">
          <div className="stat">
            <div className="stat-value small">{formatPrice(detail.insights.average)}</div>
            <div className="stat-label">průměr za {rangeLabel}</div>
          </div>
          <div className="stat">
            <div className="stat-value small">{formatPrice(detail.insights.min)}</div>
            <div className="stat-label">minimum</div>
          </div>
          <div className="stat">
            <div className="stat-value small">{formatPrice(detail.insights.max)}</div>
            <div className="stat-label">maximum</div>
          </div>
        </div>
      </section>

      <RemoveProductButton productId={detail.id} name={detail.name} />
    </>
  );
}

function colorOf(state: StoreState): string {
  return seriesColor(state.store.colorIndex);
}

function statusText(state: StoreState): string {
  if (state.price == null) return "bez dat";
  return state.isSale ? "v akci" : "běžná cena";
}

function validityText(state: StoreState): string {
  if (!state.isSale) return "—";
  if (state.saleValidFrom && state.saleValidTo) {
    return `${formatDateShort(state.saleValidFrom)} – ${formatDateShort(state.saleValidTo)}`;
  }
  if (state.saleValidTo) return `do ${formatDateShort(state.saleValidTo)}`;
  return "neuvedeno";
}
