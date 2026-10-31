"use client";

import { briefCard } from "@/lib/builder/site-brief";
import SiteTimeline from "./SiteTimeline";
import { DONE_STAGE } from "@/lib/builder/site-stages";
import type { WorkspaceState } from "@/lib/workspace/types";

/** The side panel for a website project: the brief as the interview saved it, until the site is built. */
export default function SitePane({ st, projectId, busy, visible, onBuild, starting }: { st: WorkspaceState; projectId: string; busy: boolean; visible: boolean; onBuild: () => void; starting: boolean }) {
  const brief = st.site?.brief;
  const c = brief ? briefCard(brief) : null;
  const build = st.site?.build;
  const running = st.phase === "build" || st.phase === "verify";
  const canBuild = Boolean(c) && !running && !starting;
  const kind = (brief?.site as { kind?: string } | undefined)?.kind;
  const buildLabel = kind === "waitlist" ? "Build my waitlist site" : "Build my site";
  const finishedForReal = Boolean(build && build.stage >= DONE_STAGE && !build.fake);
  const buildButton = (label: string) => (
    <button
      type="button"
      onClick={onBuild}
      disabled={!canBuild}
      className="rounded-full bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      data-testid="build-site"
    >
      {starting ? "Starting…" : label}
    </button>
  );
  return (
    <section aria-label="Website brief" className={`${visible ? "flex" : "hidden"} min-h-0 flex-col overflow-hidden rounded-3xl border border-foreground/10 bg-white lg:flex`} data-testid="site-pane">
      <div className="flex items-center justify-between gap-2 border-b border-foreground/10 px-4 py-2.5">
        <p className="text-sm text-foreground/60">{build ? "Your site" : "Your brief"}</p>
        {c && (
          <a
            href={`/api/projects/${projectId}/brief`}
            className="rounded-full border border-foreground/15 px-3 py-1 text-xs text-foreground/80 hover:border-foreground/50"
          >
            Download (JSON)
          </a>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 text-sm leading-relaxed">
        {build && c ? (
          <div>
            <SiteTimeline build={build} siteName={c.name || "your site"} />
            {!running && !finishedForReal && <div className="mt-6">{buildButton(build.failedStage !== undefined ? "Try again" : buildLabel)}</div>}
            <details className="mt-8 border-t border-foreground/10 pt-4">
              <summary className="cursor-pointer text-sm text-foreground/60">Your brief</summary>
              <div className="mt-4 space-y-5">{briefBody(c)}</div>
            </details>
          </div>
        ) : !c ? (
          <p className="grid min-h-48 place-items-center text-center text-foreground/50">
            {busy ? "Thinking…" : "Your brief appears here once we have talked your idea through."}
          </p>
        ) : (
          <div className="space-y-5" data-testid="brief-card">
            {briefBody(c)}
            <div className="rounded-xl bg-foreground/[0.04] p-4">
              <p className="text-foreground/70">When the brief looks right, build the site. It takes about half an hour, and you can close this window while it runs.</p>
              <div className="mt-3">{buildButton(buildLabel)}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-xs uppercase tracking-wide text-foreground/45">{label}</p>
      <div className="text-foreground/80">{children}</div>
    </div>
  );
}

function briefBody(c: ReturnType<typeof briefCard>) {
  return (
    <>
      <div>
        <p className="text-lg text-foreground">{c.name}</p>
        {c.oneLiner && <p className="text-foreground/70">{c.oneLiner}</p>}
      </div>
      <Part label="For">{c.audience}</Part>
      {c.goal && <Part label="Goal">{c.goal}</Part>}
      <Part label="Headline">
        <span className="text-foreground">{c.headline}</span>
        {c.subheadline && <span className="block text-foreground/70">{c.subheadline}</span>}
        {c.button && <span className="mt-1 block text-foreground/60">Button: {c.button}{c.note ? ` · ${c.note}` : ""}</span>}
      </Part>
      {c.tools.length > 0 && <Part label={c.toolsHeading || "Works with"}>{c.tools.join(", ")}</Part>}
      {c.benefits.length > 0 && (
        <Part label="Benefits">
          <ul className="space-y-1">
            {c.benefits.map((b) => (
              <li key={b.title}><span className="text-foreground">{b.title}.</span> <span className="text-foreground/70">{b.text}</span></li>
            ))}
          </ul>
        </Part>
      )}
      {c.fields.length > 0 && <Part label="Sign-up form">{c.fields.join(", ")}</Part>}
      {c.perks.length > 0 && <Part label="Perks">{c.perks.join(" · ")}</Part>}
      {c.look && <Part label="Look">{c.look}</Part>}
      {c.unconfirmed.length > 0 && (
        <Part label="Check before you share it">
          <ul className="list-disc space-y-0.5 pl-5">{c.unconfirmed.map((u) => <li key={u}>{u}</li>)}</ul>
        </Part>
      )}
    </>
  );
}
