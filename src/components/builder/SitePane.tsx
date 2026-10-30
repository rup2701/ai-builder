"use client";

import { briefCard } from "@/lib/builder/site-brief";
import type { WorkspaceState } from "@/lib/workspace/types";

/** The right-hand side for a website project: the brief as the interview saved it, until the site is built. */
export default function SitePane({ st, projectId, busy, visible }: { st: WorkspaceState; projectId: string; busy: boolean; visible: boolean }) {
  const brief = st.site?.brief;
  const c = brief ? briefCard(brief) : null;
  return (
    <section aria-label="Website brief" className={`${visible ? "flex" : "hidden"} min-h-0 flex-col overflow-hidden rounded-3xl border border-foreground/10 bg-white lg:flex`} data-testid="site-pane">
      <div className="flex items-center justify-between gap-2 border-b border-foreground/10 px-4 py-2.5">
        <p className="text-sm text-foreground/60">Your brief</p>
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
        {!c ? (
          <p className="grid min-h-48 place-items-center text-center text-foreground/50">
            {busy ? "Thinking…" : "Your brief appears here once we have talked your idea through."}
          </p>
        ) : (
          <div className="space-y-5" data-testid="brief-card">
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
            <p className="rounded-xl bg-foreground/[0.04] p-3 text-foreground/70">
              Next: the site gets built from this brief and published. Building from the chat is the next step we add.
            </p>
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
