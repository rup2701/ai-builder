/**
 * The stages a person sees while a website is built. Coarse on purpose: the runner's hundred or so
 * steps are grouped into these six. The worker moves a build through them by reading the runner's
 * own stage markers (see stageFromRunnerLine).
 */
export const SITE_STAGES = [
  { id: "ready", label: "Getting ready", blurb: "Setting up a fresh project and database." },
  { id: "build", label: "Building the pages", blurb: "Writing the site from your brief. This is the long part." },
  { id: "look", label: "Polishing the look", blurb: "Checking spacing, type, images and layout against the look rules." },
  { id: "test", label: "Testing", blurb: "Running the checks on the finished site." },
  { id: "online", label: "Putting it online", blurb: "Creating the database and publishing at your address." },
  { id: "done", label: "Ready", blurb: "Your site is live." },
] as const;

export type StageId = (typeof SITE_STAGES)[number]["id"];

/** Index of the last stage ("Ready"). A build with stage === DONE_STAGE has finished. */
export const DONE_STAGE = SITE_STAGES.length - 1;

/**
 * Maps one line of the runner's output (`create` or `deploy`) to a stage index, or null when the line
 * does not mark a new stage. Markers: create prints "1/4", "2/4", "3/4", "3b/4", "4/4"; deploy prints "1/7" to "7/7".
 */
export function stageFromRunnerLine(line: string): number | null {
  const m = /^\s*(\d)(b?)\/(4|7)\b/.exec(line);
  if (!m) return null;
  const [, n, b, of] = m;
  if (of === "7") return 4; // every deploy step is "Putting it online"
  if (b === "b") return 2; // 3b/4: the look pass
  switch (n) {
    case "1":
    case "2":
      return 0;
    case "3":
      return 1;
    case "4":
      return 3;
    default:
      return null;
  }
}

/** The chat line the worker writes when a build fails. A new build removes it so the chat does not show a failure above a success. */
export const isBuildFailedText = (text: string) => /^The build (stopped at|hit a problem)\b/.test(text);
