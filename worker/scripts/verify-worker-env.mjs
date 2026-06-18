import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(__dirname, "..");
const envPath = path.join(workerRoot, ".env");

async function loadDotEnv(filePath) {
  const text = await readFile(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"(.*)"$/, "$1");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function status(name, ok, detail = "") {
  const mark = ok ? "OK" : "FAIL";
  console.log(`${mark} ${name}${detail ? ` - ${detail}` : ""}`);
  return ok;
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

let passed = true;

console.log("BlockMesh worker readiness check\n");

try {
  await loadDotEnv(envPath);
  passed = status("worker .env", true, envPath) && passed;
} catch {
  passed = status("worker .env", false, "copy .env.example to .env and edit it first") && passed;
}

const token = process.env.WORKER_API_TOKEN || "";
const callbackBase = process.env.WEB_CALLBACK_BASE || "";
const cliExe = process.env.BLOCKMESH_EXE || "";
const cliScript = process.env.BLOCKMESH_SCRIPT || "";
const workspace = process.env.WORKER_WORKSPACE || path.join(workerRoot, ".work");
const port = Number(process.env.PORT || 4567);
const concurrency = Number(process.env.WORKER_CONCURRENCY || 1);
const statusIntervalMs = Number(process.env.WORKER_STATUS_INTERVAL_MS || 10000);

passed = status("WORKER_API_TOKEN", token.length >= 32, token ? "minimum 32 characters recommended" : "missing") && passed;
passed = status("WEB_CALLBACK_BASE", Boolean(callbackBase), callbackBase || "missing") && passed;
if (callbackBase) {
  passed = status("WEB_CALLBACK_BASE protocol", callbackBase.startsWith("https://") || isLocalUrl(callbackBase), "use HTTPS outside localhost") && passed;
}

passed = status("PORT", Number.isInteger(port) && port > 0 && port < 65536, String(process.env.PORT || 4567)) && passed;
passed = status("WORKER_CONCURRENCY", Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 10, String(process.env.WORKER_CONCURRENCY || 1)) && passed;
passed = status("WORKER_STATUS_INTERVAL_MS", Number.isInteger(statusIntervalMs) && statusIntervalMs >= 3000, String(process.env.WORKER_STATUS_INTERVAL_MS || 10000)) && passed;

if (cliScript) {
  await access(cliScript).then(
    () => { passed = status("BLOCKMESH_SCRIPT", true, cliScript) && passed; },
    () => { passed = status("BLOCKMESH_SCRIPT", false, `${cliScript} not found`) && passed; },
  );
} else {
  passed = status("BLOCKMESH_SCRIPT disabled", true, "production mode");
  await access(cliExe).then(
    () => { passed = status("BLOCKMESH_EXE", true, cliExe) && passed; },
    () => { passed = status("BLOCKMESH_EXE", false, `${cliExe || "missing"} not found`) && passed; },
  );
}

try {
  await mkdir(workspace, { recursive: true });
  const probe = path.join(workspace, `.write-test-${Date.now()}.tmp`);
  await writeFile(probe, "ok", "utf8");
  await rm(probe, { force: true });
  passed = status("WORKER_WORKSPACE writable", true, workspace) && passed;
} catch (error) {
  passed = status("WORKER_WORKSPACE writable", false, error instanceof Error ? error.message : "write test failed") && passed;
}

passed = status("WORKER_KEEP_WORKSPACES", process.env.WORKER_KEEP_WORKSPACES !== "1", process.env.WORKER_KEEP_WORKSPACES === "1" ? "debug workspaces should be disabled in production" : "cleanup enabled") && passed;

console.log(`\nResult: ${passed ? "READY" : "NOT READY"}`);
process.exit(passed ? 0 : 1);
