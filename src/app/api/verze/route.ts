/**
 * Která verze appky v kontejneru opravdu běží. Nasazení kontejneru se
 * rozbíhá postupně, takže nová verze Workeru ještě neznamená nový kontejner.
 * Soubor zapisuje `npm run cf:release` těsně před sestavením obrazu.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const info = await readFile(path.join(process.cwd(), "src", "build-info.json"), "utf8");
    return NextResponse.json({ ...JSON.parse(info), startedAt: STARTED_AT });
  } catch {
    return NextResponse.json({ commit: "neznámý", startedAt: STARTED_AT });
  }
}

const STARTED_AT = new Date().toISOString();
