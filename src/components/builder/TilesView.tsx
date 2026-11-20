"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TileChecks } from "@/lib/builder/tile-checks";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";
const WIDTH = { desktop: 1280, phone: 390 } as const;
const DEVICE_LABEL = { desktop: "Desktop", phone: "Phone" } as const;
const deviceIcon = (body: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {body}
  </svg>
);
/** The width toggle shows icons only; the name and width are in the button's label and tooltip. */
const DEVICE_ICON = {
  desktop: deviceIcon(
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>,
  ),
  phone: deviceIcon(
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>,
  ),
};
/** The pages of the design. One for now; more pages are added here as the tile learns to draw them. */
const PAGES = [{ id: "home", label: "Home page" }] as const;

type Got = { tile: { html: string | null; checks: TileChecks | null; renderedAt: string; error: string | null } | null; stale?: boolean; why: string | null };

/**
 * The visual design for a project (the style tile, APP-43, admin only), one page at a time: drawn in a frame that really is 1280 or 390 pixels wide, so the
 * page's own container queries apply. Desktop is scaled down to fit the pane. The frame runs no scripts.
 */
export default function TilesView({ projectId }: { projectId: string }) {
  const [got, setGot] = useState<Got | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<keyof typeof WIDTH>("desktop");
  const [rendering, setRendering] = useState(false);
  const [page, setPage] = useState<(typeof PAGES)[number]["id"]>("home");
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const load = useCallback(async () => {
    setError(null);
    const r = await fetch(`/api/projects/${projectId}/tile`, { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) return setError("Could not load the tile.");
    setGot(await r.json());
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [got]);

  const render = async () => {
    setRendering(true);
    setError(null);
    const r = await fetch(`/api/projects/${projectId}/tile`, { method: "POST" }).catch(() => null);
    if (!r || !r.ok) setError(((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not render the tile.");
    await load();
    setRendering(false);
  };

  const tile = got?.tile ?? null;
  /** A tile that was drawn, has not gone stale and did not fail: rendering again would draw the same page. */
  const upToDate = !!tile?.html && !tile.error && got?.stale === false;
  const width = WIDTH[device];
  // Both frames keep their real width; on a pane narrower than that (a phone), the frame is scaled down to fit.
  const pad = device === "phone" ? 24 : 0;
  const scale = size.w ? Math.min(1, (size.w - pad) / width) : 1;
  const frameH = size.h ? Math.round((size.h - pad) / scale) : 800;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="tiles-view">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground/10 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {tile && (got?.stale ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800" data-testid="tile-stale">Stale</span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">Up to date</span>
          ))}
          {tile?.checks && (
            <span className={`rounded-full px-2 py-0.5 ${tile.checks.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              {tile.checks.checks.filter((c) => c.ok).length} of {tile.checks.checks.length} checks pass
            </span>
          )}
          {tile && <span className="text-foreground/60">Drawn {new Date(tile.renderedAt).toLocaleString()}</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* Drawing is code only, so an up-to-date tile would come out the same: the button waits for something new. */}
          {upToDate && !rendering && (
            <span id="render-why" className="text-xs text-foreground/60">
              Up to date, nothing new to draw
            </span>
          )}
          <button
            type="button"
            onClick={render}
            disabled={rendering || upToDate}
            aria-describedby={upToDate ? "render-why" : undefined}
            className={`rounded-full border border-foreground/15 px-3 py-1 text-xs text-foreground/88 hover:border-foreground/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-foreground/15 ${focusRing}`}
            data-testid="render-tile"
          >
            {rendering ? "Rendering…" : "Render tile"}
          </button>
          <div role="group" aria-label="Tile width" className="inline-flex rounded-full bg-foreground/[0.06] p-0.5">
            {(["desktop", "phone"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={device === d}
                onClick={() => setDevice(d)}
                aria-label={`${DEVICE_LABEL[d]}, ${WIDTH[d]} pixels wide`}
                title={`${DEVICE_LABEL[d]} (${WIDTH[d]} px)`}
                className={`inline-flex items-center justify-center rounded-full px-3 py-1.5 ${focusRing} ${device === d ? "bg-white text-foreground shadow-sm" : "text-foreground/72 hover:text-foreground"}`}
                data-testid={`device-${d}`}
              >
                {DEVICE_ICON[d]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(error || got?.why || tile?.error) && (
        <p className="border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2 text-xs text-foreground/80" role="status">
          {error ?? tile?.error ?? got?.why}
        </p>
      )}

      {tile?.checks && (
        <details className="border-b border-foreground/10 px-4 py-2 text-xs">
          <summary className="cursor-pointer text-foreground/80">Checks</summary>
          <ul className="mt-2 space-y-1">
            {tile.checks.checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className={c.ok ? "text-emerald-700" : "text-red-700"}>{c.ok ? "Pass" : "Fail"}</span>
                <span>
                  <span className="text-foreground">{c.id}. {c.name}.</span> <span className="text-foreground/70">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div role="tablist" aria-label="Pages" className="flex gap-1 border-b border-foreground/10 px-4 pt-2">
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={page === p.id}
            onClick={() => setPage(p.id)}
            className={`-mb-px border-b-2 px-2 pb-2 text-sm ${focusRing} ${page === p.id ? "border-foreground text-foreground" : "border-transparent text-foreground/65 hover:text-foreground"}`}
            data-testid={`page-${p.id}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div ref={box} role="tabpanel" aria-label={PAGES.find((p) => p.id === page)?.label} className="relative min-h-0 flex-1 overflow-hidden bg-foreground/[0.04]">
        {tile?.html ? (
          <div className={device === "phone" ? "flex h-full justify-center pt-3" : "h-full"}>
            <div style={{ width: width * scale, height: frameH * scale }} className={device === "phone" ? "overflow-hidden rounded-t-3xl border border-b-0 border-foreground/15 shadow-sm" : ""}>
              <iframe
                title={`Visual design, ${PAGES.find((p) => p.id === page)?.label}, ${device}`}
                srcDoc={tile.html}
                sandbox=""
                data-testid="tile-frame"
                style={{ width, height: frameH, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0 }}
              />
            </div>
          </div>
        ) : (
          !error && !got?.why && <p className="p-5 text-sm text-foreground/60">Loading…</p>
        )}
      </div>
    </div>
  );
}
