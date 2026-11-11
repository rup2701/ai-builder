// Usage (on the build machine, from the builder folder):
//   npx tsx scripts/import-work-images.mts <app folder> <brief file> [--dry]
import { importWorkImages } from "../src/lib/builder/work-images";

const [appDir, briefFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!appDir || !briefFile) {
  console.error("Usage: npx tsx scripts/import-work-images.mts <app folder> <brief file> [--dry]");
  process.exit(1);
}
const report = await importWorkImages(appDir, briefFile, { dryRun: process.argv.includes("--dry") });
console.log(`Saved ${report.saved.length}:`);
for (const s of report.saved) console.log("  " + s);
console.log(`Skipped ${report.skipped.length}:`);
for (const s of report.skipped) console.log(`  ${s.title}: ${s.why}`);
