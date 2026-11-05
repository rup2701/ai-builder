"use client";

import type { Msg } from "@/lib/workspace/types";

type ChangeMsg = Extract<Msg, { kind: "site_change" }>;

type Props = {
  msg: ChangeMsg;
  projectId: string;
  siteUrl?: string;
  busy: boolean;
  onConfirm: (id: number) => void;
  onCancel: (id: number) => void;
};

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

/** One change to the live site, as it moves from proposed to done. Shows the picture from before and after when the worker took them. */
export default function SiteChangeCard({ msg, projectId, siteUrl, busy, onConfirm, onCancel }: Props) {
  const pic = (which: "before" | "after") => `/api/projects/${projectId}/snapshot?msg=${msg.id}&which=${which}`;

  if (msg.status === "cancelled") {
    return <p className="text-sm text-foreground/50">Cancelled: “{msg.instruction}”</p>;
  }

  return (
    <div data-testid="site-change" data-status={msg.status} className="max-w-[92%] rounded-2xl border border-foreground/10 bg-white p-4">
      {msg.status === "proposed" && (
        <>
          <p className="text-sm font-medium text-foreground">I’ll change your live site</p>
          <p className="mt-1.5 rounded-xl bg-foreground/[0.04] px-3 py-2 text-sm leading-relaxed text-foreground">{msg.instruction}</p>
          <p className="mt-2 text-xs leading-relaxed text-foreground/60">It goes live when it’s done and takes a few minutes. If it doesn’t pass its checks I undo it, and your site stays as it is.</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(msg.id)}
              className={`rounded-xl bg-foreground px-4 py-2 text-sm text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
            >
              Make this change
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onCancel(msg.id)}
              className={`rounded-xl border border-foreground/20 px-4 py-2 text-sm text-foreground transition-colors hover:bg-foreground/[0.05] disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {(msg.status === "queued" || msg.status === "working") && (
        <div role="status" aria-live="polite">
          <p className="text-sm font-medium text-foreground">{msg.status === "queued" ? "Waiting to start…" : "Making the change…"}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/70">{msg.instruction}</p>
          <p className="mt-2 text-xs text-foreground/60">This takes a few minutes. You can close this tab; I’ll keep going.</p>
        </div>
      )}

      {msg.status === "failed" && (
        <div role="alert">
          <p className="text-sm font-medium text-foreground">That change didn’t work</p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/70">{msg.error ?? "Something went wrong."}</p>
          <p className="mt-2 text-xs text-foreground/60">Your live site is the way it was. You can ask again, in different words if you like.</p>
        </div>
      )}

      {msg.status === "done" && (
        <>
          <p className="text-sm font-medium text-foreground">Your site is updated</p>
          {msg.summary && <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">{msg.summary}</p>}
          {msg.snaps && (msg.snaps.before || msg.snaps.after) && (
            <div className="mt-3 space-y-3">
              {msg.snaps.before && (
                <figure>
                  <figcaption className="mb-1 text-xs text-foreground/60">Before</figcaption>
                  <a href={pic("before")} target="_blank" rel="noopener noreferrer" className={`block overflow-hidden rounded-xl border border-foreground/10 ${focusRing}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pic("before")} alt="The section before the change" className="block w-full" loading="lazy" />
                  </a>
                </figure>
              )}
              {msg.snaps.after && (
                <figure>
                  <figcaption className="mb-1 text-xs text-foreground/60">After</figcaption>
                  <a href={pic("after")} target="_blank" rel="noopener noreferrer" className={`block overflow-hidden rounded-xl border border-foreground/10 ${focusRing}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pic("after")} alt="The section after the change" className="block w-full" loading="lazy" />
                  </a>
                </figure>
              )}
              <p className="text-xs text-foreground/50">Click a picture to see it full size.</p>
            </div>
          )}
          {siteUrl && (
            <a href={siteUrl} target="_blank" rel="noopener noreferrer" className={`mt-3 inline-block text-sm underline underline-offset-4 hover:no-underline ${focusRing}`}>
              Open your live site ↗
            </a>
          )}
        </>
      )}
    </div>
  );
}
