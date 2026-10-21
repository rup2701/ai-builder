"use client";

/**
 * Draws a store's home page from a StoreConfig.
 *
 * It sizes itself to its container (container queries), so the same component fills the
 * desktop preview and the phone frame. Colours come from CSS variables set at the top,
 * which keeps the Appnomics page styles (including its global heading colour) out of the
 * store. Headings here are h3 and h4 for that reason.
 */

import type { CSSProperties } from "react";
import { STYLES, mix, paletteFor, type ArtKind, type Palette, type StoreConfig } from "@/lib/builder/storeConfig";

const POT = "#c0714f";

function ProductArt({ kind, pal }: { kind: ArtKind; pal: Palette }) {
  const a1 = pal.accent;
  const a2 = mix(pal.accent, pal.ink, 0.35);
  const a3 = mix(pal.accent, pal.bg, 0.55);
  const cream = mix(pal.bg, "#ffffff", 0.55);
  const shadow = <ellipse cx="50" cy="87" rx="28" ry="3" fill={pal.ink} opacity="0.08" />;
  const common = { viewBox: "0 0 100 100", className: "h-full w-full", "aria-hidden": true } as const;

  switch (kind) {
    case "mug":
      return (
        <svg {...common}>
          {shadow}
          <path d="M62 48h5a8 8 0 0 1 0 17h-5" fill="none" stroke={a1} strokeWidth="5" strokeLinecap="round" />
          <rect x="30" y="38" width="34" height="46" rx="6" fill={a1} />
          <ellipse cx="47" cy="38.5" rx="17" ry="3.5" fill={a2} />
          {[[38, 52], [48, 60], [55, 50], [42, 70], [56, 72]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill={cream} />
          ))}
        </svg>
      );
    case "bowl":
      return (
        <svg {...common}>
          {shadow}
          <path d="M20 52h60c0 18-13 32-30 32S20 70 20 52z" fill={cream} />
          <ellipse cx="50" cy="52" rx="30" ry="5" fill={a3} />
          <path d="M25 62h50" stroke={a1} strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case "vase":
      return (
        <svg {...common}>
          {shadow}
          <path d="M50 34C50 24 46 18 42 12M50 34C51 25 56 19 60 14M50 34V10" fill="none" stroke={a1} strokeWidth="1.8" strokeLinecap="round" />
          <ellipse cx="42" cy="11" rx="2.6" ry="5" transform="rotate(-20 42 11)" fill={a1} />
          <ellipse cx="60" cy="13" rx="2.6" ry="5" transform="rotate(22 60 13)" fill={a1} />
          <ellipse cx="50" cy="8" rx="2.6" ry="5" fill={a1} />
          <path d="M46 34h8v10c8 5 11 15 11 26v14H35V70c0-11 3-21 11-26z" fill={a2} />
        </svg>
      );
    case "dress":
      return (
        <svg {...common}>
          <path d="M50 10v5M50 15L34 26h32z" fill="none" stroke={a2} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <path d="M41 20h18l4 13-7 7 10 46H34l10-46-7-7z" fill={a1} />
          <path d="M44 40h12" stroke={a2} strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case "knit":
      return (
        <svg {...common}>
          {shadow}
          <rect x="24" y="64" width="52" height="16" rx="3" fill={a3} />
          <rect x="24" y="48" width="52" height="16" rx="3" fill={a1} />
          <rect x="24" y="32" width="52" height="16" rx="3" fill={a2} />
        </svg>
      );
    case "tote":
      return (
        <svg {...common}>
          {shadow}
          <path d="M38 46c0-18 24-18 24 0" fill="none" stroke={a1} strokeWidth="3.5" strokeLinecap="round" />
          <rect x="28" y="46" width="44" height="38" rx="3" fill={a2} />
          <rect x="38" y="58" width="24" height="16" rx="2" fill={a3} />
        </svg>
      );
    case "plant":
      return (
        <svg {...common}>
          {shadow}
          {[-55, -30, -8, 16, 40, 62].map((a, i) => (
            <ellipse key={a} cx="50" cy="44" rx="7" ry="22" transform={`rotate(${a} 50 66)`} fill={i % 2 ? a1 : a2} />
          ))}
          <path d="M34 66h32l-4 20H38z" fill={POT} />
          <rect x="32" y="62" width="36" height="6" rx="2" fill={mix(POT, "#ffffff", 0.2)} />
        </svg>
      );
    case "succulent":
      return (
        <svg {...common}>
          {shadow}
          {[-65, -35, -10, 14, 40, 66].map((a, i) => (
            <ellipse key={a} cx="50" cy="61" rx="5" ry="13" transform={`rotate(${a} 50 74)`} fill={i % 2 ? a1 : a3} />
          ))}
          <path d="M38 74h24l-3 12H41z" fill={POT} />
          <rect x="36" y="71" width="28" height="5" rx="2" fill={mix(POT, "#ffffff", 0.2)} />
        </svg>
      );
    case "candle":
      return (
        <svg {...common}>
          {shadow}
          <path d="M50 20c5 6 5 10 0 14-5-4-5-8 0-14z" fill="#e8b04a" />
          <rect x="32" y="36" width="36" height="8" rx="2" fill={a1} />
          <rect x="30" y="44" width="40" height="40" rx="6" fill={a2} />
          <rect x="30" y="56" width="40" height="14" fill={cream} />
        </svg>
      );
    case "necklace":
      return (
        <svg {...common}>
          <path d="M24 20C30 74 70 74 76 20" fill="none" stroke={a2} strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="50" cy="64" r="7" fill={a1} />
          <circle cx="48" cy="62" r="2" fill={cream} />
        </svg>
      );
    case "coffee":
      return (
        <svg {...common}>
          {shadow}
          <path d="M32 24h36l4 60H28z" fill={a2} />
          <path d="M32 24h36l-2 9H34z" fill={a1} />
          <rect x="38" y="46" width="24" height="24" rx="2" fill={cream} />
          <path d="M42 54h16M42 60h10" stroke={a2} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "tin":
      return (
        <svg {...common}>
          {shadow}
          <rect x="28" y="30" width="44" height="10" rx="3" fill={a1} />
          <rect x="30" y="40" width="40" height="44" rx="4" fill={a2} />
          <rect x="30" y="54" width="40" height="14" fill={cream} />
        </svg>
      );
  }
}

export default function StorePreview({ config }: { config: StoreConfig }) {
  const pal = paletteFor(config.accent, config.dark);
  const st = STYLES[config.style];
  const heading: CSSProperties = { fontFamily: st.head, fontWeight: st.weight, letterSpacing: st.track };
  const radius: CSSProperties = { borderRadius: "var(--s-radius)" };
  const vars = {
    "--s-bg": pal.bg,
    "--s-ink": pal.ink,
    "--s-muted": pal.muted,
    "--s-line": pal.line,
    "--s-accent": pal.accent,
    "--s-accent-text": pal.accentText,
    "--s-accent-ink": pal.accentInk,
    "--s-tint": pal.tint,
    "--s-radius": st.radius,
    fontFamily: st.body,
    colorScheme: config.dark ? "dark" : "light",
  } as CSSProperties;

  const eyebrow = `${config.kind}${config.location ? ` · ${config.location}` : ""}`;
  const heroArts = config.products.slice(0, 3);

  return (
    <div className="@container" style={vars} data-testid="store-preview">
      <div className="bg-[var(--s-bg)] text-[var(--s-ink)]">
        <header
          className="flex items-center justify-between gap-4 px-5 py-4 @2xl:px-10"
          style={{ borderBottom: st.ornament ? "3px double var(--s-line)" : "1px solid var(--s-line)" }}
        >
          <span className="min-w-0 truncate text-lg @2xl:text-xl" style={heading} data-testid="store-name">
            {config.name}
          </span>
          <nav aria-label="Store pages" className="hidden items-center gap-6 text-sm text-[var(--s-muted)] @2xl:flex">
            <span>Shop</span>
            <span>About</span>
            <span>Contact</span>
          </nav>
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-label="Cart">
            <path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" />
          </svg>
        </header>

        <section className="grid items-center gap-8 px-5 py-10 @2xl:grid-cols-[1.1fr_1fr] @2xl:gap-12 @2xl:px-10 @2xl:py-14">
          <div className="min-w-0">
            <p className="text-[11px] uppercase text-[var(--s-accent-text)]" style={{ letterSpacing: st.caps }}>
              {eyebrow}
            </p>
            <h3 className="mt-3 text-balance text-3xl leading-[1.1] @2xl:text-5xl" style={heading} data-testid="store-headline">
              {config.headline}
            </h3>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--s-muted)]">{config.subhead}</p>
            <span
              className="mt-6 inline-flex items-center bg-[var(--s-accent)] px-5 py-3 text-sm font-medium text-[var(--s-accent-ink)]"
              style={radius}
            >
              {config.cta}
            </span>
          </div>
          <div className="grid aspect-[4/3] grid-cols-3 items-end gap-1 overflow-hidden p-4" style={{ background: "var(--s-tint)", ...radius }} aria-hidden="true">
            {heroArts.map((p, i) => (
              <div key={`${p.art}-${i}`} className="aspect-square w-full">
                <ProductArt kind={p.art} pal={pal} />
              </div>
            ))}
          </div>
        </section>

        <nav aria-label="Categories" className="flex flex-wrap gap-2 px-5 pb-8 @2xl:px-10">
          {config.categories.map((c) => (
            <span key={c} className="border px-3 py-1.5 text-sm" style={{ borderColor: "var(--s-line)", ...radius }}>
              {c}
            </span>
          ))}
        </nav>

        <section className="px-5 pb-10 @2xl:px-10">
          <h4 className="mb-4 text-xl" style={heading}>
            Featured
          </h4>
          <ul className="grid grid-cols-2 gap-3 @2xl:grid-cols-4 @2xl:gap-4">
            {config.products.slice(0, 4).map((p, i) => (
              <li key={`${p.name}-${i}`} className="min-w-0">
                <div className="aspect-square overflow-hidden" style={{ background: "var(--s-tint)", ...radius }}>
                  <ProductArt kind={p.art} pal={pal} />
                </div>
                <p className="mt-2 truncate text-sm">{p.name}</p>
                <p className="text-sm text-[var(--s-muted)]">${p.price}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--s-muted)]">Sample products. Add yours next.</p>
        </section>

        <section aria-label="Shopping with us" className="grid @md:grid-cols-2 @2xl:grid-cols-4" style={{ borderTop: "1px solid var(--s-line)" }}>
          {config.trust.map((t) => (
            <div key={t.title} className="px-5 py-6 @2xl:px-8">
              <span className="mb-3 block h-0.5 w-6 bg-[var(--s-accent)]" />
              <p className="text-sm font-medium">{t.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--s-muted)]">{t.body}</p>
            </div>
          ))}
        </section>

        <footer
          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-6 text-sm text-[var(--s-muted)] @2xl:px-10"
          style={{ borderTop: "1px solid var(--s-line)" }}
        >
          <span style={heading} className="text-[var(--s-ink)]">
            {config.name}
          </span>
          <span>Help · Returns · Contact</span>
        </footer>
      </div>
    </div>
  );
}
