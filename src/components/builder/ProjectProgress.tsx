import { PROGRESS_STEPS, type Progress } from "@/lib/builder/project-progress";

/** The project's name and where it stands: Idea, Build, Publish, Live. Read-only. */
export default function ProjectProgress({ name, progress }: { name: string; progress: Progress }) {
  const { active, live, failed } = progress;
  const current = PROGRESS_STEPS[active];
  // Once the site is live the steps have done their job: the name and a Live tag are enough.
  if (live) {
    return (
      <div className="flex min-w-0 items-center justify-center gap-3">
        <p className="max-w-[18rem] truncate text-sm font-medium" title={name}>
          {name}
        </p>
        <span aria-hidden="true" className="h-4 w-px bg-foreground/20" />
        <span className="flex items-center gap-1.5 text-xs text-foreground/70">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-600" />
          Live
        </span>
        <p className="sr-only" role="status">
          Your site is live.
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <p className="max-w-[18rem] truncate text-sm font-medium" title={name}>
        {name}
      </p>
      <ol aria-label="Project progress" className="flex items-center gap-1.5 text-xs">
        {PROGRESS_STEPS.map((label, i) => {
          const done = live || i < active;
          const isActive = !live && i === active;
          const bad = isActive && failed;
          return (
            <li key={label} aria-current={isActive ? "step" : undefined} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true" className={`h-px w-4 sm:w-6 ${done || isActive ? "bg-foreground/40" : "bg-foreground/15"}`} />}
              <span className={`flex items-center gap-1.5 ${done ? "text-foreground/70" : isActive ? (bad ? "text-destructive" : "text-foreground") : "text-foreground/35"}`}>
                <span
                  aria-hidden="true"
                  className={`grid h-4 w-4 place-items-center rounded-full border text-[10px] leading-none ${
                    done ? "border-foreground bg-foreground text-background" : bad ? "border-destructive" : isActive ? "border-foreground" : "border-foreground/20"
                  }`}
                >
                  {done ? "✓" : bad ? "!" : isActive ? <span className="h-1.5 w-1.5 rounded-full bg-foreground" /> : ""}
                </span>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" role="status">
        {live ? "Your site is live." : `${failed ? "Needs attention at" : "Now"}: ${current}.`}
      </p>
    </div>
  );
}
