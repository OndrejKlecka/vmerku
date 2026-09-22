import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";

import { Nav } from "@/components/nav";
import "./globals.css";

const plex = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hlídač akcí",
  description: "Hlídá slevy na vybrané produkty na Rohlíku a v letácích řetězců.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F3F4F7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" className={plex.variable}>
      <body>
        <Nav />
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
