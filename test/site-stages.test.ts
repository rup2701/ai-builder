import { DONE_STAGE, SITE_STAGES, stageFromRunnerLine } from "../src/lib/builder/site-stages";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}

// The runner's own markers map to the six stages a person sees.
check("create 1/4 is Getting ready", stageFromRunnerLine("1/4 Writing the brief…") === 0);
check("create 2/4 is Getting ready", stageFromRunnerLine("2/4 Setting up a fresh folder and database…") === 0);
check("create 3/4 is Building the pages", stageFromRunnerLine("3/4 Agent is building (this takes a while)…") === 1);
check("create 3b/4 is Polishing the look", stageFromRunnerLine("3b/4 Look pass (the agent checks the public page against look.md)…") === 2);
check("create 4/4 is Testing", stageFromRunnerLine("4/4 Independent checks (the agent does not run these)…") === 3);
for (let n = 1; n <= 7; n++) check(`deploy ${n}/7 is Putting it online`, stageFromRunnerLine(`${n}/7 something`) === 4);
check("a tool line is not a stage", stageFromRunnerLine("[12] run_command git status") === null);
check("indented text is not a stage", stageFromRunnerLine("    database run_2026") === null);
check("a date is not a stage", stageFromRunnerLine("2026/10/30 12:00") === null);
check("six stages, last is Ready", SITE_STAGES.length === 6 && SITE_STAGES[DONE_STAGE].id === "done");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
