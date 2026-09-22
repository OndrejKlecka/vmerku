/**
 * Barvy čar v grafu – jeden obchod = jedna barva, pevné pořadí (sekce 5).
 * Záměrně mimo klientské komponenty, ať k nim mají přístup i serverové.
 */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

export function seriesColor(colorIndex: number): string {
  return SERIES_COLORS[colorIndex % SERIES_COLORS.length];
}
