/**
 * Veřejná adresa appky pro návrat z přihlášení na Rohlíku. Za Workerem
 * nemusí adresa požadavku odpovídat tomu, co vidí prohlížeč, proto má
 * přednost APP_URL.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const CALLBACK_PATH = "/api/rohlik/navrat";
