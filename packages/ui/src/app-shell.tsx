/* eslint-disable @next/next/no-html-link-for-pages -- This framework-independent UI package uses native links and also runs outside Next. */
import type { ReactNode } from "react";
const discovery = [
  { href: "/drops", label: "Drops" },
  { href: "/products", label: "Explore" },
  { href: "/local", label: "Local Radar" },
  { href: "/calendar", label: "Calendar" },
];
const collecting = [
  { href: "/lab", label: "Pack Lab" },
  { href: "/collection", label: "Collection" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/alerts", label: "Alerts & inbox" },
  { href: "/settings", label: "Settings" },
];
export function AppShell({
  pathname,
  children,
  sourceNotice,
}: {
  pathname: string;
  children: ReactNode;
  sourceNotice?: string;
}) {
  const isCurrent = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  return (
    <div className="pp-shell">
      <a className="pp-skip" href="#main-content">
        Skip to content
      </a>
      <aside className="pp-sidebar">
        <a href="/" aria-label="PokéPulse home">
          ◈ PokéPulse
        </a>
        <p className="pp-muted">Collector workspace</p>
        <nav aria-label="Discovery">
          {discovery.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <h2>Collecting & account</h2>
        <nav aria-label="Collecting and account">
          {collecting.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </aside>
      <main id="main-content" tabIndex={-1} className="pp-main">
        <details className="pp-mobile-menu">
          <summary>Browse all pages</summary>
          <nav aria-label="All mobile pages">
            {[...discovery, ...collecting].map((link) => (
              <a
                key={link.href}
                href={link.href}
                aria-current={isCurrent(link.href) ? "page" : undefined}
              >
                {link.label}
              </a>
            ))}
          </nav>
        </details>
        {sourceNotice && <p className="pp-banner">{sourceNotice}</p>}
        {children}
      </main>
      <nav className="pp-mobile-nav" aria-label="Primary mobile navigation">
        {[
          { href: "/drops", label: "Drops" },
          { href: "/local", label: "Radar" },
          { href: "/watchlist", label: "Watchlist" },
          { href: "/collection", label: "Collection" },
        ].map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={isCurrent(link.href) ? "page" : undefined}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
