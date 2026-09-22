import Link from "next/link";

import { formatPrice, formatRelative } from "@/lib/insights";
import { getLastCheckedAt, getProductRows, type ProductRow } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filtr?: string }>;
}) {
  const { filtr } = await searchParams;
  const onlySales = filtr === "akce";

  const rows = getProductRows();
  const salesCount = rows.filter((r) => r.saleCount > 0).length;
  const visible = onlySales ? rows.filter((r) => r.saleCount > 0) : rows;
  const lastChecked = getLastCheckedAt();

  return (
    <>
      <div className="page-head">
        <h1>Přehled</h1>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-value">{rows.length}</div>
          <div className="stat-label">hlídaných položek</div>
        </div>
        <div className="stat">
          <div className="stat-value">{salesCount}</div>
          <div className="stat-label">právě v akci</div>
        </div>
        <div className="stat">
          <div className="stat-value small">{formatRelative(lastChecked)}</div>
          <div className="stat-label">poslední kontrola</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          <Link
            href="/"
            className="chip"
            aria-pressed={!onlySales}
            role="button"
            style={{ textDecoration: "none" }}
          >
            Vše
          </Link>
          <Link
            href="/?filtr=akce"
            className="chip"
            aria-pressed={onlySales}
            role="button"
            style={{ textDecoration: "none" }}
          >
            V akci
          </Link>
        </div>
        <Link href="/pridat" className="btn btn-primary">
          + Přidat produkt
        </Link>
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          {rows.length === 0 ? (
            <>
              Zatím nic nehlídáš. <Link href="/pridat">Přidej první produkt</Link>.
            </>
          ) : (
            "Žádná z hlídaných položek teď není v akci."
          )}
        </div>
      ) : (
        <div className="product-list">
          {visible.map((row) => (
            <ProductCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </>
  );
}

function ProductCard({ row }: { row: ProductRow }) {
  const best = row.best;

  return (
    <Link href={`/produkt/${row.id}`} className="product-row">
      <div>
        <div className="product-name">{row.name}</div>
        <div className="product-pills">
          <span className={row.saleCount > 0 ? "badge badge-sale" : "badge"}>
            {row.saleCount > 0 ? saleLabel(row.saleCount) : "Bez akce"}
          </span>
          {row.storeStates.map((state) => (
            <span
              key={state.store.id}
              className={state.isSale ? "store-pill on-sale" : "store-pill"}
            >
              {state.isSale && <span className="dot" aria-hidden />}
              {state.store.name}
            </span>
          ))}
        </div>
      </div>

      <div className="product-price">
        <div className={best?.isSale ? "price-value sale" : "price-value"}>
          {formatPrice(best?.price)}
        </div>
        <div className="price-meta">{best ? best.store.name : "zatím bez ceny"}</div>
        {row.trendPercent != null && (
          <div className={row.trendPercent < 0 ? "price-meta trend-down" : "price-meta"}>
            {row.trendPercent < 0 ? "↓" : "↑"} {Math.abs(row.trendPercent).toFixed(0)} % / týden
          </div>
        )}
      </div>
    </Link>
  );
}

function saleLabel(count: number): string {
  if (count === 1) return "V akci v 1 obchodě";
  if (count < 5) return `V akci ve ${count} obchodech`;
  return `V akci v ${count} obchodech`;
}
