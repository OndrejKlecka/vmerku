import { RohlikSection } from "@/components/rohlik-section";
import { SettingsForm } from "@/components/settings-form";
import { db } from "@/db";
import { getAllStores, getSettings } from "@/lib/queries";
import { rohlikStatus } from "@/lib/rohlik-mcp";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ rohlik?: string; zprava?: string }>;
}) {
  const { rohlik, zprava } = await searchParams;
  const flash =
    rohlik === "pripojeno"
      ? ({ kind: "ok" } as const)
      : rohlik === "chyba"
        ? ({ kind: "error", message: zprava } as const)
        : null;
  const status = await rohlikStatus(db);
  const settings = await getSettings();
  const stores = (await getAllStores()).map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    sourceUrl: s.sourceUrl,
    active: s.active,
  }));

  const daily = stores.filter((s) => s.active && s.kind === "daily-scrape").map((s) => s.name);
  const leaflet = stores.filter((s) => s.active && s.kind === "weekly-leaflet").map((s) => s.name);

  return (
    <>
      <div className="page-head">
        <h1>Nastavení</h1>
      </div>

      <SettingsForm settings={settings} stores={stores} />

      <RohlikSection status={status} flash={flash} />

      <section className="section">
        <div className="notice">
          <strong>Frekvence kontrol</strong>
          <div style={{ marginTop: 4 }}>
            {daily.length > 0 && <div>{daily.join(", ")}: každý den ráno.</div>}
            {leaflet.length > 0 && (
              <div>{leaflet.join(", ")}: dvakrát týdně, podle vydání letáku.</div>
            )}
            {daily.length === 0 && leaflet.length === 0 && <div>Zatím není co kontrolovat.</div>}
          </div>
        </div>
      </section>
    </>
  );
}
