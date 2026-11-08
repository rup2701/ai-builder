"use client";

import { useState } from "react";
import type { Msg } from "@/lib/workspace/types";
import { MAX_REVISIONS } from "@/lib/builder/site-change";

type ChangeMsg = Extract<Msg, { kind: "site_change" }>;

export type ChangeAction = { text: string } | { confirm: number } | { cancel: number } | { approve: number } | { revise: number; text: string } | { remove: number } | { undo: number };

type Props = {
  msg: ChangeMsg;
  projectId: string;
  siteUrl?: string;
  busy: boolean;
  onAction: (body: ChangeAction) => void;
};

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";
const primary = `rounded-xl bg-foreground px-4 py-2 text-sm text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;
const secondary = `rounded-xl border border-foreground/20 px-4 py-2 text-sm text-foreground transition-colors hover:bg-foreground/[0.05] disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;
const danger = `rounded-xl border border-red-600 px-4 py-2 text-sm text-foreground transition-colors hover:bg-red-600/10 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;

/** One change to the live site, from the request to the preview to "live". Shows the pictures from before and after when the worker took them. */
export default function SiteChangeCard({ msg, projectId, siteUrl, busy, onAction }: Props) {
  const [asking, setAsking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const pic = (which: "before" | "after") => `/api/projects/${projectId}/snapshot?msg=${msg.id}&which=${which}`;

  if (msg.status === "cancelled") return <p className="text-md text-foreground/50">Cancelled. Nothing was changed on your site.</p>;
  if (msg.status === "removed") return <p className="text-md text-foreground/60">Removed: “{msg.title ?? msg.instruction}”. Your site is as it was.</p>;

  const live = msg.status === "done";
  const pictures =
    msg.snaps && (msg.snaps.before || msg.snaps.after) ? (
      <div className="mt-3 space-y-3">
        {msg.snaps.before && (
          <figure>
            <figcaption className="mb-1 text-xs text-foreground/60">{live ? "Before" : "Before (your live site)"}</figcaption>
            <a href={pic("before")} target="_blank" rel="noopener noreferrer" className={`block overflow-hidden rounded-xl border border-foreground/10 ${focusRing}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pic("before")} alt="The section before the change" className="block w-full" loading="lazy" />
            </a>
          </figure>
        )}
        {msg.snaps.after && (
          <figure>
            <figcaption className="mb-1 text-xs text-foreground/60">{live ? "After" : "After (preview, not live yet)"}</figcaption>
            <a href={pic("after")} target="_blank" rel="noopener noreferrer" className={`block overflow-hidden rounded-xl border border-foreground/10 ${focusRing}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pic("after")} alt="The section after the change" className="block w-full" loading="lazy" />
            </a>
          </figure>
        )}
        <p className="text-xs text-foreground/50">Click a picture to see it full size.</p>
      </div>
    ) : null;

  return (
    <div data-testid="site-change" data-status={msg.status} className="max-w-[92%] rounded-2xl border border-foreground/10 bg-white p-4">
      {msg.status === "proposed" && (
        <>
          <p className="text-md font-medium text-foreground">{msg.title ?? "I’ll change your site"}</p>
          {msg.changes?.length ? (
            <ul className="mt-1.5 list-disc space-y-1 rounded-xl bg-foreground/[0.04] py-2 pl-7 pr-3 text-md leading-relaxed text-foreground">
              {msg.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 line-clamp-6 whitespace-pre-line rounded-xl bg-foreground/[0.04] px-3 py-2 text-md leading-relaxed text-foreground">{msg.instruction}</p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-foreground/60">
            {msg.size === "small"
              ? "This is a small wording change, so it goes live as soon as it is made. You can undo it afterwards."
              : "I’ll make the change and show you a preview. Nothing goes live until you approve it."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => onAction({ confirm: msg.id })} className={primary}>
              Make this change
            </button>
            <button type="button" disabled={busy} onClick={() => onAction({ cancel: msg.id })} className={secondary}>
              Cancel
            </button>
          </div>
        </>
      )}

      {(msg.status === "queued" || msg.status === "working") && (
        <div role="status" aria-live="polite">
          <p className="text-md font-medium text-foreground">
            {msg.action === "discard" ? (msg.published ? "Undoing the change…" : "Removing the change…") : msg.status === "queued" ? "Waiting to start…" : msg.feedback ? "Revising the change…" : "Making the change…"}
          </p>
          {!msg.feedback && msg.changes?.length ? (
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-md leading-relaxed text-foreground/70">
              {msg.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-md leading-relaxed text-foreground/70">{msg.feedback ?? msg.instruction}</p>
          )}
          {msg.action !== "discard" && <p className="mt-2 text-xs text-foreground/60">This takes a few minutes. You can close this tab; I’ll keep going.</p>}
        </div>
      )}

      {msg.status === "publishing" && (
        <div role="status" aria-live="polite">
          <p className="text-md font-medium text-foreground">
            {msg.phase === "repairing" ? "A check found a problem. Fixing it, then checking again…" : msg.phase === "deploying" ? "Checks passed. Making it permanent on your live site…" : "Approved. Checking it before it goes live…"}
          </p>
          <p className="mt-2 text-xs text-foreground/60">This takes a few minutes. You can keep working while we make the change permanent, or close this tab. I’ll tell you here if anything needs your attention.</p>
        </div>
      )}

      {msg.status === "failed" && (
        <div role="alert">
          <p className="text-md font-medium text-foreground">That change didn’t work</p>
          <p className="mt-1.5 text-md leading-relaxed text-foreground/70">{msg.error ?? "Something went wrong."}</p>
          <p className="mt-2 text-xs text-foreground/60">Your live site is the way it was. You can ask again, in different words if you like.</p>
        </div>
      )}

      {msg.status === "review" && (
        <>
          <p className="text-md font-medium text-foreground">Here’s the change. It isn’t live yet.</p>
          {msg.note && (
            <p role="status" className="mt-2 rounded-xl bg-foreground/[0.05] px-3 py-2 text-xs leading-relaxed text-foreground/80">
              {msg.note}
            </p>
          )}
          {pictures}
          {!asking ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy} onClick={() => onAction({ approve: msg.id })} className={primary}>
                Approve and publish
              </button>
              <button type="button" disabled={busy || (msg.revisions ?? 0) >= MAX_REVISIONS} onClick={() => setAsking(true)} className={secondary}>
                Ask for changes
              </button>
              <button type="button" disabled={busy} onClick={() => onAction({ remove: msg.id })} className={secondary}>
                Remove this change
              </button>
            </div>
          ) : (
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                const text = feedback.trim();
                if (text.length < 5) return;
                setAsking(false);
                setFeedback("");
                onAction({ revise: msg.id, text });
              }}
            >
              <label htmlFor={`feedback-${msg.id}`} className="text-xs text-foreground/60">
                What should be different? (Round {(msg.revisions ?? 0) + 1} of {MAX_REVISIONS})
              </label>
              <textarea
                id={`feedback-${msg.id}`}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                maxLength={2000}
                autoFocus
                className="mt-1.5 block w-full resize-none rounded-xl border border-foreground/20 bg-transparent px-3 py-2 text-base leading-snug outline-none focus:border-foreground"
              />
              <div className="mt-2 flex items-center gap-2">
                <button type="submit" disabled={busy || feedback.trim().length < 5} className={primary}>
                  Send
                </button>
                <button type="button" onClick={() => setAsking(false)} className={secondary}>
                  Back
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {msg.status === "done" && (
        <>
          <p className="text-md font-medium text-foreground">Published</p>
          {msg.note && <p className="mt-1.5 text-md leading-relaxed text-foreground/70">{msg.note}</p>}
          {msg.summary && msg.summary !== "The change is ready." ? (
            <p className="mt-1.5 text-md leading-relaxed text-foreground/70">{msg.summary}</p>
          ) : msg.changes?.length ? (
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-md leading-relaxed text-foreground/70">
              {msg.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
          {(siteUrl || msg.published) && (
            <div className="mt-4 flex items-center justify-between gap-3">
              {siteUrl ? (
                <a href={siteUrl} target="_blank" rel="noopener noreferrer" className={`inline-block text-sm underline underline-offset-4 hover:no-underline ${focusRing}`}>
                  Open your live site ↗
                </a>
              ) : (
                <span />
              )}
              {msg.published && (
                <button type="button" disabled={busy} onClick={() => onAction({ undo: msg.id })} className={danger}>
                  Undo this change
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
