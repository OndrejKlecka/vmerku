/**
 * Přesměrování z http na https. Cloudflare na vlastní doméně pouští do
 * Workeru i nešifrované požadavky, dokud se v dashboardu nezapne „Always
 * Use HTTPS“ – a to platí pro celou zónu, ne jen pro V merku. Tady to
 * proto řešíme jen pro tuhle appku.
 *
 * 301 i pro formuláře by prohlížeč převedl na GET, proto 308, které
 * zachová metodu i tělo.
 */
export function httpsRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:") return null;
  // `wrangler dev` běží na http://localhost a https tam není.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
  url.protocol = "https:";
  return Response.redirect(url.toString(), request.method === "GET" || request.method === "HEAD" ? 301 : 308);
}
