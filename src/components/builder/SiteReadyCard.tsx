"use client";

import { useState } from "react";

type Props = {
  name: string;
  url: string;
  adminUrl: string;
  ownerEmail: string;
  password?: string;
  checks: string[];
  onSaved: () => Promise<void>;
};

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const EYE = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z";
const EYE_OFF = "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.6A17 17 0 0 0 2 12s3.5 6 10 6a9.7 9.7 0 0 0 4-.8M9.9 9.9a3 3 0 0 0 4.2 4.2";
const COPY = "M8 8h11v13H8zM5 16H4V3h11v1";
const CHECK = "M5 12l5 5 9-10";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard can be blocked; the text is still on screen */
        }
      }}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground ${focusRing}`}
    >
      <Icon d={done ? CHECK : COPY} />
    </button>
  );
}

/** The result of a finished website build: the address, the owner sign-in with the password, and what to check. */
export default function SiteReadyCard({ name, url, adminUrl, ownerEmail, password, checks, onSaved }: Props) {
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  async function saved() {
    setSaving(true);
    try {
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  const row = "grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 py-2.5";

  return (
    <div className="rounded-2xl border border-foreground/10 p-4" data-testid="site-ready">
      <p className="flex items-center gap-2 text-base font-semibold text-foreground">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-[#1b6b3a] text-white" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d={CHECK} />
          </svg>
        </span>
        {name} is live
      </p>

      <dl className="mt-2 divide-y divide-foreground/10 text-sm">
        <div className={row}>
          <dt className="font-semibold text-foreground">Your site</dt>
          <dd className="min-w-0 break-all">
            <a href={url} target="_blank" rel="noreferrer" className={`rounded underline underline-offset-2 ${focusRing}`}>
              {url.replace(/^https:\/\//, "")}
            </a>
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold text-foreground">Owner area</dt>
          <dd className="min-w-0 break-all">
            <a href={adminUrl} target="_blank" rel="noreferrer" className={`rounded underline underline-offset-2 ${focusRing}`}>
              {adminUrl.replace(/^https:\/\//, "")}
            </a>
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold text-foreground">Sign in with</dt>
          <dd className="flex min-w-0 items-center justify-between gap-1">
            <span className="truncate">{ownerEmail}</span>
            <CopyButton value={ownerEmail} label="Copy email" />
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold text-foreground">Password</dt>
          <dd className="min-w-0">
            {password ? (
              <span className="flex items-center justify-between gap-1">
                <span className="truncate font-mono text-[13px]" data-testid="site-password">
                  {show ? password : "•".repeat(Math.min(password.length, 16))}
                </span>
                <span className="flex shrink-0">
                  <button
                    type="button"
                    aria-pressed={show}
                    aria-label={show ? "Hide password" : "Show password"}
                    title={show ? "Hide password" : "Show password"}
                    onClick={() => setShow((v) => !v)}
                    className={`grid h-8 w-8 place-items-center rounded-lg text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground ${focusRing}`}
                  >
                    <Icon d={show ? EYE_OFF : EYE} />
                  </button>
                  <CopyButton value={password} label="Copy password" />
                </span>
              </span>
            ) : (
              <span className="text-foreground/60">Removed from this page</span>
            )}
          </dd>
        </div>
      </dl>

      {password ? (
        <div className="mt-1 rounded-xl bg-foreground/[0.04] p-3 text-sm">
          <p className="font-semibold text-foreground">Save the password now.</p>
          <p className="mt-0.5 text-foreground/70">A password manager is best. When you have saved it, I'll remove it from this page.</p>
          <button
            type="button"
            onClick={saved}
            disabled={saving}
            className={`mt-2 rounded-xl bg-foreground px-3.5 py-1.5 text-sm text-background disabled:opacity-50 ${focusRing}`}
          >
            I've saved it
          </button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-foreground/55">The password is not kept here. If you lose it, a new one can be set.</p>
      )}

      {checks.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-foreground">Check these before you share it</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm leading-relaxed text-foreground/85">
            {checks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
