/**
 * Začátek přihlášení k Rohlíku: přesměruje na jeho přihlašovací stránku.
 * `?jiny=1` zahodí předchozí přihlášení a vynutí nové zadání účtu.
 */
import { NextResponse } from "next/server";

import { db } from "@/db";
import { startRohlikLogin } from "@/lib/rohlik-mcp";

import { CALLBACK_PATH, publicOrigin } from "../adresa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const origin = publicOrigin(request);
  const fresh = new URL(request.url).searchParams.get("jiny") === "1";
  try {
    const loginUrl = await startRohlikLogin(db, `${origin}${CALLBACK_PATH}`, { fresh });
    return NextResponse.redirect(loginUrl);
  } catch (error) {
    const message = encodeURIComponent((error as Error).message);
    return NextResponse.redirect(`${origin}/nastaveni?rohlik=chyba&zprava=${message}#rohlik`);
  }
}
