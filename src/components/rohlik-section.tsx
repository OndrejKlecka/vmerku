import Link from "next/link";

import { disconnectRohlikAction } from "@/app/actions";
import type { RohlikStatus } from "@/lib/rohlik-mcp";

const dateFormat = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Prague",
});

/** Připojení účtu k oficiálnímu MCP serveru Rohlíku. */
export function RohlikSection({
  status,
  flash,
}: {
  status: RohlikStatus;
  flash: { kind: "ok" | "error"; message?: string } | null;
}) {
  return (
    <section className="section card" id="rohlik">
      <h2>Účet na Rohlíku</h2>
      <p className="muted" style={{ marginTop: 4 }}>
        Ceny z Rohlíku bereme z jeho oficiálního rozhraní pro asistenty. Potřebuje přihlášení
        zákaznickým účtem; heslo zadáváš přímo na stránce Rohlíku a appka ho nevidí.
      </p>

      {flash?.kind === "ok" && <p className="notice" style={{ marginTop: 12 }}>Účet je připojený.</p>}
      {flash?.kind === "error" && (
        <p className="error">Připojení se nepovedlo: {flash.message ?? "neznámá chyba"}</p>
      )}
      {status.lastError && !flash && <p className="error">{status.lastError}</p>}

      {status.connected ? (
        <>
          <p style={{ marginTop: 12 }}>
            <strong>Připojeno</strong>
            {status.connectedAt && (
              <span className="dim"> od {dateFormat.format(status.connectedAt)}</span>
            )}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <Link className="btn" href="/nastaveni/rohlik">
              Vyzkoušet hledání
            </Link>
            <a className="btn" href="/api/rohlik/pripojit?jiny=1">
              Přihlásit jiným účtem
            </a>
            <form action={disconnectRohlikAction}>
              <button type="submit" className="btn btn-quiet">
                Odhlásit
              </button>
            </form>
          </div>
          <p className="dim" style={{ fontSize: 13, marginTop: 8 }}>
            Kdyby Rohlík při přihlášení jiným účtem rovnou pustil ten původní, odhlas se nejdřív
            na rohlik.cz v tomhle prohlížeči.
          </p>
        </>
      ) : (
        <div style={{ marginTop: 12 }}>
          <a className="btn btn-primary" href="/api/rohlik/pripojit">
            Připojit účet Rohlíku
          </a>
          <p className="dim" style={{ fontSize: 13, marginTop: 8 }}>
            Bez připojení se ceny zkoušejí číst z webu Rohlíku, což je méně spolehlivé.
          </p>
        </div>
      )}
    </section>
  );
}
