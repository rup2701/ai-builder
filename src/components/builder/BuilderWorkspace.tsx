"use client";

/**
 * The builder workspace: live store preview on the left, chat on the right.
 *
 *   Build    reads the idea and drafts the store
 *   Verify   runs the checks
 *   Iterate  the owner asks for changes in chat; checks re-run after every change
 *   Publish  opens once nothing is failing
 *
 * State lives on the server (projects.state). Intake turns and builds go through the API and the
 * worker; once the store exists, chat changes run here and are saved back through the state API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import StorePreview from "./StorePreview";
import SitePane from "./SitePane";
import SiteReadyCard from "./SiteReadyCard";
import { summarize, verify, type Check } from "@/lib/builder/verify";
import { accentHex } from "@/lib/builder/interpret";
import { BUILD_STEPS, iterateTurn, optionsFor, pushMsg, undoState } from "@/lib/workspace/state";
import type { StoreConfig } from "@/lib/builder/storeConfig";
import type { WorkspaceState } from "@/lib/workspace/types";
import { AGENT_NAME } from "@/lib/brand";

type Props = {
  projectId: string;
  initial: WorkspaceState;
  homeHref: string;
  publishNote?: string;
  /** "site" runs the website interview; the default is the store builder. */
  kind?: "store" | "site";
};

type StepState = "todo" | "active" | "done";


const STEP_LABELS = ["Build", "Verify", "Iterate", "Publish"];
const ROLES = ["Store owner", "Investor", "Just exploring"];

const SUGGESTIONS: { label: string; send?: string; fill?: string }[] = [
  { label: "Rename it", fill: "Rename it to " },
  { label: "Sage green", send: "Use sage green" },
  { label: "More modern", send: "Make it more modern" },
  { label: "Warmer tone", send: "Make the tone warmer" },
  { label: "Dark mode", send: "Dark mode" },
  { label: "Undo", send: "undo" },
];

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

/* ---------- Small pieces ---------- */

const STATUS_STYLE = {
  pass: { color: "text-[#1b6b3a]", word: "Passed", path: "M5 12.5l4.5 4.5L19 7.5" },
  warn: { color: "text-[#8a5a00]", word: "Note", path: "M12 7v6M12 16.5v.5" },
  fail: { color: "text-[#b3261e]", word: "Needs a fix", path: "M7 7l10 10M17 7L7 17" },
} as const;

function StatusIcon({ status }: { status: Check["status"] }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`mt-0.5 shrink-0 ${s.color}`}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" strokeWidth="1.6" />
        <path d={s.path} />
      </svg>
      <span className="sr-only">{s.word}: </span>
    </span>
  );
}

function ChecksList({ results }: { results: Check[] }) {
  return (
    <ul className="space-y-2.5">
      {results.map((c) => (
        <li key={c.id} className="flex gap-2.5">
          <StatusIcon status={c.status} />
          <div className="min-w-0">
            <p className="text-sm text-foreground">{c.label}</p>
            <p className="text-xs leading-relaxed text-foreground/60">{c.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The assistant's avatar: a small compass mark in a rounded square. Original artwork, no image file needed. */
function AgentAvatar() {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-foreground text-background" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M15.5 8.5l-2 5-5 2 2-5z" />
      </svg>
    </span>
  );
}

function AgentLabel() {
  return (
    <p className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground/60">
      <AgentAvatar />
      {AGENT_NAME}
    </p>
  );
}

/** Shown while the model is working on a reply. */
function Typing() {
  return (
    <div data-testid="typing">
      <AgentLabel />
      <p className="flex items-center gap-1.5 text-sm text-foreground/60">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full bg-foreground/40 motion-safe:animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </span>
        <span>{AGENT_NAME} is thinking…</span>
      </p>
    </div>
  );
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-foreground/20 border-t-foreground motion-safe:animate-spin" aria-hidden="true" />;
}

function BuildCard({ step }: { step: number }) {
  return (
    <ul className="space-y-2 rounded-2xl border border-foreground/10 p-3" aria-label="Build progress">
      {BUILD_STEPS.map((s, i) => (
        <li key={s} className={`flex items-center gap-2.5 text-sm ${i <= step ? "text-foreground" : "text-foreground/40"}`}>
          <span className="grid h-4 w-4 place-items-center">
            {i < step ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#1b6b3a]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : i === step ? (
              <Spinner />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/25" />
            )}
          </span>
          {s}
          {i < step && <span className="sr-only"> (done)</span>}
        </li>
      ))}
    </ul>
  );
}

function SummarySection({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-foreground/50">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-relaxed text-foreground/85">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function Stepper({ states }: { states: StepState[] }) {
  return (
    <ol aria-label="Progress" className="flex items-center text-sm">
      {STEP_LABELS.map((label, i) => {
        const st = states[i];
        return (
          <li key={label} aria-current={st === "active" ? "step" : undefined} className="flex items-center">
            {i > 0 && <span aria-hidden="true" className="mx-1 h-px w-3 bg-foreground/20 sm:w-8" />}
            <span
              className={`flex items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors sm:px-3 ${
                st === "active" ? "bg-foreground text-background" : st === "done" ? "text-foreground" : "text-foreground/45"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full border text-[11px] ${
                  st === "active" ? "border-background/40" : st === "done" ? "border-foreground bg-foreground text-background" : "border-foreground/25"
                }`}
              >
                {st === "done" ? (
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={st === "active" ? "" : "max-sm:sr-only"}>{label}</span>
              {st === "done" && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Summary({ results }: { results: Check[] }) {
  const s = summarize(results);
  return s.fail > 0 ? (
    <span className="text-[#b3261e]">{s.fail} to fix</span>
  ) : (
    <span>
      {s.pass} passed · {s.warn} {s.warn === 1 ? "note" : "notes"}
    </span>
  );
}

/* ---------- Publish dialog ---------- */

function PublishDialog({
  config,
  note,
  onClose,
  onSubmit,
  done,
  email,
}: {
  config: StoreConfig;
  note?: string;
  onClose: () => void;
  onSubmit: (email: string, role: string) => Promise<string | null>;
  done: boolean;
  email: string;
}) {
  const [addr, setAddr] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(addr.trim())) {
      setError("Enter an email address like you@example.com.");
      return;
    }
    const err = await onSubmit(addr.trim(), role);
    if (err) setError(err);
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="publish-title" className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <h2 id="publish-title" className="text-2xl">
          {done ? "You're on the list" : `Publish ${config.name}`}
        </h2>
        {done ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-foreground/70">
              We'll send your plan to {email}, with a link to launch this store when publishing opens.
            </p>
            {note && <p className="mt-2 text-xs text-foreground/50">{note}</p>}
            <button type="button" onClick={onClose} className={`mt-6 rounded-xl bg-foreground px-4 py-2 text-sm text-background ${focusRing}`}>
              Back to my store
            </button>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="mt-3">
            <p className="text-sm leading-relaxed text-foreground/70">
              Publishing isn't open yet. Leave your email and we'll send your plan and a link when it is. Your store is saved as you left it.
            </p>
            <label htmlFor="publish-email" className="mt-5 block text-sm text-foreground">
              Email
            </label>
            <input
              id="publish-email"
              type="email"
              autoFocus
              value={addr}
              onChange={(e) => {
                setAddr(e.target.value);
                setError("");
              }}
              placeholder="you@example.com"
              aria-describedby={error ? "publish-error" : undefined}
              aria-invalid={error ? true : undefined}
              className="mt-1.5 w-full rounded-xl border border-foreground/20 bg-transparent px-3 py-2.5 text-base outline-none focus:border-foreground"
            />
            {error && (
              <p id="publish-error" className="mt-1.5 text-sm text-[#b3261e]">
                {error}
              </p>
            )}
            <fieldset className="mt-4">
              <legend className="text-sm text-foreground">I am a</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={role === r}
                    onClick={() => setRole(r)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${focusRing} ${
                      role === r ? "border-foreground bg-foreground text-background" : "border-foreground/20 hover:border-foreground/50"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="mt-6 flex items-center gap-3">
              <button type="submit" className={`rounded-xl bg-foreground px-4 py-2 text-sm text-background ${focusRing}`}>
                Send me the plan
              </button>
              <button type="button" onClick={onClose} className={`rounded-xl px-3 py-2 text-sm text-foreground/70 hover:text-foreground ${focusRing}`}>
                Not now
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Shows **bold** in a chat message as bold text. Everything else stays plain text (no HTML is ever built from it). */
function boldText(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

/* ---------- Workspace ---------- */

export default function BuilderWorkspace({ projectId, initial, homeHref, publishNote, kind = "store" }: Props) {
  const site = kind === "site";
  const [st, setSt] = useState<WorkspaceState>(initial);
  const [input, setInput] = useState("");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [pane, setPane] = useState<"chat" | "preview">("chat");
  const [checksOpen, setChecksOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [pending, setPending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // A per-viewer convenience: remember the chat size. Storage can be missing or blocked, so every access is guarded.
  useEffect(() => {
    try {
      if (localStorage.getItem("builder-chat-expanded") === "1") setExpanded(true);
    } catch {}
  }, []);
  function toggleExpanded() {
    setExpanded((v) => {
      try {
        localStorage.setItem("builder-chat-expanded", v ? "0" : "1");
      } catch {}
      return !v;
    });
  }

  const dirty = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const publishBtn = useRef<HTMLButtonElement>(null);

  const { phase, msgs, history, buildStep, published } = st;
  /** In the larger chat, the conversation stays a readable width in the middle. */
  const column = expanded ? "mx-auto w-full max-w-[640px]" : "";
  const cur: StoreConfig | undefined = history[history.length - 1];
  const results = useMemo(() => (cur ? verify(cur) : []), [cur]);
  const sum = summarize(results);
  const busy = phase === "build" || phase === "verify" || pending;
  const canPublish = phase === "iterate" && Boolean(cur) && sum.fail === 0;

  /** Change the state in the browser and mark it for saving (iterate phase only). */
  const edit = useCallback((fn: (s: WorkspaceState) => WorkspaceState) => {
    dirty.current = true;
    setSt(fn);
  }, []);

  /** Website projects: queue the build for the worker, then watch it in the side pane. */
  const startBuild = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/build`, { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { state?: WorkspaceState; error?: string };
      if (r.ok && j.state) {
        setSt(j.state);
        setPane("preview");
      } else {
        setSt((s) => pushMsg(s, { kind: "bot", text: j.error ?? "I couldn't start the build. Try again in a moment." }));
      }
    } catch {
      setSt((s) => pushMsg(s, { kind: "bot", text: "I couldn't reach the server just now. Try again in a moment." }));
    } finally {
      setStarting(false);
    }
  }, [projectId, starting]);

  // While a build runs on the worker, follow it. This also resumes after the tab was closed.
  useEffect(() => {
    if (phase !== "build" && phase !== "verify") return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
        if (r.ok) setSt((await r.json()).state as WorkspaceState);
      } catch {
        /* try again on the next tick */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [phase, projectId]);

  // Save iterate-phase changes shortly after they happen.
  useEffect(() => {
    if (phase !== "iterate" || !dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      void fetch(`/api/projects/${projectId}/state`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(st),
      });
    }, 300);
    return () => clearTimeout(t);
  }, [st, phase, projectId]);

  // Leaving the page right after a change still saves it.
  const latest = useRef(st);
  useEffect(() => {
    latest.current = st;
  }, [st]);
  useEffect(() => {
    const flush = () => {
      if (!dirty.current || latest.current.phase !== "iterate") return;
      dirty.current = false;
      void fetch(`/api/projects/${projectId}/state`, {
        method: "PUT",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(latest.current),
      });
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [projectId]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, buildStep, pending]);

  async function serverTurn(text: string) {
    setPending(true);
    setSt((s) => pushMsg(s, { kind: "user", text }));
    try {
      const r = await fetch(`/api/projects/${projectId}/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Request failed");
      setSt(j.state as WorkspaceState);
      setPane("chat");
    } catch {
      setSt((s) => pushMsg(s, { kind: "bot", text: "I couldn't reach the server just now. Try sending that again." }));
    } finally {
      setPending(false);
    }
  }

  function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    if (phase === "iterate" && !/^\s*(start over|reset)\b/i.test(text)) {
      edit((s) => iterateTurn(s, text));
      setPane("chat");
      return;
    }
    void serverTurn(text);
  }

  function undo() {
    edit(undoState);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  }

  /** "I've saved it": the server removes the password from the saved message. */
  async function ackPassword() {
    try {
      const r = await fetch(`/api/projects/${projectId}/ack-password`, { method: "POST" });
      if (r.ok) setSt(((await r.json()) as { state: WorkspaceState }).state);
    } catch {
      /* the button stays; try again */
    }
  }

  const closePublish = useCallback(() => {
    setPublishOpen(false);
    publishBtn.current?.focus();
  }, []);

  async function requestPublish(email: string, role: string): Promise<string | null> {
    try {
      const r = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (!r.ok) return (await r.json().catch(() => ({}))).error ?? "That didn't go through. Try again.";
      setSentTo(email);
      edit((s) => ({ ...s, published: true }));
      return null;
    } catch {
      return "That didn't go through. Try again.";
    }
  }

  const states: StepState[] = [
    phase === "idle" || phase === "intake" || phase === "summary" || phase === "build" ? "active" : "done",
    phase === "verify" ? "active" : phase === "iterate" ? "done" : "todo",
    published ? "done" : phase === "iterate" && !publishOpen ? "active" : "todo",
    published ? "done" : publishOpen ? "active" : "todo",
  ];

  const lastMsg = msgs[msgs.length - 1];
  const qOptions = lastMsg?.kind === "bot" && lastMsg.free ? lastMsg.options ?? [] : optionsFor(st.qid);
  const chips: { label: string; send?: string; fill?: string }[] =
    site
      ? []
      : phase === "intake"
      ? [...qOptions.map((o) => ({ label: o, send: o })), { label: "Just build it", send: "just build it" }]
      : phase === "summary"
        ? [{ label: "Build it", send: "build it" }, { label: "Change the name", send: "change the name" }, { label: "Change the look", send: "change the look" }]
        : phase === "iterate"
          ? SUGGESTIONS
          : [];

  const lastSummaryId = [...msgs].reverse().find((m) => m.kind === "summary")?.id;
  const lastRecapId = [...msgs].reverse().find((m) => m.kind === "recap")?.id;
  const lastChangeId = [...msgs].reverse().find((m) => m.kind === "change")?.id;

  const back: ReactNode = (
    <span className="flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 6l-6 6 6 6" />
      </svg>
      Your projects
    </span>
  );

  return (
    <div className="flex h-[100dvh] min-h-[40rem] flex-col bg-background text-foreground">
      <h1 className="sr-only">{site ? "Website builder" : "Store builder"}</h1>

      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <a href={homeHref} className={`rounded-lg ${focusRing}`}>
          {back}
        </a>
        <div className="order-last flex w-full justify-center md:order-none md:w-auto">
          {!site && <Stepper states={states} />}
        </div>
        <button
          ref={publishBtn}
          hidden={site}
          type="button"
          disabled={!canPublish}
          onClick={() => setPublishOpen(true)}
          title={!cur ? "Describe your store first" : sum.fail > 0 ? `Fix ${sum.fail} ${sum.fail === 1 ? "issue" : "issues"} first` : undefined}
          className={`rounded-xl bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-35 ${focusRing}`}
        >
          Publish
        </button>
      </header>

      {/* Phone only: switch between the two panels */}
      <div role="tablist" aria-label="Panels" className="mx-4 mb-3 inline-flex self-start rounded-full bg-foreground/[0.06] p-1 lg:hidden">
        {(["chat", "preview"] as const).map((p) => (
          <button
            key={p}
            role="tab"
            type="button"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={`rounded-full px-4 py-1.5 text-sm capitalize ${focusRing} ${pane === p ? "bg-white shadow-sm" : "text-foreground/60"}`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className={`grid min-h-0 flex-1 gap-3 px-3 pb-3 ${expanded ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(340px,430px)]"}`}>
        {site ? (
          <SitePane st={st} projectId={projectId} busy={busy} visible={pane === "preview"} onBuild={startBuild} starting={starting} />
        ) : (
          <>
        <section aria-label="Store preview" className={`${pane === "preview" ? "flex" : "hidden"} relative min-h-0 flex-col overflow-hidden rounded-3xl border border-foreground/10 bg-white lg:flex`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground/10 px-4 py-2.5">
            <p className="flex items-center gap-2 text-sm text-foreground/60">
              Preview
              {cur && (
                <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs text-foreground" data-testid="version">
                  v{history.length}
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              {cur && (
                <button
                  type="button"
                  aria-expanded={checksOpen}
                  onClick={() => setChecksOpen((o) => !o)}
                  className={`rounded-full border border-foreground/15 px-3 py-1 text-xs text-foreground/80 hover:border-foreground/50 ${focusRing}`}
                >
                  <span className="sr-only">Checks: </span>
                  <Summary results={results} />
                </button>
              )}
              <div role="group" aria-label="Preview size" className="inline-flex rounded-full bg-foreground/[0.06] p-0.5">
                {(["desktop", "phone"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={device === d}
                    onClick={() => setDevice(d)}
                    className={`rounded-full px-3 py-1 text-xs capitalize ${focusRing} ${device === d ? "bg-white shadow-sm" : "text-foreground/60"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-foreground/[0.04]">
            {cur ? (
              device === "desktop" ? (
                <StorePreview config={cur} />
              ) : (
                <div data-testid="phone-frame" className="mx-auto my-4 w-[390px] max-w-[calc(100%-2rem)] overflow-hidden rounded-3xl border border-foreground/15 bg-white shadow-sm">
                  <StorePreview config={cur} />
                </div>
              )
            ) : (
              <div className="grid h-full min-h-48 place-items-center p-6 text-center text-sm text-foreground/50">
                {busy ? "Drawing your store…" : "Your store appears here."}
              </div>
            )}
          </div>

          {checksOpen && cur && (
            <div className="absolute inset-x-0 bottom-0 max-h-[65%] overflow-y-auto border-t border-foreground/10 bg-white p-4 shadow-[0_-12px_28px_rgba(0,0,0,0.08)]">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-foreground">
                  Checks: <Summary results={results} />
                </p>
                <button type="button" onClick={() => setChecksOpen(false)} className={`rounded-lg px-2 py-1 text-xs text-foreground/70 hover:text-foreground ${focusRing}`}>
                  Close
                </button>
              </div>
              <ChecksList results={results} />
            </div>
          )}
        </section>
          </>
        )}

        {/* Chat */}
        <section aria-label="Chat" className={`${pane === "chat" ? "flex" : "hidden"} min-h-0 flex-col overflow-hidden rounded-3xl border border-foreground/10 bg-white lg:flex`}>
          <div className="hidden items-center justify-between border-b border-foreground/10 px-4 py-2 lg:flex">
            <p className="text-sm text-foreground/60">Chat with {AGENT_NAME}</p>
            <button
              type="button"
              onClick={toggleExpanded}
              aria-pressed={expanded}
              aria-label={expanded ? "Make chat smaller" : "Make chat larger"}
              title={expanded ? "Make chat smaller" : "Make chat larger"}
              className={`grid h-8 w-8 place-items-center rounded-lg text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground ${focusRing}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={expanded ? "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" : "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"} />
              </svg>
            </button>
          </div>
          <div ref={logRef} role="log" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className={`space-y-4 ${column}`}>
            {msgs.map((m, idx) => {
              switch (m.kind) {
                case "user":
                  return (
                    <div key={m.id} className="flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm leading-relaxed text-background">{m.text}</p>
                    </div>
                  );
                case "bot":
                  return (
                    <div key={m.id} className="max-w-[92%]">
                      {msgs[idx - 1]?.kind !== "bot" && <AgentLabel />}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{boldText(m.text)}</p>
                      {m.hint && <p className="mt-0.5 text-xs leading-relaxed text-foreground/55">{m.hint}</p>}
                      {m.palette && m.id === msgs[msgs.length - 1]?.id && phase === "intake" && (
                        <div className="mt-2 flex flex-wrap gap-2" data-testid="palette">
                          {m.palette.map((name) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() => send(name)}
                              className={`flex w-[72px] flex-col items-center gap-1.5 rounded-xl border border-foreground/10 bg-white px-2 py-2.5 text-xs capitalize text-foreground hover:border-foreground/30 ${focusRing}`}
                            >
                              <span className="h-9 w-9 rounded-full" style={{ background: accentHex(name) ?? "#999" }} aria-hidden="true" />
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                case "site_ready":
                  return (
                    <div key={m.id}>
                      <AgentLabel />
                      <SiteReadyCard
                        name={m.name}
                        url={m.url}
                        adminUrl={m.adminUrl}
                        ownerEmail={m.ownerEmail}
                        password={m.password}
                        checks={m.checks}
                        onSaved={ackPassword}
                      />
                    </div>
                  );
                case "recap":
                  // Only the latest recap is shown, so the chat does not repeat itself.
                  if (m.id !== lastRecapId || phase !== "intake") return null;
                  return (
                    <div key={m.id} className="max-w-[92%] rounded-2xl bg-foreground/[0.04] px-3 py-2.5" data-testid="recap">
                      <p className="text-xs text-foreground/60">What I know so far</p>
                      <ul className="mt-1 space-y-0.5 text-sm leading-relaxed text-foreground">
                        {m.items.map((it) => (
                          <li key={it.label}>
                            <span className="text-foreground/60">{it.label}:</span> {it.value}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                case "summary": {
                  const s = m.data;
                  const live = phase === "summary" && m.id === lastSummaryId;
                  return (
                    <div key={m.id} className="space-y-3 rounded-2xl border border-foreground/10 p-3" data-testid="brief-summary">
                      <p className="text-sm text-foreground">What I'll build for {s.title}</p>
                      <SummarySection label="Your store" items={s.build} />
                      {s.notYet.length > 0 && <SummarySection label="Not available yet" items={s.notYet.map((n) => `${n.label}. ${n.note}`)} />}
                      <SummarySection label="What I'm assuming" items={s.assume} />
                      <SummarySection label="What I need from you" items={s.need} />
                      <SummarySection label="Worth knowing" items={s.flags} />
                      {live && (
                        <button type="button" onClick={() => send("build it")} className={`rounded-xl bg-foreground px-4 py-2 text-sm text-background ${focusRing}`}>
                          Build it
                        </button>
                      )}
                    </div>
                  );
                }
                case "build":
                  return <BuildCard key={m.id} step={buildStep} />;
                case "checks":
                  return (
                    <div key={m.id} className="rounded-2xl border border-foreground/10 p-3">
                      <p className="mb-3 text-sm text-foreground">
                        Checks: <Summary results={m.results} />
                      </p>
                      <ChecksList results={m.results} />
                      <p className="mt-3 text-xs text-foreground/55">Ask for a change below. I'll re-run these after each one.</p>
                    </div>
                  );
                case "change": {
                  const bad = m.results.filter((c) => c.status === "fail");
                  return (
                    <div key={m.id} className="rounded-2xl border border-foreground/10 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-foreground">Version {m.version}</p>
                        <p className="text-xs text-foreground/60">
                          Checks: <Summary results={m.results} />
                        </p>
                      </div>
                      <ul className="mt-2 space-y-1 text-sm text-foreground/80">
                        {m.lines.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                      {bad.length > 0 && (
                        <div className="mt-3 border-t border-foreground/10 pt-3">
                          <ChecksList results={bad} />
                        </div>
                      )}
                      {m.id === lastChangeId && history.length > 1 && (
                        <button type="button" onClick={undo} className={`mt-3 rounded-lg border border-foreground/20 px-3 py-1 text-xs hover:border-foreground ${focusRing}`}>
                          Undo
                        </button>
                      )}
                    </div>
                  );
                }
              }
            })}
            {pending && phase !== "build" && phase !== "verify" && <Typing />}
            {phase === "build" && (
              <p className="text-xs leading-relaxed text-foreground/55" data-testid="step-away">
                This takes a minute or so. You can close this tab. The build keeps running, and your project will be waiting in Your projects.
              </p>
            )}
            </div>
          </div>

          {chips.length > 0 && (
            <div className="border-t border-foreground/10 px-3 pt-3">
            <div className={`flex flex-wrap gap-2 ${column}`}>
              {chips.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => {
                    if (s.send) send(s.send);
                    else {
                      setInput(s.fill ?? "");
                      inputRef.current?.focus();
                    }
                  }}
                  className={`rounded-full border border-foreground/15 px-3 py-1 text-xs text-foreground/80 transition-colors hover:border-foreground/50 hover:text-foreground ${focusRing}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            </div>
          )}

          <form onSubmit={onSubmit} className="p-3">
            <div
              className={`mx-auto w-full cursor-text rounded-2xl border border-foreground/15 bg-white transition-colors focus-within:border-foreground/50 ${expanded ? "lg:max-w-[640px]" : ""}`}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest("button")) inputRef.current?.focus();
              }}
            >
              <label htmlFor="builder-input" className="sr-only">
                {phase === "intake" || site ? "Your answer" : cur ? "Ask for a change" : "Describe your store"}
              </label>
              <textarea
                id="builder-input"
                ref={inputRef}
                rows={1}
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder={busy ? "Working on it…" : site ? "Type your answer…" : phase === "intake" ? "Type your answer…" : phase === "summary" ? "Say “build it” or what to change…" : cur ? "Ask for a change…" : "Describe your store…"}
                className="field-sizing-content block max-h-48 min-h-12 w-full resize-none bg-transparent px-4 pb-1 pt-3 text-base leading-snug outline-none placeholder:text-foreground/40 disabled:opacity-60"
              />
              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-0.5">
                  {/* Not built yet: shown dimmed so the layout is final. Remove these two when you would rather not show them. */}
                  <button type="button" disabled title="Attach a file (coming soon)" aria-label="Attach a file (coming soon)" className="grid h-8 w-8 place-items-center rounded-lg text-foreground/30">
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                  <button type="button" disabled title="Talk instead of typing (coming soon)" aria-label="Talk instead of typing (coming soon)" className="grid h-8 w-8 place-items-center rounded-lg text-foreground/30">
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
                    </svg>
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  aria-label="Send"
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30 ${focusRing}`}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5M6 11l6-6 6 6" />
                  </svg>
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>

      {publishOpen && cur && (
        <PublishDialog config={cur} note={publishNote} done={Boolean(sentTo)} email={sentTo} onClose={closePublish} onSubmit={requestPublish} />
      )}
    </div>
  );
}
