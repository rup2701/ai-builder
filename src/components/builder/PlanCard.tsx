"use client";

import { useState } from "react";
import { isLocked, planReply, type Plan } from "@/lib/builder/plan-card";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

/** Scout's page plan as a card: a checkmark per section. Only the newest plan can be changed; the choices go back as one message. */
export function PlanCard({ plan, active, onSend }: { plan: Plan; active: boolean; onSend: (text: string) => void }) {
  const [on, setOn] = useState<Set<string>>(() => new Set(plan.added));
  const [sent, setSent] = useState(false);
  const live = active && !sent;
  const toggle = (name: string) => {
    if (!live || isLocked(name)) return;
    setOn((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const row = (name: string) => {
    const locked = isLocked(name);
    const checked = on.has(name);
    return (
      <li key={name}>
        <label className={`flex items-center gap-3 rounded-xl px-3 py-2 text-md ${live && !locked ? "cursor-pointer hover:bg-foreground/[0.04]" : ""}`}>
          <input
            type="checkbox"
            checked={checked}
            disabled={!live || locked}
            onChange={() => toggle(name)}
            className={`h-4 w-4 shrink-0 accent-foreground ${focusRing}`}
          />
          <span className={checked ? "text-foreground" : "text-foreground/55"}>{name}</span>
          {locked && <span className="ml-auto text-xs text-foreground/45">always included</span>}
        </label>
      </li>
    );
  };
  return (
    <div className="mt-2 rounded-2xl border border-foreground/10 bg-white p-3" data-testid="plan-card">
      <p className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-foreground/50">Your page</p>
      <ul>{plan.added.map(row)}</ul>
      <p className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-foreground/50">More sections to add</p>
      <ul>{plan.extra.map(row)}</ul>
      {live ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 px-3 pb-1 pt-2">
          <button
            type="button"
            onClick={() => {
              setSent(true);
              onSend(planReply(plan, on));
            }}
            className={`rounded-xl bg-foreground px-4 py-2 text-sm text-background ${focusRing}`}
          >
            Looks good
          </button>
          <span className="text-xs text-foreground/55">Or type a section of your own below.</span>
        </div>
      ) : null}
    </div>
  );
}
