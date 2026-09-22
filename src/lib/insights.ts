import type { PriceObservation } from "@/db/schema";

export type RangeKey = "3M" | "6M" | "1R";

export const RANGE_DAYS: Record<RangeKey, number> = { "3M": 90, "6M": 182, "1R": 365 };

export function rangeStart(range: RangeKey, now = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - RANGE_DAYS[range]);
  return d;
}

export type Insights = {
  average: number | null;
  min: number | null;
  max: number | null;
  /** True, když je aktuální cena nejnižší za celé zvolené období (sekce 4.2). */
  isLowestInRange: boolean;
};

export function computeInsights(
  observations: Pick<PriceObservation, "price" | "observedAt">[],
  currentPrice: number | null,
): Insights {
  if (observations.length === 0) {
    return { average: null, min: null, max: null, isLowestInRange: false };
  }
  const prices = observations.map((o) => o.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const average = prices.reduce((a, b) => a + b, 0) / prices.length;

  return {
    average,
    min,
    max,
    // Tolerance na haléře – stejná cena se nemá tvářit jako dražší.
    isLowestInRange: currentPrice != null && currentPrice <= min + 0.001,
  };
}

/** Změna proti ceně zhruba před týdnem, v procentech. Null, když není s čím srovnat. */
export function weeklyTrend(
  observations: Pick<PriceObservation, "price" | "observedAt">[],
  now = new Date(),
): number | null {
  if (observations.length < 2) return null;
  const sorted = [...observations].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime(),
  );
  const current = sorted[sorted.length - 1];

  const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000;
  // Nejbližší pozorování k datu před týdnem.
  let reference = sorted[0];
  for (const o of sorted) {
    if (o.observedAt.getTime() <= weekAgo) reference = o;
  }
  if (reference === current || reference.price === 0) return null;

  return ((current.price - reference.price) / reference.price) * 100;
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(2).replace(".", ",").replace(/,00$/, "")} Kč`;
}

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}

export function formatDateShort(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}

export function formatRelative(date: Date | null | undefined): string {
  if (!date) return "zatím nekontrolováno";
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "právě teď";
  if (minutes < 60) return `před ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `před ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "včera" : `před ${days} dny`;
}
