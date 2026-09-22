/**
 * Párování názvů produktů (sekce 2.2 zadání).
 *
 * Záměrně žádný trénovaný model – jen normalizace + fuzzy skóre.
 * Skóre slouží k seřazení kandidátů, které uživatel potvrzuje; potvrzené
 * páry se ukládají jako aliasy a příště se použijí přednostně.
 */

/** Slova, která v názvech nic nerozlišují a jen kazí skóre. */
const NOISE = new Set([
  "akce", "sleva", "novinka", "nove", "ks", "kus", "kusu", "baleni", "bal",
  "vyhodne", "cena", "super", "top", "kg", "g", "l", "ml", "cl", "ce",
  "vyber", "produkt", "pro", "na", "do", "od", "s", "se", "z", "ze", "a", "i",
]);

/**
 * Hovorová označení stupňovitosti piva. Uživatel napíše „jedenáctka“,
 * leták tiskne „11°“ – bez tohohle překladu by se to nespárovalo.
 */
const NUMBER_WORDS: Record<string, string> = {
  desitka: "10deg",
  jedenactka: "11deg",
  dvanactka: "12deg",
  patnactka: "15deg",
};

/** Odstraní diakritiku a sjednotí zápis na porovnatelný tvar. */
export function normalize(input: string): string {
  let s = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  // Desetinná čárka na tečku, ať "0,5 l" a "0.5l" dopadnou stejně.
  s = s.replace(/(\d),(\d)/g, "$1.$2");
  // Stupně piva: "11°" i "11 °" -> "11deg" (ať se nespojí s gramáží)
  s = s.replace(/(\d+)\s*°/g, "$1deg");
  // Jednotky přilepíme k číslu: "0.5 l" -> "0.5l"
  s = s.replace(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl|ks)\b/g, "$1$2");
  // Zbytek interpunkce na mezery
  s = s.replace(/[^a-z0-9.]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  return s
    .split(" ")
    .map((word) => NUMBER_WORDS[word] ?? word)
    .join(" ");
}

/** Množství přepočtené na základní jednotku, ať jdou porovnat "500g" a "0.5kg". */
export type Quantity = { value: number; unit: "l" | "kg" | "ks" };

export function extractQuantity(normalized: string): Quantity | null {
  const m = normalized.match(/(\d+(?:\.\d+)?)(kg|g|l|ml|cl|ks)\b/);
  if (!m) return null;
  const value = Number(m[1]);
  switch (m[2]) {
    case "kg": return { value, unit: "kg" };
    case "g": return { value: value / 1000, unit: "kg" };
    case "l": return { value, unit: "l" };
    case "ml": return { value: value / 1000, unit: "l" };
    case "cl": return { value: value / 100, unit: "l" };
    default: return { value, unit: "ks" };
  }
}

function tokens(normalized: string): string[] {
  const out: string[] = [];
  for (const token of normalized.split(" ")) {
    if (token.length <= 1 || NOISE.has(token)) continue;
    out.push(token);
    // Leták tiskne stupně jednou jako „11°“ a jindy jako holé „11“ –
    // ať se trefí obojí, držíme v sadě obě podoby.
    const degrees = token.match(/^(\d+)deg$/);
    if (degrees) out.push(degrees[1]);
  }
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return (2 * shared) / (a.size + b.size);
}

function trigrams(s: string): Set<string> {
  const padded = ` ${s.replace(/\s+/g, " ")} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/**
 * Skóre shody dvou názvů v rozsahu 0–1.
 * Kombinuje shodu slov, shodu trigramů (zvládne překlepy a jiné koncovky)
 * a shodu gramáže/objemu, která je u potravin rozhodující.
 */
export function similarity(queryRaw: string, candidateRaw: string): number {
  const q = normalize(queryRaw);
  const c = normalize(candidateRaw);
  if (!q || !c) return 0;
  if (q === c) return 1;

  const qt = tokens(q);
  const ct = tokens(c);
  if (qt.length === 0 || ct.length === 0) return 0;

  const wordScore = dice(new Set(qt), new Set(ct));
  const charScore = dice(trigrams(q), trigrams(c));

  // Bez jediného společného významového slova nemá smysl nabízet shodu.
  const sharesWord = qt.some((t) => ct.includes(t));
  if (!sharesWord && charScore < 0.5) return 0;

  let score = 0.6 * wordScore + 0.4 * charScore;

  // Gramáž: shoda je bonus, rozdíl je výrazná srážka (0,5 l ≠ 1,5 l).
  const qq = extractQuantity(q);
  const cq = extractQuantity(c);
  if (qq && cq) {
    if (qq.unit === cq.unit) {
      const ratio = Math.min(qq.value, cq.value) / Math.max(qq.value, cq.value);
      score = ratio > 0.98 ? Math.min(1, score + 0.1) : score * (0.5 + 0.5 * ratio);
    }
  }

  return Math.max(0, Math.min(1, score));
}

/** Procentní vyjádření pro UI („94 % shoda“). */
export function matchPercent(score: number): number {
  return Math.round(score * 100);
}

export type Candidate<T> = { item: T; score: number };

/** Seřadí kandidáty podle skóre a odřízne ty pod prahem. */
export function rankCandidates<T>(
  query: string,
  items: T[],
  nameOf: (item: T) => string,
  { threshold = 0.45, limit = 5 }: { threshold?: number; limit?: number } = {},
): Candidate<T>[] {
  return items
    .map((item) => ({ item, score: similarity(query, nameOf(item)) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
