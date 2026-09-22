"use client";

import { useState, useTransition } from "react";

import { addProduct, type MatchCandidate, searchCandidates, type SearchResult } from "@/app/actions";
import { formatPrice } from "@/lib/insights";

type StoreOption = { id: number; name: string };

/** Klíč kandidáta – obchod může mít víc variant balení se stejným názvem. */
const keyOf = (c: MatchCandidate) => `${c.storeId}::${c.rawName}`;

export function AddProductForm({ stores }: { stores: StoreOption[] }) {
  const [name, setName] = useState("");
  const [selectedStores, setSelectedStores] = useState<number[]>(stores.map((s) => s.id));
  const [result, setResult] = useState<SearchResult | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  function toggleStore(id: number) {
    setSelectedStores((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  function runSearch() {
    setError(null);
    startSearch(async () => {
      try {
        const found = await searchCandidates(name, selectedStores);
        setResult(found);
        // Nejlepší shodu za každý obchod předvybereme – uživatel jen potvrdí.
        const preselected = new Set<string>();
        const seenStores = new Set<number>();
        for (const c of found.candidates) {
          if (!seenStores.has(c.storeId) && c.percent >= 70) {
            preselected.add(keyOf(c));
            seenStores.add(c.storeId);
          }
        }
        setChecked(preselected);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function toggleCandidate(candidate: MatchCandidate) {
    const key = keyOf(candidate);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedCandidates = (result?.candidates ?? []).filter((c) => checked.has(keyOf(c)));
  const manualEntries = Object.entries(manual)
    .map(([storeId, rawName]) => ({ storeId: Number(storeId), rawName: rawName.trim() }))
    .filter((m) => m.rawName.length > 0);
  const totalSelected = selectedCandidates.length + manualEntries.length;

  function save() {
    setError(null);
    startSave(async () => {
      try {
        await addProduct(name, [
          ...selectedCandidates.map((c) => ({
            storeId: c.storeId,
            rawName: c.rawName,
            price: c.price,
            regularPrice: c.regularPrice,
            isSale: c.isSale,
          })),
          ...manualEntries,
        ]);
      } catch (e) {
        // redirect() ze server action vyhazuje řízenou výjimku – tu ignorujeme.
        const message = (e as Error).message;
        if (!message.includes("NEXT_REDIRECT")) setError(message);
      }
    });
  }

  return (
    <>
      <div className="card section">
        <label className="field">
          <span className="field-label">Název produktu</span>
          <input
            className="input"
            value={name}
            placeholder="např. Pivo Holba Šerák 11° 0,5 l"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) runSearch();
            }}
          />
        </label>

        <div className="field">
          <span className="field-label">Hledat v obchodech</span>
          <div className="chips">
            {stores.map((store) => (
              <button
                key={store.id}
                type="button"
                className="chip"
                aria-pressed={selectedStores.includes(store.id)}
                onClick={() => toggleStore(store.id)}
              >
                {store.name}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim() || selectedStores.length === 0 || searching}
          onClick={runSearch}
        >
          {searching ? "Hledám…" : "Najít shody"}
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      {result && (
        <>
          <section className="section">
            <h2>Nalezené shody</h2>
            {result.candidates.length === 0 ? (
              <div className="empty">
                Ve vybraných obchodech se nic podobného nenašlo. Můžeš název doplnit ručně níž.
              </div>
            ) : (
              <div className="product-list">
                {result.candidates.map((candidate) => {
                  const key = keyOf(candidate);
                  const isChecked = checked.has(key);
                  return (
                    <label
                      key={key}
                      className={isChecked ? "match-row selected" : "match-row"}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCandidate(candidate)}
                      />
                      <span>
                        <span className="match-store">{candidate.storeName}</span>
                        <span className="match-name">{candidate.rawName}</span>
                      </span>
                      <span className="match-right">
                        <span
                          style={{ fontWeight: 700, color: candidate.isSale ? "var(--status-text)" : undefined }}
                        >
                          {formatPrice(candidate.price)}
                        </span>
                        <span className="match-store" style={{ display: "block" }}>
                          {candidate.percent} % shoda
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          {result.missingStores.length > 0 && (
            <section className="section card">
              <h2>Doplnit ručně</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                V těchhle obchodech se shoda nenašla. Když znáš přesný název, zadej ho –
                uloží se jako alias a použije se, jakmile se položka objeví.
              </p>
              {result.missingStores.map((store) => (
                <label key={store.id} className="field">
                  <span className="field-label">{store.name}</span>
                  <input
                    className="input"
                    placeholder="přesný název v tomhle obchodě"
                    value={manual[store.id] ?? ""}
                    onChange={(e) =>
                      setManual((prev) => ({ ...prev, [store.id]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </section>
          )}

          {result.warnings.length > 0 && (
            <div className="notice section">
              {result.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}

          <div className="sticky-bar">
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={totalSelected === 0 || saving}
              onClick={save}
            >
              {saving ? "Ukládám…" : `Přidat vybrané (${totalSelected}) do sledování`}
            </button>
          </div>
        </>
      )}
    </>
  );
}
