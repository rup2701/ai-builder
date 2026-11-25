"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { TEMPLATES_BY_ID } from "./templates";
import { handoff, PILL_GROUPS, TEMPLATE_PACK, type Pill } from "./home-pills";

type Kind = Pill;

const KINDS: { id: Kind; label: string; placeholder: string; icon: ReactNode }[] = [
  { id: "site", label: "Website", placeholder: "Describe the website you want to launch…", icon: <><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 9h18" /></> },
  { id: "store", label: "Online store", placeholder: "Describe the store you want to launch, like a handmade ceramics shop…", icon: <path d="M4 9l1.5-5h13L20 9M4 9v1a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0V9M5 12v8h14v-8M10 20v-5h4v5" /> },
  { id: "mobile", label: "Mobile app", placeholder: "Describe the app you are launching. We build its launch page first…", icon: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></> },
  { id: "saas", label: "SaaS", placeholder: "Describe your product. We build its launch page first…", icon: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" /> },
];

const MAX = 1000;
const MIN_SITE = 15;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

/** The prompt and starter cards on Home. Submitting opens /new, which makes the project and starts the conversation. */
export default function NewProject({ localOn = false }: { localOn?: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("site");
  const [text, setText] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const current = KINDS.find((k) => k.id === kind)!;
  // The restaurant card stops saying "Coming soon" only where the restaurant pack is switched on (ENABLE_LOCAL_PACK, read on the server).
  // Each pill lists cards by id (home-pills.ts), so the same card can sit under more than one pill.
  const groups = PILL_GROUPS[kind].map((g) => ({
    heading: g.heading,
    items: g.items.flatMap(({ id, line }) => {
      const t = TEMPLATES_BY_ID[id];
      if (!t) return [];
      return [{ ...t, line, ...(TEMPLATE_PACK[id] === "local" && localOn ? { soon: false } : {}) }];
    }),
  }));
  const isSite = kind !== "store";
  const value = text.trim();
  const valid = isSite ? value.length >= MIN_SITE && !text.includes("___") : value.length > 0;

  function pickKind(k: Kind) {
    if (k === kind) return;
    setKind(k);
    setTemplate(null);
    setText("");
    setStatus("");
  }

  function submit() {
    if (!valid) {
      setStatus(isSite && text.includes("___") ? "Replace the blank with your idea." : isSite ? `Describe your idea in at least ${MIN_SITE} characters.` : "Add a sentence about your idea first.");
      boxRef.current?.focus();
      return;
    }
    // A template that belongs to another pack (the product showcase) says so in the link; typing over the text keeps it, as it is still that template.
    // With no card clicked, Mobile app and SaaS use their default card, sent the same way as a click.
    const { kind: sent, pack } = handoff(kind, template);
    router.push(`/new?${new URLSearchParams({ kind: sent, idea: value.slice(0, MAX), ...(pack ? { pack } : {}) })}`);
  }

  return (
    <section aria-labelledby="home-title" className="mx-auto w-full max-w-3xl px-4 pb-16 pt-12 text-center sm:pt-16">
      <h1 id="home-title" className="text-balance text-3xl leading-[1.04] sm:text-5xl">
        What will you launch?
      </h1>

      <div role="group" aria-label="What are you making?" className="mt-8 flex flex-wrap justify-center gap-3">
        {KINDS.map((k) => {
          const selected = k.id === kind;
          return (
            <button
              key={k.id}
              type="button"
              aria-pressed={selected}
              onClick={() => pickKind(k.id)}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${focusRing} ${
                selected ? "border-foreground bg-foreground text-background" : "border-foreground/15 bg-white text-foreground hover:border-foreground/40"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {k.icon}
              </svg>
              {k.label}
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-3xl border border-foreground/10 bg-white p-5 text-left transition-colors focus-within:border-foreground/30 sm:p-6">
        <label htmlFor="home-prompt" className="sr-only">
          Describe your idea
        </label>
        <textarea
          id="home-prompt"
          ref={boxRef}
          value={text}
          rows={2}
          maxLength={MAX}
          placeholder={current.placeholder}
          onChange={(e) => {
            setText(e.target.value);
            if (status) setStatus("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="field-sizing-content block max-h-64 min-h-[4.5rem] w-full resize-none bg-transparent text-xl leading-snug text-foreground outline-none placeholder:text-foreground/35 sm:text-2xl"
        />
        {isSite && (
          <p className="mt-2 text-right text-xs text-foreground/60">
            {text.length}/{MAX.toLocaleString("en-US")} characters · minimum {MIN_SITE}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-4">
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-foreground/72">
            {status}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className={`inline-flex shrink-0 items-center rounded-xl border border-foreground/25 bg-transparent px-4 py-2 text-sm text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground ${focusRing}`}
          >
            Let’s go <span aria-hidden="true">&nbsp;→</span>
          </button>
        </div>
      </div>

      <p className="mt-10 text-sm text-foreground">Start with a template</p>
      <div data-testid="templates">
        {groups.map((g, gi) => (
          <div key={`${kind}-${gi}`} className={gi > 0 ? "mt-8" : ""}>
            {g.heading && <h2 className="mt-4 text-left text-sm font-semibold text-foreground">{g.heading}</h2>}
            <ul
              aria-label={g.heading ?? "Starter templates"}
              tabIndex={0}
              className={`mx-auto mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto p-1 pb-4 sm:grid sm:grid-cols-3 sm:gap-y-8 sm:overflow-visible sm:p-0 ${focusRing}`}
            >
              {g.items.map((t) => {
                const selected = template === t.id;
                return (
                  <li key={t.id} className="w-[min(260px,85%)] min-w-0 shrink-0 snap-start sm:w-auto">
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={t.soon}
                      onClick={() => {
                        setTemplate(t.id);
                        setText(t.text);
                        setStatus("");
                        boxRef.current?.focus();
                      }}
                      className={`group block w-full rounded-2xl text-left disabled:cursor-not-allowed ${focusRing}`}
                    >
                      <span
                        className={`block aspect-[4/3] overflow-hidden rounded-2xl border bg-white transition-colors ${t.soon ? "opacity-60" : ""} ${
                          selected ? "border-foreground" : "border-foreground/10 group-hover:border-foreground/40"
                        }`}
                      >
                        {t.image && !broken[t.id] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.image} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setBroken((b) => ({ ...b, [t.id]: true }))} />
                        ) : (
                          t.art
                        )}
                      </span>
                      <span className="mt-4 block pl-2 text-sm font-semibold text-[#333] sm:truncate">{t.caption}</span>
                    </button>
                    {t.line && <span className="mt-1 block pl-2 text-left text-xs text-foreground/72">{t.line}</span>}
                    {t.soon && <span className="block pl-2 text-left text-xs text-foreground/60">Coming soon</span>}
                    {t.demos?.map((d) => (
                      <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer" className="block pl-2 text-left text-xs text-foreground/72 underline-offset-4 first-of-type:mt-3 hover:underline">
                        {d.label} ↗
                      </a>
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
