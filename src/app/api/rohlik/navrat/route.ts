/** Sem Rohlík vrací uživatele po přihlášení; vyměníme kód za tokeny. */
import { NextResponse } from "next/server";

import { db } from "@/db";
import { finishRohlikLogin } from "@/lib/rohlik-mcp";

import { publicOrigin } from "../adresa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const origin = publicOrigin(request);
  const params = new URL(request.url).searchParams;
  const code = params.get("code");

  try {
    if (!code) {
      const reason = params.get("error_description") ?? params.get("error") ?? "přihlášení zrušeno";
      throw new Error(reason);
    }
    await finishRohlikLogin(db, code, params.get("state"));
    return NextResponse.redirect(`${origin}/nastaveni?rohlik=pripojeno#rohlik`);
  } catch (error) {
    const message = encodeURIComponent((error as Error).message);
    return NextResponse.redirect(`${origin}/nastaveni?rohlik=chyba&zprava=${message}#rohlik`);
  }
}
