// Analyze the latest speed-lab apply run: per-minute throughput + per-source 429
// distribution. Confirms per-account vs per-IP rate limiting and finds the knee.
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "run-events");
const arg = process.argv[2];
let file;
if (arg) {
  file = path.isAbsolute(arg) ? arg : path.join(dir, arg);
} else {
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()
    : [];
  if (!files.length) {
    console.log("No run-events found. Run an apply first.");
    process.exit(0);
  }
  file = path.join(dir, files[files.length - 1]);
}

const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
const ev = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const finish = ev.filter((e) => e.type === "pair_finish");
const start = ev.find((e) => e.type === "apply_start");

if (!finish.length) {
  console.log(`File: ${path.basename(file)} — no pair_finish yet (${ev.length} events).`);
  process.exit(0);
}

const t0 = new Date(ev[0].at).getTime();
const buckets = {};
const perSource = {};
let first429 = null;
let total429 = 0;

for (const e of finish) {
  const m = Math.floor((new Date(e.at).getTime() - t0) / 60000);
  const b = buckets[m] || (buckets[m] = { total: 0, ok: 0, failed: 0, r429: 0, lat: 0 });
  b.total++; b.lat += e.durationMs || 0;
  if (e.status === "blocked" || e.status === "skipped_existing_api") b.ok++;
  if (e.status === "failed") b.failed++;
  const s = perSource[e.sourceAlias] || (perSource[e.sourceAlias] = { total: 0, r429: 0 });
  s.total++;
  if (e.httpStatus === 429) {
    b.r429++; s.r429++; total429++;
    if (!first429) first429 = e.at;
  }
}

const dur = (new Date(finish[finish.length - 1].at).getTime() - t0) / 60000;
const overallRate = dur > 0 ? Math.round(finish.length / dur) : finish.length;

console.log(`File: ${path.basename(file)}`);
if (start) {
  console.log(`Config: conc=${start.maxConcurrency} globalDelay=${start.globalBlockDelayMs}ms floor=${start.globalBlockDelayFloorMs}ms srcMax=${start.sourceMaxPerWindow}/win pending=${start.pendingPairs} lanes=${start.lanes}`);
}
console.log(`Done ${finish.length} in ${dur.toFixed(1)}min | overall ${overallRate}/min | 429 total=${total429} (${((total429 / finish.length) * 100).toFixed(1)}%) first=${first429 || "none"}`);

console.log(`\nmin | done | ok | failed | 429 | avgLatMs`);
for (const m of Object.keys(buckets).map(Number).sort((a, b) => a - b)) {
  const b = buckets[m];
  console.log(
    String(m).padStart(3) + " | " + String(b.total).padStart(4) + " | " + String(b.ok).padStart(4) +
    " | " + String(b.failed).padStart(6) + " | " + String(b.r429).padStart(3) + " | " + String(Math.round(b.lat / b.total)).padStart(6),
  );
}

// Per-source 429 distribution — the key signal for per-account vs per-IP.
const srcRows = Object.entries(perSource).map(([alias, s]) => ({ alias, ...s, pct: s.total ? (s.r429 / s.total) * 100 : 0 }));
const with429 = srcRows.filter((s) => s.r429 > 0).sort((a, b) => b.r429 - a.r429);
console.log(`\nSources hitting 429: ${with429.length}/${srcRows.length}`);
if (with429.length) {
  console.log(`alias           | reqs | 429 | 429%`);
  for (const s of with429.slice(0, 15)) {
    console.log(`${s.alias.padEnd(15)} | ${String(s.total).padStart(4)} | ${String(s.r429).padStart(3)} | ${s.pct.toFixed(0)}%`);
  }
  const spread = with429.length / srcRows.length;
  console.log(`\nVerdict: ${spread > 0.6 ? "429 spread across MOST sources -> likely IP/global cap" : "429 concentrated on FEW sources -> per-account cap (parallelism should scale)"}`);
}
