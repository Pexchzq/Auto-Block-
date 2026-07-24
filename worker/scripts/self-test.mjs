import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(workerRoot, "..");
const nodeExe = process.execPath;
const token = `test-${Date.now()}`;
const workerPort = 4577;
const callbackPort = 4578;
const workspace = path.join(workerRoot, ".work-self-test");
const callbacks = [];

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const callbackServer = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const payload = body ? JSON.parse(body) : {};
    callbacks.push({ url: req.url, auth: req.headers.authorization || "", payload });
    json(res, 200, { ok: true });
  });
});

await new Promise((resolve) => callbackServer.listen(callbackPort, "127.0.0.1", resolve));

const worker = spawn(nodeExe, ["src/server.js"], {
  cwd: workerRoot,
  windowsHide: true,
  env: {
    ...process.env,
    PORT: String(workerPort),
    WORKER_API_TOKEN: token,
    WEB_CALLBACK_BASE: `http://127.0.0.1:${callbackPort}`,
    BLOCKMESH_EXE: nodeExe,
    BLOCKMESH_SCRIPT: path.join(workerRoot, "scripts", "fake-blockmesh-cli.mjs"),
    WORKER_WORKSPACE: workspace,
    WORKER_KEEP_WORKSPACES: "0",
    WORKER_STATUS_INTERVAL_MS: "1000",
    WORKER_CONCURRENCY: "5",
    FAKE_BLOCKMESH_DELAY_MS: "750",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
worker.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${workerPort}/health`);
      const data = await response.json();
      if (response.ok && data.ok) return;
    } catch {
      // Retry while the worker boots.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Worker did not become healthy. ${stderr}`);
}

try {
  await waitForHealth();
  async function createTestJob(jobId) {
    const response = await fetch(`http://127.0.0.1:${workerPort}/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jobId,
        userId: "self-test-user",
        mode: "balanced",
        accountCount: 2,
        directedPairs: 2,
        pricePerPairBaht: 0.01,
        accountText: "fake-a:pass:_|WARNING:-DO-NOT-SHARE-THIS.fake\nfake-b:pass:_|WARNING:-DO-NOT-SHARE-THIS.fake",
        callbackBase: `http://127.0.0.1:${callbackPort}`,
      }),
    });
    const created = await response.json();
    if (!response.ok || !created.queued) throw new Error(`Job create failed: ${JSON.stringify(created)}`);
  }

  await createTestJob("self-test-job-1");
  await createTestJob("self-test-job-2");

  const queueHealthResponse = await fetch(`http://127.0.0.1:${workerPort}/health`);
  const queueHealth = await queueHealthResponse.json();
  if (queueHealth.activeCount !== 1 || queueHealth.queueDepth !== 1) {
    throw new Error(`Worker did not serialize jobs: ${JSON.stringify(queueHealth)}`);
  }

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (callbacks.filter((item) => item.url?.includes("/complete")).length === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const completeCallbacks = callbacks.filter((item) => item.url?.includes("/complete"));
  if (completeCallbacks.length !== 2) throw new Error("Expected two complete callbacks");
  if (completeCallbacks.some((item) => item.auth !== `Bearer ${token}`)) {
    throw new Error("A complete callback did not include the expected bearer token");
  }
  for (const complete of completeCallbacks) {
    if (complete.payload.blocked !== 1 || complete.payload.alreadyBlocked !== 1 || complete.payload.failed !== 0) {
      throw new Error(`Unexpected complete payload: ${JSON.stringify(complete.payload)}`);
    }
    if (complete.payload.report?.diagnostics?.cookie !== "[REDACTED]") {
      throw new Error(`Report cookie field was not redacted: ${JSON.stringify(complete.payload.report)}`);
    }
    if (complete.payload.report?.diagnostics?.nested?.csrfToken !== "[REDACTED]") {
      throw new Error(`Nested CSRF field was not redacted: ${JSON.stringify(complete.payload.report)}`);
    }
  }

  const firstCompleteIndex = callbacks.findIndex((item) => item.url?.includes("/self-test-job-1/complete"));
  const secondRunningIndex = callbacks.findIndex((item) => (
    item.url?.includes("/self-test-job-2/status") && item.payload?.status === "running"
  ));
  if (firstCompleteIndex < 0 || secondRunningIndex < 0 || secondRunningIndex < firstCompleteIndex) {
    throw new Error(`FIFO callback order was not preserved: ${JSON.stringify(callbacks.map((item) => item.url))}`);
  }

  console.log(JSON.stringify({
    ok: true,
    serialized: queueHealth,
    callbacks: callbacks.map((item) => item.url),
    complete: completeCallbacks.map((item) => item.payload),
  }, null, 2));
} finally {
  worker.kill();
  callbackServer.close();
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  await rm(path.join(repoRoot, ".tmp", "blockmesh-jobs", "self-test-job-1"), { recursive: true, force: true }).catch(() => undefined);
  await rm(path.join(repoRoot, ".tmp", "blockmesh-jobs", "self-test-job-2"), { recursive: true, force: true }).catch(() => undefined);
}
