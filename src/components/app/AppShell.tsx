import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions";

const NAV = [
  { id: "home", href: "/", label: "Home", icon: <path d="M4 11l8-7 8 7M6 10v10h12V10" /> },
  { id: "projects", href: "/projects", label: "Projects", icon: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> },
  { id: "settings", href: "/settings", label: "Settings", icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></> },
] as const;

export type NavId = (typeof NAV)[number]["id"];

/** The frame for the builder's main pages: a sidebar on a wide screen, a top bar on a phone. The project workspace has its own header and does not use this. */
export default function AppShell({ active, email, children }: { active: NavId; email: string | null; children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground md:flex">
      <aside className="flex items-center gap-1 border-b border-foreground/10 px-3 py-2.5 md:sticky md:top-0 md:h-[100dvh] md:w-56 md:shrink-0 md:flex-col md:items-stretch md:gap-1 md:border-b-0 md:border-r md:p-4">
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
                n.id === active ? "bg-foreground/[0.07] text-foreground" : "text-foreground/65 hover:bg-foreground/[0.04] hover:text-foreground"
              }`}
            >
              <svg viewBox="0 0 24 24" className="hidden h-[18px] w-[18px] md:block" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {n.icon}
              </svg>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden md:mt-auto md:block">
          {email && <p className="truncate px-2 text-xs text-foreground/55" title={email}>{email}</p>}
          <form action={signOutAction}>
            <button type="submit" className="mt-1 rounded-lg px-2 py-1.5 text-sm text-foreground/65 hover:text-foreground">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
