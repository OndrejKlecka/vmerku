import type { NextConfig } from "next";

/**
 * Bezpečnostní hlavičky pro všechny stránky. Plnou Content-Security-Policy
 * nenastavujeme – Next vkládá inline skripty a bez nonce by se rozbil;
 * `frame-ancestors` jen zakazuje vložení appky do cizího iframe.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  // better-sqlite3 a pdfjs-dist jsou nativní/node-only – nechceme je bundlovat do serverového buildu
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist"],
  // Hlavička X-Powered-By jen prozrazuje, na čem appka běží.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
