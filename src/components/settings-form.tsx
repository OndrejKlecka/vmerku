"use client";

import { useState, useTransition } from "react";

import {
  refreshLeafletAction,
  addStore,
  saveSettings,
  setStoreActive,
  updateStore,
} from "@/app/actions";
import type { UserSettings } from "@/db/schema";

type StoreRow = {
  id: number;
  name: string;
  kind: "daily-scrape" | "weekly-leaflet";
  sourceUrl: string;
  leafletDay: number | null;
  active: boolean;
};

const DAYS = [
  "neděle",
  "pondělí",
  "úterý",
  "středa",
  "čtvrtek",
  "pátek",
  "sobota",
];

export function SettingsForm({
  settings,
  stores,
}: {
  settings: UserSettings;
  stores: StoreRow[];
}) {
  const [savingSettings, startSaveSettings] = useTransition();
  const [togglingStore, startToggle] = useTransition();
  const [addingStore, startAdd] = useTransition();
  const [savingStore, startSaveStore] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [refreshNote, setRefreshNote] = useState<{
    id: number;
    text: string;
  } | null>(null);

  const watched = stores.filter((s) => s.active);
  const available = stores.filter((s) => !s.active);

  return (
    <>
      <section className="section card">
        <h2>Sledované obchody</h2>

        {watched.length === 0 ? (
          <p className="muted">Zatím žádný obchod.</p>
        ) : (
          watched.map((store) =>
            editingId === store.id ? (
              <form
                key={store.id}
                className="settings-row"
                style={{ display: "block" }}
                action={(fd) =>
                  startSaveStore(async () => {
                    await updateStore(store.id, fd);
                    setEditingId(null);
                  })
                }
              >
                <StoreFields store={store} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={savingStore}
                  >
                    {savingStore ? "Ukládám…" : "Uložit"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => setEditingId(null)}
                  >
                    Zrušit
                  </button>
                </div>
              </form>
            ) : (
              <div key={store.id} className="settings-row">
                <span>
                  <strong>{store.name}</strong>
                  <span
                    className="dim"
                    style={{ display: "block", fontSize: 13 }}
                  >
                    {store.kind === "daily-scrape"
                      ? "e-shop, kontrola denně"
                      : "týdenní leták"}
                  </span>
                  {refreshNote?.id === store.id && (
                    <span
                      className="muted"
                      style={{ display: "block", fontSize: 13 }}
                    >
                      {refreshNote.text}
                    </span>
                  )}
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  {store.kind === "weekly-leaflet" && (
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={refreshing}
                      onClick={() =>
                        startRefresh(async () => {
                          setRefreshNote({
                            id: store.id,
                            text: "Stahuji a čtu leták…",
                          });
                          const result = await refreshLeafletAction(store.id);
                          setRefreshNote({
                            id: store.id,
                            text: result.message,
                          });
                        })
                      }
                    >
                      Stáhnout leták teď
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => setEditingId(store.id)}
                  >
                    Upravit
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={togglingStore}
                    onClick={() =>
                      startToggle(() => setStoreActive(store.id, false))
                    }
                  >
                    Odebrat
                  </button>
                </span>
              </div>
            ),
          )
        )}

        {available.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <span className="field-label">Dostupné obchody</span>
            <div className="chips">
              {available.map((store) => (
                <button
                  key={store.id}
                  type="button"
                  className="chip"
                  disabled={togglingStore}
                  onClick={() =>
                    startToggle(() => setStoreActive(store.id, true))
                  }
                >
                  + {store.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="section card">
        <h2>Přidat další obchod</h2>
        <form action={(fd) => startAdd(() => addStore(fd))}>
          <StoreFields />

          <button
            type="submit"
            className="btn btn-primary"
            disabled={addingStore}
          >
            {addingStore ? "Přidávám…" : "Přidat obchod"}
          </button>
        </form>
      </section>

      <section className="section card">
        <h2>Notifikace</h2>
        <form action={(fd) => startSaveSettings(() => saveSettings(fd))}>
          <label className="field">
            <span className="field-label">E-mail</span>
            <input
              className="input"
              type="email"
              name="email"
              defaultValue={settings.email}
              placeholder="jmeno@example.com"
            />
          </label>

          <div className="field">
            <span className="field-label">Kdy posílat</span>
            <label className="radio-row">
              <input
                type="radio"
                name="notifyMode"
                value="instant"
                defaultChecked={settings.notifyMode === "instant"}
              />
              Okamžitě, jakmile položka spadne do akce
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="notifyMode"
                value="daily-digest"
                defaultChecked={settings.notifyMode === "daily-digest"}
              />
              Jednou denně souhrn
            </label>
          </div>

          <label className="radio-row" style={{ marginBottom: 16 }}>
            <input
              type="checkbox"
              name="includeUnchanged"
              defaultChecked={settings.includeUnchanged}
            />
            V souhrnu zmínit i položky beze změny
          </label>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={savingSettings}
          >
            {savingSettings ? "Ukládám…" : "Uložit"}
          </button>
        </form>
      </section>
    </>
  );
}

/** Pole obchodu; bez `store` prázdná pro přidání, se `store` předvyplněná pro úpravu. */
function StoreFields({ store }: { store?: StoreRow }) {
  const [kind, setKind] = useState(store?.kind ?? "weekly-leaflet");
  return (
    <>
      <label className="field">
        <span className="field-label">Název</span>
        <input
          className="input"
          name="name"
          placeholder="např. Penny"
          defaultValue={store?.name}
          required
        />
      </label>

      <label className="field">
        <span className="field-label">Typ zdroje</span>
        <select
          className="input"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as StoreRow["kind"])}
        >
          <option value="weekly-leaflet">Týdenní leták (PDF)</option>
          <option value="daily-scrape">E-shop (denní kontrola)</option>
        </select>
      </label>

      <label className="field">
        <span className="field-label">URL zdroje</span>
        <input
          className="input"
          name="sourceUrl"
          placeholder="https://…/letak.pdf"
          defaultValue={store?.sourceUrl}
          required
        />
      </label>

      {kind === "weekly-leaflet" && (
        <label className="field">
          <span className="field-label">Den vydání letáku</span>
          <select
            className="input"
            name="leafletDay"
            defaultValue={String(store?.leafletDay ?? 3)}
          >
            {DAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
