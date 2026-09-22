/**
 * Spuštění kontroly zvenčí. Na Cloudflare kontejner usíná, takže plánovač
 * uvnitř appky (node-cron) by se k ničemu nedostal – budí ji místo toho
 * Workers Cron Trigger, který zavolá tenhle endpoint.
 *
 * Chráněno sdíleným tajemstvím v hlavičce `x-check-token`. Bez nastaveného
 * CHECK_TOKEN endpoint nic nespustí, aby nešel zavolat omylem zvenčí.
 */
import { NextResponse } from "next/server";

import { db } from "@/db";
import { runCheck } from "@/lib/check";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Stažení a rozebrání letáků trvá déle než běžný požadavek.
export const maxDuration = 300;

type Body = { only?: "daily-scrape" | "weekly-leaflet" };

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.CHECK_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "CHECK_TOKEN není nastavený" }, { status: 503 });
  }
  if (request.headers.get("x-check-token") !== expected) {
    return NextResponse.json({ error: "Nepovolený požadavek" }, { status: 401 });
  }

  let only: Body["only"];
  try {
    only = ((await request.json()) as Body).only;
  } catch {
    only = undefined;
  }

  const report = await runCheck(db, { only });
  console.info(
    `kontrola (${only ?? "vše"}) – obchody: ${report.checkedStores.join(", ") || "žádné"} · ` +
      `pozorování: ${report.observations} · nové akce: ${report.newSales}`,
  );
  return NextResponse.json(report);
}
