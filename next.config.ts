import type { NextConfig } from "next";

const config: NextConfig = {
  // better-sqlite3 a pdfjs-dist jsou nativní/node-only – nechceme je bundlovat do serverového buildu
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist"],
};

export default config;
