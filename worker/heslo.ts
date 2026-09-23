/**
 * Rodinné heslo před celou appkou. Appka sama přihlášení nemá, takže ho
 * hlídá Worker: bez platné cookie pustí jen na přihlašovací stránku.
 * Platí to i pro adresu na workers.dev, protože ta jde přes stejný Worker.
 *
 * Heslo je secret `APP_PASSWORD` v Cloudflare. Cookie nese HMAC odvozený
 * z hesla, ne heslo samotné; změna hesla tak odhlásí všechna zařízení.
 * Cron do appky chodí přímo na kontejner, tudy vůbec neprochází.
 */

export const LOGIN_PATH = "/prihlaseni";
export const LOGOUT_PATH = "/odhlaseni";
const COOKIE = "vmerku_pristup";
/** Rok – rodina se nemá přihlašovat pořád dokola. */
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
/** Zpomalí hádání hesla; rodině jednou za čas nevadí. */
const WRONG_PASSWORD_DELAY_MS = 1000;

const encoder = new TextEncoder();

async function hmac(key: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Porovnání v konstantním čase; obě strany jsou HMAC, takže stejně dlouhé. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function cookieValue(password: string): Promise<string> {
  return toBase64Url(await hmac(password, "vmerku-pristup-v1"));
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Kam se vrátit po přihlášení; jen cesta v rámci appky, žádná cizí adresa. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function loginPage(next: string, error: string | null, status = 200): Response {
  const html = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>V merku – přihlášení</title>
<style>
  :root { --ink:#171a21; --paper:#f3f4f7; --surface:#fff; --line:#e3e5ea; --muted:#666c78; --accent:#1f63b8; --error:#b42318; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e8eaef; --paper:#14161b; --surface:#1d2027; --line:#2e323b; --muted:#9aa0ac; --accent:#5b9bea; --error:#f97066; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px;
    background:var(--paper); color:var(--ink); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  form { width:100%; max-width:340px; background:var(--surface); border:1px solid var(--line);
    border-radius:12px; padding:24px; display:grid; gap:12px; }
  h1 { margin:0; font-size:22px; }
  p { margin:0; color:var(--muted); font-size:14px; }
  input { font:inherit; padding:10px 12px; border:1px solid var(--line); border-radius:8px;
    background:var(--paper); color:var(--ink); }
  button { font:inherit; font-weight:600; padding:10px 12px; border:0; border-radius:8px;
    background:var(--accent); color:#fff; cursor:pointer; }
  .error { color:var(--error); }
</style>
</head>
<body>
<form method="post" action="${LOGIN_PATH}">
  <h1>V merku</h1>
  <p>Zadej rodinné heslo.</p>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
  <input type="password" name="heslo" autocomplete="current-password" required autofocus aria-label="Heslo">
  <input type="hidden" name="dal" value="${escapeHtml(next)}">
  <button type="submit">Přihlásit</button>
</form>
</body>
</html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/**
 * Vrátí odpověď, když požadavek nesmí dál (přihlašovací stránka, přesměrování),
 * nebo null, když je návštěvník přihlášený a požadavek patří appce.
 */
export async function passwordGate(
  request: Request,
  env: { APP_PASSWORD?: string },
): Promise<Response | null> {
  const password = env.APP_PASSWORD;
  if (!password) {
    // Radši zavřeno než otevřeno: bez hesla by appka byla zase veřejná.
    return new Response("Heslo appky (APP_PASSWORD) není v Cloudflare nastavené.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const url = new URL(request.url);
  const expected = await cookieValue(password);

  if (url.pathname === LOGOUT_PATH) {
    return redirect(LOGIN_PATH, `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  }

  if (url.pathname === LOGIN_PATH) {
    if (request.method === "POST") {
      const form = await request.formData();
      const given = String(form.get("heslo") ?? "");
      const next = safeNext(String(form.get("dal") ?? ""));
      if (sameBytes(await hmac(password, given), await hmac(password, password))) {
        return redirect(
          next,
          `${COOKIE}=${expected}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
      return loginPage(next, "Heslo nesedí.", 401);
    }
    return loginPage(safeNext(url.searchParams.get("dal")), null);
  }

  const given = readCookie(request, COOKIE);
  if (given && sameBytes(encoder.encode(given), encoder.encode(expected))) return null;

  if (request.method === "GET" || request.method === "HEAD") {
    const next = encodeURIComponent(url.pathname + url.search);
    return redirect(`${LOGIN_PATH}?dal=${next}`);
  }
  return new Response("Nepřihlášeno", { status: 401 });
}
