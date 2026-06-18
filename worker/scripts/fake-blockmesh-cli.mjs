import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const reportsDir = path.join(process.cwd(), "reports");
await mkdir(reportsDir, { recursive: true });

console.log("[fake-a] Blocking -> fake-b...");
console.log("OK via user-blocking-api");
console.log("[fake-b] Blocking -> fake-a...");
console.log("ALREADY BLOCKED via user-blocking-api");

await writeFile(path.join(reportsDir, "block-report-fake.json"), JSON.stringify({
  command: "apply",
  generatedAt: new Date().toISOString(),
  accountsUsed: 2,
  directedPairs: 2,
  blocked: 1,
  alreadyBlocked: 1,
  failed: 0,
  durationMs: 120,
  fake: true,
  diagnostics: {
    cookie: "_|WARNING:-DO-NOT-SHARE-THIS.fake",
    nested: {
      csrfToken: "secret-csrf",
      safeValue: "visible",
    },
  },
}, null, 2), "utf8");
