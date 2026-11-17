/* eslint-disable @next/next/no-html-link-for-pages -- This framework-independent UI package uses native links and also runs outside Next. */
import type { ReactNode } from "react";
const discovery = [
  { href: "/", label: "Overview" },
  { href: "/cards", label: "Card library" },
  { href: "/collection/portfolio", label: "My collection" },
  { href: "/card-sets", label: "Sets" },
  { href: "/market", label: "Market" },
];
const collecting = [
  { href: "/collection", label: "Set binder" },
  { href: "/products", label: "Sealed products" },
  { href: "/drops", label: "Retail drops" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/alerts", label: "Alerts & inbox" },
  { href: "/local", label: "Local Radar" },
  { href: "/calendar", label: "Calendar" },
  { href: "/lab", label: "Pack Lab" },
  { href: "/artists", label: "Illustrators" },
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
    pathname === href ||
    (pathname.startsWith(href + "/") &&
      ![...discovery, ...collecting].some(
        (link) =>
          link.href !== href &&
          link.href.startsWith(href + "/") &&
          pathname.startsWith(link.href),
      ));
  return (
    <div className="pp-shell">
      <a className="pp-skip" href="#main-content">
        Skip to content
      </a>
      <aside className="pp-sidebar">
        <a className="pp-brand" href="/" aria-label="PokéPulse home">
          <span className="pp-brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            Poké<span>Pulse</span>
            <small>POKÉMON COLLECTOR CLUB</small>
          </span>
        </a>
        <p className="pp-sidebar-intro">Your cards. Your collection.</p>
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
        <details className="pp-sidebar-more">
          <summary>More</summary>
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
        </details>
        <div className="pp-sidebar-bottom">
          <span className="pp-live-dot" /> Made for Pokémon collectors
        </div>
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
          { href: "/", label: "Home" },
          { href: "/cards", label: "Search" },
          { href: "/collection/portfolio", label: "Collection" },
          { href: "/card-sets", label: "Sets" },
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
