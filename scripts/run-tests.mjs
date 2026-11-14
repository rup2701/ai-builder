// Runs every test file in test/ one after another and reports which failed.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = readdirSync("test").filter((f) => /\.test\.(ts|mts)$/.test(f)).sort();
const failed = [];
for (const f of files) {
  process.stdout.write(`\n== ${f}\n`);
  const r = spawnSync("npx", ["tsx", `test/${f}`], { stdio: "inherit", env: process.env });
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : `\nAll ${files.length} test files passed.`);
process.exit(failed.length ? 1 : 0);
