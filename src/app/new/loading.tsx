/** Shown while /new reads the idea and sets up the project, which can take several seconds. */
export default function Loading() {
  return (
    <main role="status" aria-live="polite" className="mx-auto flex min-h-[100dvh] w-full max-w-[26rem] flex-col items-center justify-center gap-4 px-4 text-center">
      <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground" />
      <div>
        <p className="text-xl">Setting up your project…</p>
        <p className="mt-1 text-sm text-foreground/60">Reading your idea. This takes a few seconds.</p>
      </div>
    </main>
  );
}
