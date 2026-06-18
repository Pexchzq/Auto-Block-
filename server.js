#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const mesh = require("./block-mesh.js");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3456);
const PUBLIC_DIR = path.join(__dirname, "public");
const SETTINGS_FILE = path.join(__dirname, "settings.json");

const DEFAULT_SETTINGS = {
  authMode: "local",
  requestDelayMinMs: 1500,
  requestDelayMaxMs: 3000,
  max429Retries: 0,
  allowUnverifiedBlockList: true,
  applyMode: "balanced",
  accountConcurrency: 8,
  accountLimit: 0,
  validateConcurrency: 10,
  perAccountDelayMinMs: 500,
  perAccountDelayMaxMs: 900,
  cooldownOn429Ms: 12000,
  skipBlockListCheck: true,
};

const jobs = new Map();

function requireEntitlement(featureName) {
  return {
    ok: true,
    featureName,
    mode: "local",
  };
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadSettings() {
  const saved = readJsonFile(SETTINGS_FILE, {});
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  settings.requestDelayMinMs = clampNumber(settings.requestDelayMinMs, 250, 60000, DEFAULT_SETTINGS.requestDelayMinMs);
  settings.requestDelayMaxMs = clampNumber(settings.requestDelayMaxMs, settings.requestDelayMinMs, 120000, DEFAULT_SETTINGS.requestDelayMaxMs);
  settings.max429Retries = clampNumber(settings.max429Retries, 0, 10, DEFAULT_SETTINGS.max429Retries);
  settings.allowUnverifiedBlockList = Boolean(settings.allowUnverifiedBlockList);
  if (!["safe", "balanced", "aggressive"].includes(settings.applyMode)) settings.applyMode = "balanced";
  settings.accountConcurrency = clampNumber(settings.accountConcurrency, 1, 20, DEFAULT_SETTINGS.accountConcurrency);
  settings.accountLimit = clampNumber(settings.accountLimit, 0, 10000, DEFAULT_SETTINGS.accountLimit);
  settings.validateConcurrency = clampNumber(settings.validateConcurrency, 1, 50, DEFAULT_SETTINGS.validateConcurrency);
  settings.perAccountDelayMinMs = clampNumber(settings.perAccountDelayMinMs, 0, 60000, DEFAULT_SETTINGS.perAccountDelayMinMs);
  settings.perAccountDelayMaxMs = clampNumber(settings.perAccountDelayMaxMs, settings.perAccountDelayMinMs, 120000, DEFAULT_SETTINGS.perAccountDelayMaxMs);
  settings.cooldownOn429Ms = clampNumber(settings.cooldownOn429Ms, 0, 300000, DEFAULT_SETTINGS.cooldownOn429Ms);
  settings.skipBlockListCheck = Boolean(settings.skipBlockListCheck);
  settings.authMode = "local";
  return settings;
}

function applySettings(settings) {
  mesh.setRuntimeConfig({
    requestDelayMinMs: settings.requestDelayMinMs,
    requestDelayMaxMs: settings.requestDelayMaxMs,
    max429Retries: settings.max429Retries,
    allowUnverifiedBlockList: settings.allowUnverifiedBlockList,
    applyMode: settings.applyMode,
    accountConcurrency: settings.accountConcurrency,
    accountLimit: settings.accountLimit,
    validateConcurrency: settings.validateConcurrency,
    perAccountDelayMinMs: settings.perAccountDelayMinMs,
    perAccountDelayMaxMs: settings.perAccountDelayMaxMs,
    cooldownOn429Ms: settings.cooldownOn429Ms,
    skipBlockListCheck: settings.skipBlockListCheck,
  });
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".md") return "text/plain; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function sendJson(response, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function accountPreview() {
  if (!fs.existsSync(mesh.DEFAULT_COOKIES_FILE)) {
    return {
      exists: false,
      accounts: [],
      invalid: [],
      count: 0,
    };
  }

  const { accounts, invalid } = mesh.parseCookiesFile(mesh.DEFAULT_COOKIES_FILE);
  return {
    exists: true,
    count: accounts.length,
    invalid,
    accounts: accounts.map((account) => ({
      lineNo: account.lineNo,
      alias: account.alias,
      cookieFormat: "present",
    })),
  };
}

function listReports() {
  if (!fs.existsSync(mesh.REPORTS_DIR)) return [];
  return fs
    .readdirSync(mesh.REPORTS_DIR)
    .filter((name) => /^block-report-.*\.json$/i.test(name))
    .sort()
    .reverse()
    .map((name) => {
      const filePath = path.join(mesh.REPORTS_DIR, name);
      const stat = fs.statSync(filePath);
      let summary = null;
      let command = null;
      let generatedAt = null;
      try {
        const report = JSON.parse(fs.readFileSync(filePath, "utf8"));
        summary = report.summary || null;
        command = report.command || null;
        generatedAt = report.generatedAt || null;
      } catch {
        summary = null;
      }
      return {
        name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        generatedAt,
        command,
        summary,
      };
    });
}

function latestState() {
  const state = readJsonFile(mesh.STATE_FILE, null);
  const reports = listReports();
  return {
    state,
    latestReport: reports[0] || null,
  };
}

function createJob(type) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const job = {
    id,
    type,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
    result: null,
    error: null,
    cancelRequested: false,
    cancelledAt: null,
  };
  jobs.set(id, job);
  return job;
}

function appendJobLog(job, message) {
  const clean = mesh.sanitizeError(String(message || "").trimEnd());
  if (!clean) return;
  job.logs.push({
    at: new Date().toISOString(),
    message: clean,
  });
  if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500);
  job.updatedAt = new Date().toISOString();
}

function runApplyJob(job, options) {
  setImmediate(async () => {
    job.status = "running";
    job.updatedAt = new Date().toISOString();

    try {
      const settings = loadSettings();
      applySettings(settings);
      const result = await mesh.commandApply({
        cookiesFile: mesh.DEFAULT_COOKIES_FILE,
        allowUnverifiedBlockList: Boolean(options.allowUnverifiedBlockList),
        applyMode: options.applyMode,
        accountConcurrency: options.accountConcurrency,
        accountLimit: options.accountLimit,
        validateConcurrency: options.validateConcurrency,
        perAccountDelayMinMs: options.perAccountDelayMinMs,
        perAccountDelayMaxMs: options.perAccountDelayMaxMs,
        cooldownOn429Ms: options.cooldownOn429Ms,
        skipBlockListCheck: options.skipBlockListCheck,
        cancelToken: {
          isCancelled: () => Boolean(job.cancelRequested),
        },
        logger: {
          write: (message) => appendJobLog(job, message),
          log: (message) => appendJobLog(job, message),
        },
      });
      job.result = {
        reportPath: result.reportPath,
        reportName: path.basename(result.reportPath),
        summary: result.report.summary,
      };
      job.status = result.report.summary.cancelled ? "cancelled" : "completed";
      if (job.status === "cancelled" && !job.cancelledAt) {
        job.cancelledAt = new Date().toISOString();
      }
    } catch (error) {
      job.status = "failed";
      job.error = mesh.sanitizeError(error.message);
      appendJobLog(job, `Fatal: ${job.error}`);
    } finally {
      job.updatedAt = new Date().toISOString();
    }
  });
}

function runRetryFailedJob(job, options) {
  setImmediate(async () => {
    job.status = "running";
    job.updatedAt = new Date().toISOString();

    try {
      const settings = loadSettings();
      applySettings(settings);
      const result = await mesh.commandRetryFailed({
        cookiesFile: mesh.DEFAULT_COOKIES_FILE,
        reportFile: options.reportFile,
        allowUnverifiedBlockList: Boolean(options.allowUnverifiedBlockList),
        skipBlockListCheck: options.skipBlockListCheck,
        applyMode: options.applyMode,
        accountConcurrency: options.accountConcurrency,
        accountLimit: options.accountLimit,
        validateConcurrency: options.validateConcurrency,
        perAccountDelayMinMs: options.perAccountDelayMinMs,
        perAccountDelayMaxMs: options.perAccountDelayMaxMs,
        cooldownOn429Ms: options.cooldownOn429Ms,
        cancelToken: {
          isCancelled: () => Boolean(job.cancelRequested),
        },
        logger: {
          write: (message) => appendJobLog(job, message),
          log: (message) => appendJobLog(job, message),
        },
      });
      job.result = {
        reportPath: result.reportPath,
        reportName: path.basename(result.reportPath),
        summary: result.report.summary,
      };
      job.status = result.report.summary.cancelled ? "cancelled" : "completed";
      if (job.status === "cancelled" && !job.cancelledAt) {
        job.cancelledAt = new Date().toISOString();
      }
    } catch (error) {
      job.status = "failed";
      job.error = mesh.sanitizeError(error.message);
      appendJobLog(job, `Fatal: ${job.error}`);
    } finally {
      job.updatedAt = new Date().toISOString();
    }
  });
}

async function handleApi(request, response, url) {
  const settings = loadSettings();
  applySettings(settings);

  if (request.method === "GET" && url.pathname === "/api/status") {
    sendJson(response, 200, {
      ok: true,
      app: "Roblox Block Mesh Local UI",
      bind: `${HOST}:${PORT}`,
      settings,
      entitlement: requireEntitlement("block-mesh"),
      ...latestState(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/accounts") {
    sendJson(response, 200, accountPreview());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/accounts/save") {
    const body = await readBody(request);
    const text = String(body.text || "").trim();
    fs.writeFileSync(mesh.DEFAULT_COOKIES_FILE, text ? `${text}\n` : "", "utf8");
    sendJson(response, 200, accountPreview());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/accounts/clear") {
    if (fs.existsSync(mesh.DEFAULT_COOKIES_FILE)) fs.unlinkSync(mesh.DEFAULT_COOKIES_FILE);
    sendJson(response, 200, accountPreview());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/validate") {
    const body = await readBody(request);
    const result = await mesh.commandValidate({
      cookiesFile: mesh.DEFAULT_COOKIES_FILE,
      accountLimit: body.accountLimit === undefined ? settings.accountLimit : body.accountLimit,
      validateConcurrency: body.validateConcurrency || settings.validateConcurrency,
    });
    sendJson(response, 200, {
      reportName: path.basename(result.reportPath),
      report: result.report,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/plan") {
    const body = await readBody(request);
    const result = await mesh.commandPlan({
      cookiesFile: mesh.DEFAULT_COOKIES_FILE,
      accountLimit: body.accountLimit === undefined ? settings.accountLimit : body.accountLimit,
      validateConcurrency: body.validateConcurrency || settings.validateConcurrency,
      allowUnverifiedBlockList:
        body.allowUnverifiedBlockList === undefined
          ? settings.allowUnverifiedBlockList
          : Boolean(body.allowUnverifiedBlockList),
      skipBlockListCheck:
        body.skipBlockListCheck === undefined ? settings.skipBlockListCheck : Boolean(body.skipBlockListCheck),
    });
    sendJson(response, 200, {
      reportName: path.basename(result.reportPath),
      report: result.report,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/apply") {
    const body = await readBody(request);
    const entitlement = requireEntitlement("apply");
    if (!entitlement.ok) {
      sendJson(response, 402, { ok: false, error: "entitlement_required" });
      return;
    }

    const existing = Array.from(jobs.values()).find((job) => job.status === "queued" || job.status === "running");
    if (existing) {
      sendJson(response, 409, { ok: false, error: "job_already_running", job: existing });
      return;
    }

    const job = createJob("apply");
    runApplyJob(job, {
      allowUnverifiedBlockList:
        body.allowUnverifiedBlockList === undefined
          ? settings.allowUnverifiedBlockList
          : Boolean(body.allowUnverifiedBlockList),
      applyMode: body.applyMode || settings.applyMode,
      accountConcurrency: body.accountConcurrency || settings.accountConcurrency,
      accountLimit: body.accountLimit === undefined ? settings.accountLimit : body.accountLimit,
      validateConcurrency: body.validateConcurrency || settings.validateConcurrency,
      perAccountDelayMinMs: body.perAccountDelayMinMs || settings.perAccountDelayMinMs,
      perAccountDelayMaxMs: body.perAccountDelayMaxMs || settings.perAccountDelayMaxMs,
      cooldownOn429Ms: body.cooldownOn429Ms || settings.cooldownOn429Ms,
      skipBlockListCheck:
        body.skipBlockListCheck === undefined ? settings.skipBlockListCheck : Boolean(body.skipBlockListCheck),
    });
    sendJson(response, 202, { ok: true, job });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/retry-failed") {
    const body = await readBody(request);
    const entitlement = requireEntitlement("retry-failed");
    if (!entitlement.ok) {
      sendJson(response, 402, { ok: false, error: "entitlement_required" });
      return;
    }

    const existing = Array.from(jobs.values()).find((job) => job.status === "queued" || job.status === "running");
    if (existing) {
      sendJson(response, 409, { ok: false, error: "job_already_running", job: existing });
      return;
    }

    const reportName = path.basename(String(body.reportName || ""));
    if (!/^block-report-.*\.json$/i.test(reportName)) {
      sendJson(response, 400, { ok: false, error: "invalid_report_name" });
      return;
    }
    const reportFile = path.join(mesh.REPORTS_DIR, reportName);
    if (!fs.existsSync(reportFile)) {
      sendJson(response, 404, { ok: false, error: "report_not_found" });
      return;
    }

    const job = createJob("retry-failed");
    runRetryFailedJob(job, {
      reportFile,
      allowUnverifiedBlockList:
        body.allowUnverifiedBlockList === undefined
          ? settings.allowUnverifiedBlockList
          : Boolean(body.allowUnverifiedBlockList),
      skipBlockListCheck:
        body.skipBlockListCheck === undefined ? settings.skipBlockListCheck : Boolean(body.skipBlockListCheck),
      applyMode: body.applyMode || settings.applyMode,
      accountConcurrency: body.accountConcurrency || settings.accountConcurrency,
      accountLimit: body.accountLimit === undefined ? settings.accountLimit : body.accountLimit,
      validateConcurrency: body.validateConcurrency || settings.validateConcurrency,
      perAccountDelayMinMs: body.perAccountDelayMinMs || settings.perAccountDelayMinMs,
      perAccountDelayMaxMs: body.perAccountDelayMaxMs || settings.perAccountDelayMaxMs,
      cooldownOn429Ms: body.cooldownOn429Ms || settings.cooldownOn429Ms,
    });
    sendJson(response, 202, { ok: true, job });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/cancel")) {
    const jobId = decodeURIComponent(url.pathname.slice("/api/jobs/".length, -"/cancel".length));
    const job = jobs.get(jobId);
    if (!job) {
      sendJson(response, 404, { ok: false, error: "job_not_found" });
      return;
    }
    if (job.status === "queued" || job.status === "running") {
      job.cancelRequested = true;
      job.cancelledAt = new Date().toISOString();
      job.updatedAt = new Date().toISOString();
      appendJobLog(job, "Cancel requested. The current request will finish, then the job will stop.");
    }
    sendJson(response, 200, { ok: true, job });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
    const jobId = decodeURIComponent(url.pathname.slice("/api/jobs/".length));
    const job = jobs.get(jobId);
    if (!job) {
      sendJson(response, 404, { ok: false, error: "job_not_found" });
      return;
    }
    sendJson(response, 200, { ok: true, job });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/reports") {
    sendJson(response, 200, { reports: listReports() });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/reports/")) {
    const name = path.basename(decodeURIComponent(url.pathname.slice("/api/reports/".length)));
    if (!/^block-report-.*\.json$/i.test(name)) {
      sendJson(response, 400, { ok: false, error: "invalid_report_name" });
      return;
    }
    const filePath = path.join(mesh.REPORTS_DIR, name);
    if (!fs.existsSync(filePath)) {
      sendJson(response, 404, { ok: false, error: "report_not_found" });
      return;
    }
    sendJson(response, 200, JSON.parse(fs.readFileSync(filePath, "utf8")));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    const body = await readBody(request);
    const next = {
      ...settings,
      requestDelayMinMs: clampNumber(body.requestDelayMinMs, 250, 60000, settings.requestDelayMinMs),
      requestDelayMaxMs: clampNumber(body.requestDelayMaxMs, 250, 120000, settings.requestDelayMaxMs),
      max429Retries: clampNumber(body.max429Retries, 0, 10, settings.max429Retries),
      allowUnverifiedBlockList: Boolean(body.allowUnverifiedBlockList),
      applyMode: ["safe", "balanced", "aggressive"].includes(body.applyMode) ? body.applyMode : settings.applyMode,
      accountConcurrency: clampNumber(body.accountConcurrency, 1, 20, settings.accountConcurrency),
      accountLimit: clampNumber(body.accountLimit, 0, 10000, settings.accountLimit),
      validateConcurrency: clampNumber(body.validateConcurrency, 1, 50, settings.validateConcurrency),
      perAccountDelayMinMs: clampNumber(body.perAccountDelayMinMs, 0, 60000, settings.perAccountDelayMinMs),
      perAccountDelayMaxMs: clampNumber(body.perAccountDelayMaxMs, 0, 120000, settings.perAccountDelayMaxMs),
      cooldownOn429Ms: clampNumber(body.cooldownOn429Ms, 0, 300000, settings.cooldownOn429Ms),
      skipBlockListCheck: Boolean(body.skipBlockListCheck),
      authMode: "local",
    };
    if (next.requestDelayMaxMs < next.requestDelayMinMs) {
      next.requestDelayMaxMs = next.requestDelayMinMs;
    }
    if (next.perAccountDelayMaxMs < next.perAccountDelayMinMs) {
      next.perAccountDelayMaxMs = next.perAccountDelayMinMs;
    }
    writeJsonFile(SETTINGS_FILE, next);
    applySettings(next);
    sendJson(response, 200, { ok: true, settings: next });
    return;
  }

  sendJson(response, 404, { ok: false, error: "api_not_found" });
}

function serveStatic(request, response, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const baseDir = pathname === "/README.md" ? __dirname : PUBLIC_DIR;
  const filePath = path.normalize(path.join(baseDir, pathname === "/README.md" ? "README.md" : pathname));
  if (!filePath.startsWith(baseDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(response, 404, "Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    serveStatic(request, response, url);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: mesh.sanitizeError(error.message),
    });
  }
});

server.listen(PORT, HOST, () => {
  const settings = loadSettings();
  applySettings(settings);
  console.log(`Roblox Block Mesh UI running at http://${HOST}:${PORT}`);
  console.log("Local-only mode. Roblox cookies are stored on this machine only.");
});
