import { createServer } from "node:http";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadDotEnv(filePath) {
  const text = await readFile(filePath, "utf8").catch(() => "");
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

await loadDotEnv(path.resolve(__dirname, "..", ".env"));

const CONFIG = {
  port: Number(process.env.PORT || 4567),
  workerToken: process.env.WORKER_API_TOKEN || "",
  callbackBase: process.env.WEB_CALLBACK_BASE || "",
  cliExe: process.env.BLOCKMESH_EXE || path.resolve(__dirname, "..", "..", "release", "BlockMeshCLI Sim", "blockmesh.exe"),
  cliScript: process.env.BLOCKMESH_SCRIPT || "",
  workspaceRoot: process.env.WORKER_WORKSPACE || path.resolve(__dirname, "..", ".work"),
  concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1)),
  statusIntervalMs: Math.max(3000, Number(process.env.WORKER_STATUS_INTERVAL_MS || 10000)),
  cleanupSuccessfulJobs: process.env.WORKER_KEEP_WORKSPACES !== "1",
};

const queue = [];
const jobs = new Map();
let activeCount = 0;
const SECRET_KEY_PATTERN = /(cookie|password|token|csrf|authorization|account_text|accountText|secret)/i;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function requireAuth(req) {
  if (!CONFIG.workerToken) return false;
  const auth = req.headers.authorization || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return token === CONFIG.workerToken;
}

function sanitizeReportValue(value, depth = 0) {
  if (depth > 8) return "[Max depth]";
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeReportValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeReportValue(entry, depth + 1);
  }
  return output;
}

function sanitizeReport(report, fallback) {
  const sanitized = sanitizeReportValue(report || {});
  const safe = {
    ...sanitized,
    jobId: fallback.jobId,
    accountsUsed: Number(sanitized.accountsUsed ?? sanitized.parsedAccounts ?? fallback.accountCount ?? 0),
    directedPairs: Number(sanitized.directedPairs ?? fallback.directedPairs ?? 0),
    blocked: Number(sanitized.blocked ?? 0),
    alreadyBlocked: Number(sanitized.alreadyBlocked ?? sanitized.already_blocked ?? 0),
    failed: Number(sanitized.failed ?? 0),
    generatedAt: sanitized.generatedAt || new Date().toISOString(),
    secretsPolicy: "cookies/passwords/tokens are never included in reports",
  };
  return safe;
}

async function postCallback(url, payload) {
  if (!url) return { ok: false, skipped: true };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CONFIG.workerToken}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

function callbackUrl(job, action) {
  if (action === "complete" && job.callbackUrl) return job.callbackUrl;
  const base = job.callbackBase || CONFIG.callbackBase;
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/api/worker/jobs/${encodeURIComponent(job.jobId)}/${action}`;
}

async function newestReport(reportsDir) {
  const files = await readdir(reportsDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const file of files) {
    if (!file.isFile() || !/^block-report-.*\.json$/i.test(file.name)) continue;
    const fullPath = path.join(reportsDir, file.name);
    const text = await readFile(fullPath, "utf8").catch(() => "");
    candidates.push({ fullPath, text });
  }
  candidates.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
  const latest = candidates.at(-1);
  if (!latest?.text) return null;
  return JSON.parse(latest.text);
}

function updateCountersFromLine(job, line) {
  if (/ALREADY BLOCKED/i.test(line)) job.alreadyBlocked += 1;
  else if (/\bOK via\b/i.test(line)) job.blocked += 1;
  else if (/\bFAILED\b|status=429|timeout/i.test(line)) job.failed += 1;
}

async function writeRunLog(job, text) {
  if (!job.logStream) return;
  const clean = text
    .replace(/_\|WARNING:[^\s"]+/g, "[REDACTED_COOKIE]")
    .replace(/csrf[-_ ]?token[:=]\s*[^\s"]+/gi, "csrfToken=[REDACTED]");
  job.logStream.write(clean);
}

function cliArgs(job, cookiesFile) {
  const mode = job.mode === "stable" ? "safe" : "balanced";
  const args = [
    "apply",
    "--cookies",
    cookiesFile,
    "--mode",
    mode,
    "--allow-unverified-blocklist",
    "--skip-block-list-check",
  ];
  return CONFIG.cliScript ? [CONFIG.cliScript, ...args] : args;
}

async function runJob(job) {
  activeCount += 1;
  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.workspace = path.join(CONFIG.workspaceRoot, job.jobId);
  jobs.set(job.jobId, job);

  const cookiesFile = path.join(job.workspace, "cookies.txt");
  const logFile = path.join(job.workspace, "worker.log");
  const statusUrl = callbackUrl(job, "status");
  const completeUrl = callbackUrl(job, "complete");

  try {
    await mkdir(job.workspace, { recursive: true });
    await mkdir(path.join(job.workspace, "reports"), { recursive: true });
    await writeFile(cookiesFile, job.accountText, "utf8");
    job.accountText = "";
    job.logStream = createWriteStream(logFile, { flags: "a" });

    await postCallback(statusUrl, {
      status: "running",
      workerRegion: "external-node",
      blocked: 0,
      alreadyBlocked: 0,
      failed: 0,
    });

    const child = spawn(CONFIG.cliExe, cliArgs(job, cookiesFile), {
      cwd: job.workspace,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    job.child = child;

    const statusTimer = setInterval(() => {
      void postCallback(statusUrl, {
        status: job.status === "cancelling" ? "cancelled" : "running",
        workerRegion: "external-node",
        blocked: job.blocked,
        alreadyBlocked: job.alreadyBlocked,
        failed: job.failed,
      });
    }, CONFIG.statusIntervalMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) updateCountersFromLine(job, line);
      void writeRunLog(job, text);
    });

    child.stderr.on("data", (chunk) => {
      void writeRunLog(job, chunk.toString("utf8"));
    });

    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    clearInterval(statusTimer);

    if (job.status === "cancelling") {
      job.status = "cancelled";
      await postCallback(completeUrl, {
        status: "cancelled",
        blocked: job.blocked,
        alreadyBlocked: job.alreadyBlocked,
        failed: Math.max(job.failed, job.directedPairs - job.blocked - job.alreadyBlocked),
        error: "Job cancelled by request",
      });
      return;
    }

    const report = await newestReport(path.join(job.workspace, "reports")).catch(() => null);
    const safeReport = sanitizeReport(report || {}, job);
    if (!report && code !== 0) {
      safeReport.failed = Math.max(Number(safeReport.failed || 0), job.directedPairs - Number(safeReport.blocked || 0) - Number(safeReport.alreadyBlocked || 0));
      safeReport.error = `BlockMesh CLI exited with code ${code}`;
    }

    job.status = code === 0 ? "completed" : "failed";
    await postCallback(completeUrl, {
      status: job.status,
      blocked: safeReport.blocked,
      alreadyBlocked: safeReport.alreadyBlocked,
      failed: safeReport.failed,
      report: safeReport,
      error: safeReport.error,
    });
  } catch (error) {
    job.status = "failed";
    await postCallback(completeUrl, {
      status: "failed",
      blocked: job.blocked,
      alreadyBlocked: job.alreadyBlocked,
      failed: Math.max(job.failed, job.directedPairs - job.blocked - job.alreadyBlocked),
      error: error instanceof Error ? error.message : "Unknown worker error",
      report: sanitizeReport({ error: error instanceof Error ? error.message : "Unknown worker error" }, job),
    });
  } finally {
    job.finishedAt = new Date().toISOString();
    job.child = null;
    job.logStream?.end();
    activeCount -= 1;
    if (CONFIG.cleanupSuccessfulJobs && job.status === "completed") {
      await rm(job.workspace, { recursive: true, force: true }).catch(() => undefined);
    } else {
      await rm(cookiesFile, { force: true }).catch(() => undefined);
    }
    processQueue();
  }
}

function processQueue() {
  while (activeCount < CONFIG.concurrency && queue.length > 0) {
    const next = queue.shift();
    if (next) void runJob(next);
  }
}

function jobSnapshot(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    mode: job.mode,
    accountCount: job.accountCount,
    directedPairs: job.directedPairs,
    blocked: job.blocked,
    alreadyBlocked: job.alreadyBlocked,
    failed: job.failed,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

async function handleJobCreate(req, res) {
  const body = await readBody(req);
  const jobId = String(body.jobId || "");
  const accountText = String(body.accountText || "");
  const accountCount = Number(body.accountCount || 0);
  const directedPairs = Number(body.directedPairs || 0);
  const mode = body.mode === "stable" ? "stable" : "balanced";

  if (!jobId || !accountText.trim()) return json(res, 400, { error: "jobId and accountText are required" });
  if (!Number.isFinite(accountCount) || accountCount < 2) return json(res, 400, { error: "accountCount is invalid" });
  if (!Number.isFinite(directedPairs) || directedPairs < 1) return json(res, 400, { error: "directedPairs is invalid" });
  if (jobs.has(jobId)) return json(res, 409, { error: "Job already exists" });

  const job = {
    jobId,
    userId: String(body.userId || ""),
    mode,
    accountCount,
    directedPairs,
    pricePerPairBaht: Number(body.pricePerPairBaht || 0),
    accountText,
    callbackUrl: typeof body.callbackUrl === "string" ? body.callbackUrl : "",
    callbackBase: typeof body.callbackBase === "string" ? body.callbackBase : "",
    status: "queued",
    queuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    workspace: "",
    child: null,
    logStream: null,
    blocked: 0,
    alreadyBlocked: 0,
    failed: 0,
  };

  jobs.set(jobId, job);
  queue.push(job);
  processQueue();
  return json(res, 202, { queued: true, job: jobSnapshot(job), queueDepth: queue.length, activeCount });
}

async function handleCancel(jobId, res) {
  const job = jobs.get(jobId);
  if (!job) return json(res, 404, { error: "Job not found" });
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return json(res, 200, { ok: true, job: jobSnapshot(job) });
  }

  job.status = "cancelling";
  const queuedIndex = queue.findIndex((queuedJob) => queuedJob.jobId === jobId);
  if (queuedIndex >= 0) {
    queue.splice(queuedIndex, 1);
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    await postCallback(callbackUrl(job, "complete"), {
      status: "cancelled",
      blocked: 0,
      alreadyBlocked: 0,
      failed: job.directedPairs,
      error: "Job cancelled while queued",
    });
  } else if (job.child) {
    job.child.kill();
  }

  return json(res, 200, { ok: true, job: jobSnapshot(job) });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/health") {
      return json(res, 200, { ok: true, activeCount, queueDepth: queue.length, jobs: jobs.size });
    }

    if (!requireAuth(req)) return json(res, 401, { error: "Invalid worker token" });

    if (req.method === "POST" && url.pathname === "/jobs") return await handleJobCreate(req, res);

    const cancelMatch = url.pathname.match(/^\/jobs\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelMatch) return await handleCancel(decodeURIComponent(cancelMatch[1]), res);

    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobMatch) {
      const job = jobs.get(decodeURIComponent(jobMatch[1]));
      return job ? json(res, 200, { job: jobSnapshot(job) }) : json(res, 404, { error: "Job not found" });
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
}

await mkdir(CONFIG.workspaceRoot, { recursive: true });

createServer((req, res) => {
  void handleRequest(req, res);
}).listen(CONFIG.port, "0.0.0.0", () => {
  console.log(`BlockMesh worker listening on :${CONFIG.port}`);
  console.log(`CLI: ${CONFIG.cliExe}`);
  console.log(`Workspace: ${CONFIG.workspaceRoot}`);
  console.log(`Concurrency: ${CONFIG.concurrency}`);
});
