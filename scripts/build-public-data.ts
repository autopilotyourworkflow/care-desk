/**
 * Writes the files the screens fetch at run time, so data/results.json (about 1.4 MB) never goes into the JS bundle.
 *
 *   npm run data:public            write public/data/
 *   npx tsx scripts/build-public-data.ts --check    exit 1 if public/data/ is out of date (writes nothing)
 *
 * Runs automatically before `npm run build` (the "prebuild" script). Output is deterministic: the same data/ files
 * always give byte-identical output, so public/data/ is committed and diffs only when the data changes.
 *
 *   public/data/queue.json            slim desk and clinician queue rows (red-team slice excluded)
 *   public/data/cases/<MSG-id>.json   everything one ticket view needs
 *   public/data/eval-report.json      data/eval-report.json plus a one-line summary per case
 *   public/data/baseline.json, helplines.json, staff.json
 *   public/data/personas.json         the three Try box patients and the records the drafter may cite
 *   public/data/meta.json             models, versions, generatedAt, isMock, and the welcome page's ids and totals
 *
 * Every patient, message and result is fictional demo material.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Baseline, EvalReport, Patient, PatientMessage, ResultsFile, TestLabel } from "../lib/types";
import { buildPublicData } from "../lib/client/public-data";
import type { Helpline, StaffMember } from "../lib/client/types";
import { ROOT, asArray, dataPath, readJsonFile, requireFile } from "./lib/io";

const OUT = join(ROOT, "public", "data");
const CASES = join(OUT, "cases");
const check = process.argv.includes("--check");

for (const f of ["results.json", "messages.json", "patients.json", "testset.json", "eval-report.json", "baseline.json", "helplines.json", "staff.json"]) {
  requireFile(dataPath(f), f === "results.json" ? "Run npm run precompute first." : f === "eval-report.json" ? "Run npm run eval first." : "");
}

const out = buildPublicData({
  results: readJsonFile<ResultsFile>(dataPath("results.json")),
  messages: asArray<PatientMessage>(readJsonFile(dataPath("messages.json")), "messages"),
  patients: asArray<Patient>(readJsonFile(dataPath("patients.json")), "patients"),
  testset: asArray<TestLabel>(readJsonFile(dataPath("testset.json")), "cases"),
  evalReport: readJsonFile<EvalReport>(dataPath("eval-report.json")),
  baseline: readJsonFile<Baseline>(dataPath("baseline.json")),
  helplines: asArray<Helpline>(readJsonFile(dataPath("helplines.json")), "helplines"),
  staff: asArray<StaffMember>(readJsonFile(dataPath("staff.json")), "staff"),
});

/** Path under public/data/ -> file text. Compact JSON with a trailing newline. */
const files = new Map<string, string>();
const put = (path: string, value: unknown) => files.set(path, `${JSON.stringify(value)}\n`);

put("queue.json", out.queue);
for (const id of Object.keys(out.cases).sort()) put(`cases/${id}.json`, out.cases[id]);
put("eval-report.json", out.evalReport);
put("baseline.json", out.baseline);
put("helplines.json", out.helplines);
put("staff.json", out.staff);
put("personas.json", out.personas);
put("meta.json", out.meta);

// Copy rule: no en or em dashes anywhere the visitor could see.
const DASH = /[\u2013\u2014]/;
const dashed = [...files].filter(([, text]) => DASH.test(text)).map(([p]) => p);
if (dashed.length) {
  console.error(`En or em dash found in: ${dashed.join(", ")}. Fix the source data in data/ and run again.`);
  process.exit(1);
}

function existing(): Map<string, string> {
  const m = new Map<string, string>();
  const walk = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel);
      else if (e.name.endsWith(".json")) m.set(rel, readFileSync(join(dir, e.name), "utf8"));
    }
  };
  walk(OUT, "");
  return m;
}

const before = existing();
const changed = [...files].filter(([p, text]) => before.get(p) !== text).map(([p]) => p);
const stale = [...before.keys()].filter((p) => !files.has(p));

if (check) {
  if (changed.length || stale.length) {
    console.error(
      `public/data is out of date: ${changed.length} file(s) differ, ${stale.length} stale. Run npm run data:public.`,
    );
    process.exit(1);
  }
  console.log(`public/data is up to date (${files.size} files).`);
  process.exit(0);
}

mkdirSync(CASES, { recursive: true });
for (const p of stale) rmSync(join(OUT, p));
for (const p of changed) {
  const target = join(OUT, p);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, files.get(p)!, "utf8");
  renameSync(tmp, target);
}

const bytes = (p: string) => Buffer.byteLength(files.get(p) ?? "", "utf8");
const caseSizes = [...files.keys()].filter((p) => p.startsWith("cases/")).map(bytes);
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
console.log(
  [
    `public/data: ${files.size} files, ${changed.length} written, ${stale.length} removed.`,
    `  queue.json ${kb(bytes("queue.json"))} (${out.meta.counts.queue} rows)`,
    `  cases/ ${caseSizes.length} files, largest ${kb(Math.max(...caseSizes))}`,
    `  eval-report.json ${kb(bytes("eval-report.json"))}`,
    `  models sort=${out.meta.models.sort} draft=${out.meta.models.draft}${out.meta.isMock ? " (sample results: the UI shows a notice)" : ""}`,
  ].join("\n"),
);
