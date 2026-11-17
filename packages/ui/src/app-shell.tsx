/* eslint-disable @next/next/no-html-link-for-pages -- This framework-independent UI package uses native links and also runs outside Next. */
import type { ReactNode } from "react";
const discovery = [
  { href: "/cards", label: "Library" },
  { href: "/collection/portfolio", label: "Collection" },
  { href: "/lab", label: "Play" },
];
const collecting = [
  { href: "/local", label: "Local Radar" },
  { href: "/calendar", label: "Calendar" },
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
  const collection = [
    "/collection",
    "/watchlist",
    "/alerts",
    "/dashboard",
  ].some((p) => pathname === p || pathname.startsWith(p + "/"));
  const play = pathname.startsWith("/lab");
  const utility = collecting.some((l) => pathname.startsWith(l.href));
  const isCurrent = (href: string) =>
    href === "/lab"
      ? play
      : href === "/collection/portfolio"
        ? collection
        : href === "/cards"
          ? !collection && !play && !utility
          : pathname === href;
  const sections = collection
    ? [
        { href: "/collection/portfolio", label: "Overview" },
        { href: "/watchlist", label: "Saved" },
        { href: "/alerts", label: "Activity" },
      ]
    : play || utility
      ? []
      : [
          { href: "/cards", label: "Cards" },
          { href: "/card-sets", label: "Sets" },
          { href: "/products", label: "Shop" },
        ];
  const sectionCurrent = (href: string) =>
    href === "/cards"
      ? ["/", "/cards", "/artists", "/market"].some(
          (p) => pathname === p || (p !== "/" && pathname.startsWith(p + "/")),
        )
      : href === "/products"
        ? ["/products", "/drops"].some((p) => pathname.startsWith(p))
        : pathname === href || pathname.startsWith(href + "/");
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
          <summary>Tools & account</summary>
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
        {sections.length > 0 && (
          <nav
            className="pp-section-nav"
            aria-label={collection ? "Collection views" : "Library views"}
          >
            {sections.map((link) => (
              <a
                key={link.href}
                href={link.href}
                aria-current={sectionCurrent(link.href) ? "page" : undefined}
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}
        {sourceNotice && <p className="pp-banner">{sourceNotice}</p>}
        {children}
      </main>
      <nav className="pp-mobile-nav" aria-label="Primary mobile navigation">
        {[
          { href: "/cards", label: "Library" },
          { href: "/collection/portfolio", label: "Collection" },
          { href: "/lab", label: "Play" },
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
