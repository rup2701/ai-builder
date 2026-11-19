import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions";
import { DOCS_URL } from "@/lib/brand";

const NAV = [
  { id: "home", href: "/", label: "Home", icon: <path d="M4 11l8-7 8 7M6 10v10h12V10" /> },
  { id: "projects", href: "/projects", label: "Projects", icon: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> },
  { id: "settings", href: "/settings", label: "Settings", icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></> },
] as const;

export type NavId = (typeof NAV)[number]["id"];

/**
 * The frame for the builder's main pages: a sidebar on a wide screen, a top bar on a phone. The project workspace has its own
 * header and does not use this. On a wide screen the sidebar and the page are white cards on the grey background, like the
 * chat and preview panels in the project workspace. Both stay within the window; the page card scrolls inside.
 */
export default function AppShell({ active, email, children }: { active: NavId; email: string | null; children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground md:flex md:h-[100dvh] md:gap-3 md:overflow-hidden md:p-3">
      <aside className="flex items-center gap-1 border-b border-foreground/10 px-3 py-2.5 md:h-full md:w-56 md:shrink-0 md:flex-col md:items-stretch md:gap-1 md:rounded-3xl md:border md:border-foreground/10 md:bg-white md:p-4">
        <Link href="/" className="rounded-lg px-2 py-1.5 text-base font-medium tracking-tight md:mb-3">
          Appnomics
        </Link>
        <nav aria-label="Main" className="flex gap-1 md:flex-col">
          {NAV.map((n) => (
            <Link
              key={n.id}
              href={n.href}
              aria-current={n.id === active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors md:px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
                n.id === active ? "bg-foreground/[0.07] text-foreground" : "text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground"
              }`}
            >
              <svg viewBox="0 0 24 24" className="hidden h-[18px] w-[18px] md:block" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {n.icon}
              </svg>
              {n.label}
            </Link>
          ))}
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-foreground/75 transition-colors hover:bg-foreground/[0.04] hover:text-foreground md:px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <svg viewBox="0 0 24 24" className="hidden h-[18px] w-[18px] md:block" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
            </svg>
            Help
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </nav>
        {/* The account: who is signed in, and signing out, in one small card at the foot of the sidebar. */}
        <div className="hidden md:mt-auto md:flex md:items-center md:gap-2.5 md:rounded-2xl md:bg-background md:p-2">
          <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-sm font-medium uppercase text-background">
            {email?.trim()[0] ?? "?"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-foreground/60">Signed in as</p>
            <p className="truncate text-sm text-foreground" title={email ?? undefined}>{email ?? "Your account"}</p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foreground/72 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4" />
              </svg>
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 md:h-full md:overflow-y-auto md:rounded-3xl md:border md:border-foreground/10 md:bg-white">{children}</main>
    </div>
  );
}
