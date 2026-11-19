"use client";

import { useState, type ReactNode } from "react";
import { hexesIn, isFullReview, splitItem, type Review, type ReviewSection } from "@/lib/builder/review-card";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

/** **bold** inside Scout's words. */
function bold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : part,
  );
}

const TOP = /^(headline|subheadline)$/i;
const NOTES = /^(drafted by us|placeholders to fix)$/i;

function Label({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-foreground/55">{children}</p>;
}

function Items({ items, marker }: { items: string[]; marker: "dot" | "ring" }) {
  return (
    <ul className="mt-1.5 space-y-1.5">
      {items.map((item, i) => {
        const { title, rest } = splitItem(item);
        return (
          <li key={i} className="flex gap-2.5 text-md">
            {marker === "dot" ? (
              <span className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/35" aria-hidden="true" />
            ) : (
              <span className="mt-[0.5rem] h-2 w-2 shrink-0 rounded-full border-[1.5px] border-amber-600" aria-hidden="true" />
            )}
            <span className="min-w-0">
              {title ? (
                <>
                  <span className="font-medium text-foreground">{bold(title)}</span>
                  <span className="text-foreground/75">: {bold(rest)}</span>
                </>
              ) : (
                <span className="text-foreground/88">{bold(rest)}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Row({ s }: { s: ReviewSection }) {
  const sections = /^sections$/i.test(s.label) && !s.items.length;
  const swatches = hexesIn(s.text);
  return (
    <div className="px-4 py-3">
      <Label>{s.label}</Label>
      {sections ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sections">
          {s.text.split(/,\s*/).filter(Boolean).map((name) => (
            <li key={name} className="rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-sm text-foreground">
              {name}
            </li>
          ))}
        </ul>
      ) : (
        s.text && (
          <p className="mt-1 flex items-start gap-2 text-md text-foreground">
            {swatches.map((h) => (
              <span key={h} className="mt-[0.2rem] h-4 w-4 shrink-0 rounded-full ring-1 ring-foreground/15" style={{ background: h }} aria-hidden="true" />
            ))}
            <span className="min-w-0">{bold(s.text)}</span>
          </p>
        )
      )}
      {s.items.length > 0 && <Items items={s.items} marker="dot" />}
    </div>
  );
}

/**
 * Scout's review as a card: the headline and subheadline as they will read on the page, each section on its own row, and
 * what we drafted and what is still a placeholder set apart at the foot. On the newest full review the owner can approve
 * with one press; the press sends "Looks good", the same words they could type.
 */
export function ReviewCard({ review, active, onSend }: { review: Review; active: boolean; onSend: (text: string) => void }) {
  const [sent, setSent] = useState(false);
  const full = isFullReview(review);
  const top = review.sections.filter((s) => TOP.test(s.label));
  const notes = review.sections.filter((s) => NOTES.test(s.label));
  const rest = review.sections.filter((s) => !TOP.test(s.label) && !NOTES.test(s.label));
  const headline = top.find((s) => /^headline$/i.test(s.label));
  const sub = top.find((s) => /^subheadline$/i.test(s.label));
  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-foreground/10 bg-white" data-testid="review-card">
      {full && (
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/60">Your site, to review</p>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Draft</span>
        </div>
      )}
      {(headline || sub) && (
        <div className={`px-4 ${full ? "pb-3.5 pt-2" : "py-3.5"}`}>
          {headline && (
            <>
              {!full && <Label>Headline</Label>}
              <p className="text-balance text-xl leading-snug text-foreground" style={{ fontFamily: "var(--font-sora)" }} data-testid="review-headline">
                {bold(headline.text)}
              </p>
            </>
          )}
          {sub && (
            <>
              {!full && <div className="mt-2.5"><Label>Subheadline</Label></div>}
              <p className={`${full ? "mt-1.5" : "mt-0.5"} text-md text-foreground/75`}>{bold(sub.text)}</p>
            </>
          )}
        </div>
      )}
      {rest.length > 0 && (
        <div className="divide-y divide-foreground/10 border-t border-foreground/10">
          {rest.map((s, i) => (
            <Row key={`${s.label}-${i}`} s={s} />
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div className="space-y-3 border-t border-foreground/10 bg-foreground/[0.025] px-4 py-3">
          {notes.map((s, i) => (
            <div key={`${s.label}-${i}`}>
              <Label>{s.label}</Label>
              {s.text && <p className="mt-1 text-md text-foreground/88">{bold(s.text)}</p>}
              {s.items.length > 0 && <Items items={s.items} marker={/placeholder/i.test(s.label) ? "ring" : "dot"} />}
            </div>
          ))}
        </div>
      )}
      {full && active && !sent && (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/10 px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setSent(true);
              onSend("Looks good");
            }}
            className={`rounded-xl bg-foreground px-4 py-2 text-sm text-background ${focusRing}`}
          >
            Looks good
          </button>
          <span className="text-xs text-foreground/65">Or tell me what to change below.</span>
        </div>
      )}
    </div>
  );
}
