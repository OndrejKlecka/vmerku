"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Přehled" },
  { href: "/pridat", label: "Přidat" },
  { href: "/nastaveni", label: "Nastavení" },
];

export function Nav() {
  const pathname = usePathname();
  // Detail produktu patří pod Přehled.
  const active = pathname.startsWith("/produkt") ? "/" : pathname;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="wordmark">
            Hlídač akcí
          </Link>
          <nav className="topnav">
            {ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active === item.href ? "page" : undefined}
              >
                {item.label === "Přidat" ? "Přidat produkt" : item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <nav className="bottomnav" aria-label="Hlavní navigace">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active === item.href ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
