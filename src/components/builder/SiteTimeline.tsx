"use client";

import { useEffect, useState } from "react";
import { DONE_STAGE, SITE_STAGES, type StageId } from "@/lib/builder/site-stages";
import type { SiteBuild } from "@/lib/workspace/types";

const SVG = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** One small drawing per stage. Original line art, no icon library. */
function StageIcon({ id, className }: { id: StageId; className?: string }) {
  switch (id) {
    case "ready":
      return (
        <svg {...SVG} className={className}>
          <rect x="6" y="4" width="12" height="17" rx="2" />
          <path d="M9 4h6v3H9zM9 12h6M9 16h4" />
        </svg>
      );
    case "build":
      return (
        <svg {...SVG} className={className}>
          <path d="M13.5 4.5l6 6-3 3-6-6z" />
          <path d="M12.5 9.5L4.5 17.5l2 2 8-8" />
        </svg>
      );
    case "look":
      return (
        <svg {...SVG} className={className}>
          <path d="M18 3l3 3-9 9-3-3z" />
          <path d="M9 12c-3 0-4 2-4 4 0 2-1 3-2 4 3 0 7-1 7-5" />
        </svg>
      );
    case "test":
      return (
        <svg {...SVG} className={className}>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5" />
        </svg>
      );
    case "online":
      return (
        <svg {...SVG} className={className}>
          <path d="M12 3c3 2 5 5 5 9l-2 3H9l-2-3c0-4 2-7 5-9z" />
          <circle cx="12" cy="10" r="1.5" />
          <path d="M9 15l-2 4M15 15l2 4M12 17v4" />
        </svg>
      );
    case "done":
      return (
        <svg {...SVG} className={className}>
          <circle cx="12" cy="12" r="9" />
          <path d="M7.5 12.5l3 3 6-6.5" />
        </svg>
      );
  }
}

type Status = "done" | "active" | "waiting" | "failed";

function statusOf(i: number, b: SiteBuild): Status {
  if (b.failedStage === i) return "failed";
  if (b.stage >= DONE_STAGE) return "done";
  if (b.failedStage !== undefined) return i < b.failedStage ? "done" : "waiting";
  if (i < b.stage) return "done";
  if (i === b.stage) return "active";
  return "waiting";
}

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

/** The vertical progress view for a website build: one icon per stage, joined by a dotted line. */
export default function SiteTimeline({ build, siteName }: { build: SiteBuild; siteName: string }) {
  const [now, setNow] = useState(() => Date.now());
  const running = build.stage < DONE_STAGE && build.failedStage === undefined;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [running]);

  const mins = minutesSince(build.startedAt, build.finishedAt ? new Date(build.finishedAt).getTime() : now);
  // No heartbeat yet means no builder has picked the job up. A heartbeat that stopped means the builder did.
  const sinceBeat = (now - new Date(build.heartbeatAt ?? build.startedAt).getTime()) / 1000;
  const waiting = running && !build.heartbeatAt && sinceBeat > 20;
  const silent = running && Boolean(build.heartbeatAt) && sinceBeat > 90;

  return (
    <div data-testid="site-timeline">
      <p className="text-lg text-foreground">{build.stage >= DONE_STAGE ? `${siteName} is ready` : build.failedStage !== undefined ? "The build stopped" : `Building ${siteName}`}</p>
      {running && <p className="mt-0.5 text-sm text-foreground/60">Usually takes about half an hour.</p>}
      {waiting && <p className="mt-3 rounded-xl bg-[#fff4d6] p-3 text-sm text-[#6b4e00]" data-testid="waiting">Waiting for a free builder. If someone else is building, yours starts when they finish.</p>}
      {silent && <p className="mt-3 rounded-xl bg-[#fff4d6] p-3 text-sm text-[#6b4e00]" data-testid="silent">No update for a while. The builder may have stopped. If nothing changes in a few minutes, check back later.</p>}

      <ol className="mt-6" aria-label="Build progress">
        {SITE_STAGES.map((st, i) => {
          const status = statusOf(i, build);
          const last = i === SITE_STAGES.length - 1;
          const color = status === "done" ? "text-[#1b6b3a]" : status === "failed" ? "text-[#b3261e]" : status === "active" ? "text-foreground" : "text-foreground/30";
          const ring = status === "active" ? "ring-2 ring-foreground/15" : "";
          const nextDone = i < build.stage || build.stage >= DONE_STAGE;
          return (
            <li key={st.id} className="relative grid grid-cols-[2.5rem_1fr] gap-3 pb-7 last:pb-0" aria-label={`${st.label}: ${status === "done" ? "done" : status === "active" ? "in progress" : status === "failed" ? "stopped here" : "waiting"}`}>
              {!last && (
                <span
                  className={`tl-line absolute left-5 top-10 bottom-0 w-0.5 -translate-x-1/2 ${nextDone ? "text-[#1b6b3a]/60" : status === "active" ? "tl-line-active text-foreground/50" : "text-foreground/20"}`}
                  aria-hidden="true"
                />
              )}
              <span className={`relative z-10 grid h-10 w-10 place-items-center rounded-full border bg-white ${ring} ${status === "waiting" ? "border-foreground/15" : status === "failed" ? "border-[#b3261e]/50" : status === "done" ? "border-[#1b6b3a]/40" : "border-foreground/40"} ${color}`}>
                <StageIcon id={st.id} className={`h-5 w-5 ${status === "active" ? `tl-anim-${st.id}` : st.id === "done" && status === "done" ? "tl-anim-done" : ""}`} />
                {status === "done" && st.id !== "done" && (
                  <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-[#1b6b3a] text-white">
                    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                )}
              </span>
              <div className="min-w-0 pt-1.5">
                <p className={`text-sm ${status === "waiting" ? "text-foreground/45" : "text-foreground"}`}>{st.label}</p>
                {status === "active" && (
                  <p className="mt-0.5 text-sm text-foreground/60">
                    {st.blurb}
                    {st.id === "build" && build.files > 0 && ` Working for ${mins} min · ${build.files} files written.`}
                  </p>
                )}
                {status === "failed" && <p className="mt-0.5 text-sm text-[#b3261e]">{build.error || "Something went wrong at this step."}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {running && (
        <p className="mt-6 rounded-xl bg-foreground/[0.04] p-3 text-sm leading-relaxed text-foreground/70" data-testid="step-away-site">
          You can close this window and come back. The build keeps running.
          {build.notifyEmail ? ` You'll get an email at ${build.notifyEmail} when your site is ready.` : " Your project will be waiting under Your projects."}
        </p>
      )}
      {build.stage >= DONE_STAGE && build.fake && (
        <p className="mt-6 rounded-xl bg-foreground/[0.04] p-3 text-sm text-foreground/70">Practice run: the stages ran, but no site was built.</p>
      )}
      {build.stage >= DONE_STAGE && build.url && (
        <p className="mt-6 text-sm">
          <a href={build.url} className="rounded-full bg-foreground px-4 py-2 text-background" target="_blank" rel="noreferrer">Open your site</a>
        </p>
      )}
    </div>
  );
}
