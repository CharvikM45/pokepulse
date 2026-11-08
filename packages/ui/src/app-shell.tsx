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
        <a className="pp-brand" href="/" aria-label="PokéPulse home">
          <span className="pp-brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            Poké<span>Pulse</span>
            <small>COLLECTOR STUDIO</small>
          </span>
        </a>
        <p className="pp-sidebar-intro">Your corner of the collecting world.</p>
        <p className="pp-nav-caption">DISCOVER</p>
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
        <h2 className="pp-nav-caption">YOUR SPACE</h2>
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
        <div className="pp-sidebar-bottom">
          <span className="pp-live-dot" /> Made for the joy of the hunt
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
