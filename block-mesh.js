#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const ROOT = process.pkg ? path.dirname(process.execPath) : __dirname;
const DEFAULT_COOKIES_FILE = path.join(ROOT, "cookies.txt");
const REPORTS_DIR = path.join(ROOT, "reports");
const STATE_DIR = path.join(ROOT, "state");
const STATE_FILE = path.join(STATE_DIR, "block-state.json");
const PAIR_CACHE_FILE = path.join(STATE_DIR, "block-pair-cache.json");
const DIAGNOSTICS_DIR = path.join(ROOT, "diagnostics");
const RUN_EVENTS_DIR = path.join(ROOT, "run-events");

const CONFIG = {
  requestDelayMinMs: 1500,
  requestDelayMaxMs: 3000,
  applyMode: "balanced",
  accountConcurrency: 8,
  accountLimit: 0,
  validateConcurrency: 10,
  perAccountDelayMinMs: 500,
  perAccountDelayMaxMs: 900,
  cooldownOn429Ms: 12000,
  globalCooldownOn429Ms: 0,
  globalBlockDelayMs: 350,
  globalBlockDelayFloorMs: 350,
  globalBlockDelayStartMs: 350,
  globalDelayStepMs: 25,
  globalDelayRecoveryStepMs: 100,
  globalDelayStableWindowMs: 120000,
  globalDelayHoldMs: 90000,
  speed429Threshold: 3,
  targetCooldownMs: 1800,
  recoveryHoldMs: 60000,
  sourceWindowMs: 60000,
  sourceMaxPerWindow: 24,
  source429PenaltyMs: 20000,
  requestTimeoutMs: 30000,
  skipBlockListCheck: true,
  allowUnverifiedBlockList: true,
  blockLimitWarningAt: 950,
  max429Retries: 0,
  backoff429Ms: [12000, 24000, 48000],
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 RobloxBlockMesh/1.0",
};

function setRuntimeConfig(nextConfig = {}) {
  for (const [key, value] of Object.entries(nextConfig)) {
    if (Object.prototype.hasOwnProperty.call(CONFIG, key) && value !== undefined && value !== null) {
      CONFIG[key] = value;
    }
  }

  if (nextConfig.cooldownOn429Ms !== undefined && nextConfig.cooldownOn429Ms !== null) {
    const cooldown = clampNumber(nextConfig.cooldownOn429Ms, 0, 300000, CONFIG.cooldownOn429Ms);
    CONFIG.cooldownOn429Ms = cooldown;
    CONFIG.backoff429Ms = [cooldown, cooldown * 2, cooldown * 4].map((value) => Math.min(value, 300000));
  }
}

function createLogger(logger) {
  if (!logger) {
    return {
      write: (message) => process.stdout.write(message),
      log: (message) => console.log(message),
    };
  }

  return {
    write: (message) => {
      if (typeof logger.write === "function") logger.write(message);
      else if (typeof logger.log === "function") logger.log(message);
    },
    log: (message) => {
      if (typeof logger.log === "function") logger.log(message);
      else if (typeof logger.write === "function") logger.write(`${message}\n`);
    },
  };
}

const ENDPOINTS = {
  authenticatedUser: "https://users.roblox.com/v1/users/authenticated",
  csrf: "https://auth.roblox.com/v2/logout",
  blockedUsersCandidates: [
    {
      name: "user-blocking-api",
      csrf: true,
      url: (account, cursor) => {
        const params = new URLSearchParams({
          sortOrder: "Asc",
          limit: "100",
        });
        if (cursor) params.set("cursor", cursor);
        return `https://apis.roblox.com/user-blocking-api/v1/users/get-blocked-users?${params}`;
      },
    },
  ],
  blockedUsers: (cursor) => {
    const params = new URLSearchParams({
      sortOrder: "Asc",
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);
    return `https://apis.roblox.com/user-blocking-api/v1/users/get-blocked-users?${params}`;
  },
  blockCandidates: [
    {
      name: "user-blocking-api",
      method: "POST",
      url: (targetUserId) => `https://apis.roblox.com/user-blocking-api/v1/users/${targetUserId}/block-user`,
      bodyType: "none",
      body: () => null,
    },
  ],
};

function printUsage() {
  const bin = process.pkg ? "blockmesh.exe" : "node block-mesh.js";
  console.log(`
Roblox Block Mesh

Usage:
  ${bin} validate [--cookies cookies.txt]
  ${bin} plan     [--cookies cookies.txt]
  ${bin} simulate [--cookies cookies.txt] [--account-limit 65]
  ${bin} apply    [--cookies cookies.txt] [--mode balanced|fast|turbo] [--account-concurrency 8] [--skip-block-list-check]
  ${bin} retry-failed --report reports\\block-report-xxxx.json [--cookies cookies.txt]
  ${bin} status

Input format:
  username:password:_|WARNING:-DO-NOT-SHARE-THIS...

Safety:
  This tool never prints or writes passwords, cookies, or CSRF tokens.
`);
}

function parseArgs(argv) {
  const args = {
    command: argv[2] || "help",
    cookiesFile: DEFAULT_COOKIES_FILE,
    reportFile: null,
    simulationProfile: "mixed",
    allowUnverifiedBlockList: CONFIG.allowUnverifiedBlockList,
    skipBlockListCheck: CONFIG.skipBlockListCheck,
    applyMode: CONFIG.applyMode,
    accountConcurrency: undefined,
    accountLimit: CONFIG.accountLimit,
    validateConcurrency: undefined,
    perAccountDelayMinMs: undefined,
    perAccountDelayMaxMs: undefined,
    cooldownOn429Ms: undefined,
    targetCooldownMs: undefined,
    recoveryHoldMs: undefined,
    sourceWindowMs: undefined,
    sourceMaxPerWindow: undefined,
    source429PenaltyMs: undefined,
    globalBlockDelayMs: undefined,
    globalBlockDelayFloorMs: undefined,
    globalDelayStableWindowMs: undefined,
    globalDelayHoldMs: undefined,
    speed429Threshold: undefined,
    expectAccounts: 0,
    useStateAuth: false,
    summaryOnly: false,
    progressOnly: false,
  };

  if (args.command === "--help" || args.command === "-h") {
    args.command = "help";
    return args;
  }

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cookies") {
      args.cookiesFile = path.resolve(argv[i + 1] || "");
      i += 1;
    } else if (arg === "--report") {
      args.reportFile = path.resolve(argv[i + 1] || "");
      i += 1;
    } else if (arg === "--simulation-profile") {
      args.simulationProfile = argv[i + 1] || args.simulationProfile;
      i += 1;
    } else if (arg === "--allow-unverified-blocklist") {
      args.allowUnverifiedBlockList = true;
    } else if (arg === "--no-unverified-blocklist") {
      args.allowUnverifiedBlockList = false;
    } else if (arg === "--skip-block-list-check") {
      args.skipBlockListCheck = true;
    } else if (arg === "--check-block-list") {
      args.skipBlockListCheck = false;
    } else if (arg === "--mode") {
      args.applyMode = argv[i + 1] || args.applyMode;
      i += 1;
    } else if (arg === "--account-concurrency") {
      args.accountConcurrency = Number(argv[i + 1] || args.accountConcurrency);
      i += 1;
    } else if (arg === "--account-limit") {
      args.accountLimit = Number(argv[i + 1] || args.accountLimit);
      i += 1;
    } else if (arg === "--validate-concurrency") {
      args.validateConcurrency = Number(argv[i + 1] || args.validateConcurrency);
      i += 1;
    } else if (arg === "--per-account-delay-min") {
      args.perAccountDelayMinMs = Number(argv[i + 1] || args.perAccountDelayMinMs);
      i += 1;
    } else if (arg === "--per-account-delay-max") {
      args.perAccountDelayMaxMs = Number(argv[i + 1] || args.perAccountDelayMaxMs);
      i += 1;
    } else if (arg === "--cooldown-on-429") {
      args.cooldownOn429Ms = Number(argv[i + 1] || args.cooldownOn429Ms);
      i += 1;
    } else if (arg === "--target-cooldown") {
      args.targetCooldownMs = Number(argv[i + 1] || args.targetCooldownMs);
      i += 1;
    } else if (arg === "--recovery-hold") {
      args.recoveryHoldMs = Number(argv[i + 1] || args.recoveryHoldMs);
      i += 1;
    } else if (arg === "--source-window") {
      args.sourceWindowMs = Number(argv[i + 1] || args.sourceWindowMs);
      i += 1;
    } else if (arg === "--source-max-per-window") {
      args.sourceMaxPerWindow = Number(argv[i + 1] || args.sourceMaxPerWindow);
      i += 1;
    } else if (arg === "--source-429-penalty") {
      args.source429PenaltyMs = Number(argv[i + 1] || args.source429PenaltyMs);
      i += 1;
    } else if (arg === "--global-block-delay") {
      args.globalBlockDelayMs = Number(argv[i + 1] || args.globalBlockDelayMs);
      i += 1;
    } else if (arg === "--global-block-delay-floor") {
      args.globalBlockDelayFloorMs = Number(argv[i + 1] || args.globalBlockDelayFloorMs);
      i += 1;
    } else if (arg === "--global-delay-stable-window") {
      args.globalDelayStableWindowMs = Number(argv[i + 1] || args.globalDelayStableWindowMs);
      i += 1;
    } else if (arg === "--global-delay-hold") {
      args.globalDelayHoldMs = Number(argv[i + 1] || args.globalDelayHoldMs);
      i += 1;
    } else if (arg === "--speed-429-threshold") {
      args.speed429Threshold = Number(argv[i + 1] || args.speed429Threshold);
      i += 1;
    } else if (arg === "--expect-accounts") {
      args.expectAccounts = Number(argv[i + 1] || args.expectAccounts);
      i += 1;
    } else if (arg === "--use-state-auth") {
      args.useStateAuth = true;
    } else if (arg === "--summary-only") {
      args.summaryOnly = true;
    } else if (arg === "--progress-only") {
      args.progressOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      args.command = "help";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function makeHeaders(headers) {
  const lower = new Map();
  for (const [key, value] of Object.entries(headers || {})) {
    lower.set(String(key).toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
  }
  return {
    get(name) {
      return lower.get(String(name).toLowerCase()) || null;
    },
  };
}

function nodeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "http:" ? http : https;
    const body = options.body || null;
    const headers = { ...(options.headers || {}) };

    if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) {
      headers["content-length"] = Buffer.byteLength(body);
    }

    const request = transport.request(
      parsed,
      {
        method: options.method || "GET",
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            status: response.statusCode || 0,
            ok: response.statusCode >= 200 && response.statusCode < 300,
            headers: makeHeaders(response.headers),
            text: async () => buffer.toString("utf8"),
          });
        });
      },
    );

    const timeoutMs = Number(options.timeoutMs || CONFIG.requestTimeoutMs || 30000);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`request_timeout_${timeoutMs}ms`));
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

const fetchImpl = typeof fetch === "function" ? fetch : nodeFetch;
let ACTIVE_METRICS = null;
let GLOBAL_RATE_LIMIT_UNTIL = 0;
let GLOBAL_NEXT_BLOCK_AT = 0;
let GLOBAL_BLOCK_SLOT_CHAIN = Promise.resolve();

function ensureDirs() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
  fs.mkdirSync(RUN_EVENTS_DIR, { recursive: true });
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "-",
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
    "-",
    ms,
  ].join("");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.requestTimeoutMs) {
  const timeout = Number(timeoutMs || CONFIG.requestTimeoutMs || 30000);
  if (fetchImpl === nodeFetch) {
    return nodeFetch(url, { ...options, timeoutMs: timeout });
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(new Error(`request_timeout_${timeout}ms`)), timeout)
    : null;
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller ? controller.signal : options.signal,
    });
  } catch (error) {
    if (error && (error.name === "AbortError" || String(error.message || "").includes("request_timeout"))) {
      throw new Error(`request_timeout_${timeout}ms`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createMetrics() {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: 0,
    validateDurationMs: 0,
    planDurationMs: 0,
    applyDurationMs: 0,
    requestsTotal: 0,
    rateLimitCount: 0,
    endpointFailures: {},
    averagePairMs: 0,
    pairsPerMinute: 0,
    successPairsPerMinute: 0,
    globalDelayStartMs: CONFIG.globalBlockDelayMs,
    globalDelayEndMs: CONFIG.globalBlockDelayMs,
    globalDelayMinMs: CONFIG.globalBlockDelayFloorMs,
    globalDelayTimeline: [],
    speedProfile: CONFIG.applyMode,
    recent429Count: 0,
    recentSuccessCount: 0,
    laneActiveCount: 0,
    adaptiveAdjustments: [],
    topFailureReasons: {},
    schedulerMode: "source-only",
    eventLogPath: null,
    eventCounts: {},
  };
}

function createEventLogger(command) {
  ensureDirs();
  const filePath = path.join(RUN_EVENTS_DIR, `run-events-${timestamp()}-${command}.jsonl`);
  fs.writeFileSync(filePath, "", "utf8");
  return {
    filePath,
    write(event) {
      const safeEvent = {
        at: new Date().toISOString(),
        ...event,
      };
      fs.appendFileSync(filePath, `${JSON.stringify(safeEvent)}\n`, "utf8");
      if (ACTIVE_METRICS) {
        const type = safeEvent.type || "unknown";
        ACTIVE_METRICS.eventCounts[type] = (ACTIVE_METRICS.eventCounts[type] || 0) + 1;
      }
    },
  };
}

function finishMetrics(metrics) {
  metrics.finishedAt = new Date().toISOString();
  metrics.durationMs = new Date(metrics.finishedAt).getTime() - new Date(metrics.startedAt).getTime();
  return metrics;
}

function finalizeApplySpeedMetrics(metrics, results, applyOptions) {
  const elapsedMinutes = metrics.applyDurationMs > 0 ? metrics.applyDurationMs / 60000 : 0;
  const successCount = Array.isArray(results)
    ? results.filter((item) => item.status === "blocked" || item.status === "skipped_existing_api" || item.status === "skipped_known_success").length
    : 0;
  metrics.pairsPerMinute = elapsedMinutes > 0 ? Math.round((results.length / elapsedMinutes) * 10) / 10 : 0;
  metrics.successPairsPerMinute = elapsedMinutes > 0 ? Math.round((successCount / elapsedMinutes) * 10) / 10 : 0;
  metrics.globalDelayStartMs = applyOptions.globalBlockDelayMs;
  metrics.globalDelayEndMs = CONFIG.globalBlockDelayMs;
  metrics.globalDelayMinMs = applyOptions.globalBlockDelayFloorMs;
  metrics.speedProfile = applyOptions.applyMode;
  return metrics;
}

function recordEndpointFailure(url, statusOrError) {
  if (!ACTIVE_METRICS) return;
  let host = "unknown";
  try {
    host = new URL(url).host;
  } catch {
    host = String(url || "unknown").slice(0, 80);
  }
  const key = `${host}:${statusOrError}`;
  ACTIVE_METRICS.endpointFailures[key] = (ACTIVE_METRICS.endpointFailures[key] || 0) + 1;
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));

  async function runWorker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

function randomDelay() {
  const span = CONFIG.requestDelayMaxMs - CONFIG.requestDelayMinMs;
  return CONFIG.requestDelayMinMs + Math.floor(Math.random() * (span + 1));
}

function randomBetween(minMs, maxMs) {
  const min = Math.max(0, Math.floor(Number(minMs) || 0));
  const max = Math.max(min, Math.floor(Number(maxMs) || min));
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

async function waitForGlobalRateLimit() {
  const waitMs = GLOBAL_RATE_LIMIT_UNTIL - Date.now();
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

async function waitForGlobalBlockSlot() {
  const previous = GLOBAL_BLOCK_SLOT_CHAIN;
  let release;
  GLOBAL_BLOCK_SLOT_CHAIN = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const now = Date.now();
    const waitMs = Math.max(GLOBAL_RATE_LIMIT_UNTIL, GLOBAL_NEXT_BLOCK_AT) - now;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    GLOBAL_NEXT_BLOCK_AT = Date.now() + CONFIG.globalBlockDelayMs;
  } finally {
    release();
  }
}

function recordGlobalDelayChange(reason, oldDelayMs, newDelayMs, details = {}, eventLogger = null) {
  if (oldDelayMs === newDelayMs) return;
  CONFIG.globalBlockDelayMs = newDelayMs;
  if (ACTIVE_METRICS) {
    ACTIVE_METRICS.globalDelayEndMs = newDelayMs;
    const item = {
      at: new Date().toISOString(),
      reason,
      oldDelayMs,
      newDelayMs,
      ...details,
    };
    ACTIVE_METRICS.globalDelayTimeline.push(item);
  }
  if (eventLogger) {
    eventLogger.write({
      type: "speed",
      reason,
      oldDelayMs,
      newDelayMs,
      ...details,
    });
  }
}

function normalizeApplyOptions(args = {}) {
  const presets = {
    safe: {
      accountConcurrency: 2,
      perAccountDelayMinMs: 1500,
      perAccountDelayMaxMs: 3000,
      globalBlockDelayMs: 650,
      globalBlockDelayFloorMs: 650,
      globalDelayStableWindowMs: 180000,
      globalDelayHoldMs: 120000,
      speed429Threshold: 1,
    },
    balanced: {
      accountConcurrency: 8,
      perAccountDelayMinMs: 500,
      perAccountDelayMaxMs: 900,
      targetCooldownMs: 1800,
      recoveryHoldMs: 60000,
      sourceMaxPerWindow: 24,
      globalBlockDelayMs: 350,
      globalBlockDelayFloorMs: 350,
      globalDelayStableWindowMs: 120000,
      globalDelayHoldMs: 90000,
      speed429Threshold: 3,
    },
    fast: {
      accountConcurrency: 10,
      perAccountDelayMinMs: 420,
      perAccountDelayMaxMs: 760,
      targetCooldownMs: 1500,
      recoveryHoldMs: 60000,
      sourceMaxPerWindow: 26,
      globalBlockDelayMs: 325,
      globalBlockDelayFloorMs: 260,
      globalDelayStableWindowMs: 120000,
      globalDelayHoldMs: 90000,
      speed429Threshold: 3,
    },
    turbo: {
      accountConcurrency: 12,
      perAccountDelayMinMs: 350,
      perAccountDelayMaxMs: 650,
      targetCooldownMs: 1300,
      recoveryHoldMs: 90000,
      sourceMaxPerWindow: 28,
      globalBlockDelayMs: 240,
      globalBlockDelayFloorMs: 200,
      globalDelayStableWindowMs: 120000,
      globalDelayHoldMs: 120000,
      speed429Threshold: 2,
    },
    aggressive: {
      accountConcurrency: 8,
      perAccountDelayMinMs: 500,
      perAccountDelayMaxMs: 1000,
      targetCooldownMs: 1500,
      recoveryHoldMs: 45000,
      sourceMaxPerWindow: 28,
      globalBlockDelayMs: 275,
      globalBlockDelayFloorMs: 240,
      globalDelayStableWindowMs: 120000,
      globalDelayHoldMs: 90000,
      speed429Threshold: 3,
    },
    recovery: {
      accountConcurrency: 4,
      perAccountDelayMinMs: 1200,
      perAccountDelayMaxMs: 2200,
      targetCooldownMs: 3000,
      recoveryHoldMs: 90000,
      sourceMaxPerWindow: 18,
      globalBlockDelayMs: 450,
      globalBlockDelayFloorMs: 450,
      globalDelayStableWindowMs: 180000,
      globalDelayHoldMs: 120000,
      speed429Threshold: 1,
    },
    drain: {
      accountConcurrency: 2,
      perAccountDelayMinMs: 1800,
      perAccountDelayMaxMs: 3200,
      targetCooldownMs: 4200,
      recoveryHoldMs: 120000,
      sourceMaxPerWindow: 12,
      globalBlockDelayMs: 600,
      globalBlockDelayFloorMs: 600,
      globalDelayStableWindowMs: 240000,
      globalDelayHoldMs: 180000,
      speed429Threshold: 1,
    },
    "fast-drain": {
      accountConcurrency: 3,
      perAccountDelayMinMs: 700,
      perAccountDelayMaxMs: 1200,
      targetCooldownMs: 2200,
      recoveryHoldMs: 90000,
      sourceMaxPerWindow: 18,
      globalBlockDelayMs: 325,
      globalBlockDelayFloorMs: 275,
      globalDelayStableWindowMs: 120000,
      globalDelayHoldMs: 90000,
      speed429Threshold: 2,
    },
  };

  const applyMode = ["safe", "balanced", "fast", "turbo", "aggressive", "recovery", "drain", "fast-drain"].includes(String(args.applyMode || CONFIG.applyMode))
    ? String(args.applyMode || CONFIG.applyMode)
    : "balanced";
  const preset = presets[applyMode];
  const accountConcurrency = clampNumber(args.accountConcurrency, 1, 20, preset.accountConcurrency);
  const accountLimit = clampNumber(args.accountLimit, 0, 10000, CONFIG.accountLimit);
  const validateConcurrency = clampNumber(args.validateConcurrency, 1, 50, CONFIG.validateConcurrency);
  const perAccountDelayMinMs = clampNumber(args.perAccountDelayMinMs, 0, 60000, preset.perAccountDelayMinMs);
  const perAccountDelayMaxMs = clampNumber(
    args.perAccountDelayMaxMs,
    perAccountDelayMinMs,
    120000,
    preset.perAccountDelayMaxMs,
  );
  const cooldownOn429Ms = clampNumber(args.cooldownOn429Ms, 0, 300000, CONFIG.cooldownOn429Ms);
  const targetCooldownMs = clampNumber(args.targetCooldownMs, 0, 120000, preset.targetCooldownMs || CONFIG.targetCooldownMs);
  const recoveryHoldMs = clampNumber(args.recoveryHoldMs, 0, 300000, preset.recoveryHoldMs || CONFIG.recoveryHoldMs);
  const sourceWindowMs = clampNumber(args.sourceWindowMs, 1000, 300000, CONFIG.sourceWindowMs);
  const sourceMaxPerWindow = clampNumber(args.sourceMaxPerWindow, 1, 120, preset.sourceMaxPerWindow || CONFIG.sourceMaxPerWindow);
  const source429PenaltyMs = clampNumber(args.source429PenaltyMs, 0, 300000, CONFIG.source429PenaltyMs);
  const globalBlockDelayMs = clampNumber(args.globalBlockDelayMs, 0, 60000, preset.globalBlockDelayMs || CONFIG.globalBlockDelayMs);
  const globalBlockDelayFloorMs = clampNumber(
    args.globalBlockDelayFloorMs,
    0,
    globalBlockDelayMs,
    Math.min(globalBlockDelayMs, preset.globalBlockDelayFloorMs || CONFIG.globalBlockDelayFloorMs),
  );
  const globalDelayStableWindowMs = clampNumber(
    args.globalDelayStableWindowMs,
    10000,
    600000,
    preset.globalDelayStableWindowMs || CONFIG.globalDelayStableWindowMs,
  );
  const globalDelayHoldMs = clampNumber(args.globalDelayHoldMs, 10000, 600000, preset.globalDelayHoldMs || CONFIG.globalDelayHoldMs);
  const speed429Threshold = clampNumber(args.speed429Threshold, 1, 100, preset.speed429Threshold || CONFIG.speed429Threshold);

  return {
    applyMode,
    accountConcurrency,
    accountLimit,
    validateConcurrency,
    perAccountDelayMinMs,
    perAccountDelayMaxMs,
    cooldownOn429Ms,
    targetCooldownMs,
    recoveryHoldMs,
    sourceWindowMs,
    sourceMaxPerWindow,
    source429PenaltyMs,
    globalBlockDelayMs,
    globalBlockDelayFloorMs,
    globalDelayStableWindowMs,
    globalDelayHoldMs,
    speed429Threshold,
  };
}

function normalizeSimulationProfile(profile) {
  const name = String(profile || "mixed").toLowerCase();
  const profiles = {
    clean: {
      alreadyBlockedRate: 0.05,
      rateLimitRate: 0.03,
      hardFailureRate: 0.005,
    },
    mixed: {
      alreadyBlockedRate: 0.35,
      rateLimitRate: 0.08,
      hardFailureRate: 0.01,
    },
    saturated: {
      alreadyBlockedRate: 0.75,
      rateLimitRate: 0.12,
      hardFailureRate: 0.015,
    },
  };
  return { name: profiles[name] ? name : "mixed", ...profiles[profiles[name] ? name : "mixed"] };
}

function simulatePairResult(pair, index, profile, applyOptions) {
  const seed = (Number(pair.source.auth.userId) * 31 + Number(pair.target.auth.userId) * 17 + index * 13) % 10000;
  const value = seed / 10000;
  const unverifiedBlockList = pair.status === "pending_unverified";

  if (value < profile.alreadyBlockedRate) {
    pair.status = "skipped_existing_api";
    return pairReport(pair, {
      endpoint: "simulated-user-blocking-api",
      httpStatus: 400,
      unverifiedBlockList,
      applyMode: applyOptions.applyMode,
      simulated: true,
    });
  }

  if (value < profile.alreadyBlockedRate + profile.rateLimitRate) {
    pair.status = "failed";
    return pairReport(pair, {
      endpoint: "simulated-user-blocking-api",
      httpStatus: 429,
      unverifiedBlockList,
      applyMode: applyOptions.applyMode,
      simulated: true,
      error: "simulated_rate_limit",
    });
  }

  if (value < profile.alreadyBlockedRate + profile.rateLimitRate + profile.hardFailureRate) {
    pair.status = "failed";
    return pairReport(pair, {
      endpoint: "simulated-user-blocking-api",
      httpStatus: 500,
      unverifiedBlockList,
      applyMode: applyOptions.applyMode,
      simulated: true,
      error: "simulated_endpoint_failure",
    });
  }

  pair.status = "blocked";
  return pairReport(pair, {
    endpoint: "simulated-user-blocking-api",
    httpStatus: 200,
    unverifiedBlockList,
    applyMode: applyOptions.applyMode,
    simulated: true,
  });
}

function estimateApplyMs(pairCount, applyOptions) {
  if (pairCount <= 0) return 0;
  const globalMs = pairCount * CONFIG.globalBlockDelayMs;
  const laneDelayAverage =
    (applyOptions.perAccountDelayMinMs + applyOptions.perAccountDelayMaxMs + applyOptions.targetCooldownMs) / 2;
  const laneMs = Math.ceil(pairCount / Math.max(1, applyOptions.accountConcurrency)) * laneDelayAverage;
  return Math.round(Math.max(globalMs, laneMs));
}

function makeFailureReasonKey(result) {
  if (!result) return "unknown";
  if (result.httpStatus === 429) return "429";
  if (result.limitReached) return "limit_reached";
  if (result.error) return String(result.error).slice(0, 80);
  return `status_${result.httpStatus || "unknown"}`;
}

function updateFailureMetrics(result) {
  if (!ACTIVE_METRICS || !result) return;
  const key = makeFailureReasonKey(result);
  ACTIVE_METRICS.topFailureReasons[key] = (ACTIVE_METRICS.topFailureReasons[key] || 0) + 1;
}

function limitAccounts(accounts, accountLimit) {
  const limit = clampNumber(accountLimit, 0, 10000, 0);
  if (!limit || accounts.length <= limit) return accounts;
  return accounts.slice(0, limit);
}

function makeBrowserTrackerId(lineNo) {
  const base = Date.now();
  const suffix = Math.floor(Math.random() * 1000);
  return Number(`${base}${lineNo}${suffix}`.slice(0, 16));
}

function sanitizeError(value) {
  return String(value || "")
    .replace(/_\|WARNING:[^\s"'<>]+/g, "[REDACTED_COOKIE]")
    .replace(/\.ROBLOSECURITY=([^;\s]+)/g, ".ROBLOSECURITY=[REDACTED_COOKIE]")
    .replace(/x-csrf-token[:=]\s*[a-zA-Z0-9+/_=-]+/gi, "x-csrf-token=[REDACTED_TOKEN]");
}

function parseCookiesFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing input file: ${filePath}`);
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const accounts = [];
  const invalid = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const raw = lines[index];
    const line = raw.trim();

    if (!line || line.startsWith("#")) continue;

    const firstColon = line.indexOf(":");
    const secondColon = firstColon >= 0 ? line.indexOf(":", firstColon + 1) : -1;

    if (firstColon < 1 || secondColon < firstColon + 2) {
      invalid.push({ lineNo, status: "invalid_format", reason: "Expected username:password:cookie" });
      continue;
    }

    const alias = line.slice(0, firstColon).trim();
    const password = line.slice(firstColon + 1, secondColon);
    const cookie = line.slice(secondColon + 1).trim();

    if (!alias) {
      invalid.push({ lineNo, status: "invalid_format", reason: "Missing username" });
      continue;
    }

    if (!password) {
      invalid.push({ lineNo, alias, status: "invalid_format", reason: "Missing password field" });
      continue;
    }

    if (!cookie.startsWith("_|WARNING")) {
      invalid.push({ lineNo, alias, status: "invalid_format", reason: "Cookie must start with _|WARNING" });
      continue;
    }

    accounts.push({
      lineNo,
      alias,
      cookie,
      browserTrackerId: makeBrowserTrackerId(lineNo),
      csrfToken: null,
      auth: null,
      valid: false,
      blockedUsers: null,
      blockListStatus: "not_loaded",
    });
  }

  return { accounts, invalid };
}

function makeCookieHeader(account) {
  const rbxid = account.auth && account.auth.userId ? account.auth.userId : "";
  return [
    `.ROBLOSECURITY=${account.cookie}`,
    `RBXEventTrackerV2=browserid=${account.browserTrackerId}&rbxid=${rbxid}`,
  ].join("; ");
}

async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!text) return null;

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function buildBody(bodyType, data) {
  if (bodyType === "none") {
    return undefined;
  }
  if (bodyType === "form") {
    return new URLSearchParams(data).toString();
  }
  return JSON.stringify(data);
}

function bodyHeaders(bodyType) {
  if (bodyType === "none") {
    return {};
  }
  if (bodyType === "form") {
    return { "content-type": "application/x-www-form-urlencoded" };
  }
  return { "content-type": "application/json" };
}

async function rawRequest(account, options) {
  if (ACTIVE_METRICS) ACTIVE_METRICS.requestsTotal += 1;
  const headers = {
    accept: "application/json, text/plain, */*",
    "user-agent": CONFIG.userAgent,
    cookie: makeCookieHeader(account),
    ...(options.headers || {}),
  };

  if (options.csrf) {
    if (!account.csrfToken) {
      account.csrfToken = await getCsrfToken(account);
    }
    headers["x-csrf-token"] = account.csrfToken;
  }

  let response;
  try {
    response = await fetchWithTimeout(options.url, {
      method: options.method || "GET",
      headers,
      body: options.body,
    }, CONFIG.requestTimeoutMs);
  } catch (error) {
    recordEndpointFailure(options.url, sanitizeError(error.message));
    throw error;
  }

  const body = await Promise.race([
    parseResponseBody(response),
    sleep(CONFIG.requestTimeoutMs).then(() => {
      throw new Error(`response_parse_timeout_${CONFIG.requestTimeoutMs}ms`);
    }),
  ]);
  if (!response.ok) recordEndpointFailure(options.url, response.status);
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body,
  };
}

async function robloxRequest(account, options) {
  let csrfRetryUsed = false;

  for (let attempt = 0; attempt <= CONFIG.max429Retries; attempt += 1) {
    await waitForGlobalRateLimit();
    const result = await rawRequest(account, options);

    const nextCsrf = result.headers.get("x-csrf-token");
    if (result.status === 403 && nextCsrf && options.csrf && !csrfRetryUsed) {
      account.csrfToken = nextCsrf;
      csrfRetryUsed = true;
      continue;
    }

    if (result.status === 429) {
      if (ACTIVE_METRICS) ACTIVE_METRICS.rateLimitCount += 1;
      if (CONFIG.globalCooldownOn429Ms > 0) {
        GLOBAL_RATE_LIMIT_UNTIL = Math.max(GLOBAL_RATE_LIMIT_UNTIL, Date.now() + CONFIG.globalCooldownOn429Ms);
      }
    }

    if (result.status === 429 && attempt < CONFIG.max429Retries) {
      const waitMs = CONFIG.backoff429Ms[Math.min(attempt, CONFIG.backoff429Ms.length - 1)];
      console.log(`Rate limited. Waiting ${Math.round(waitMs / 1000)}s before retry...`);
      await sleep(waitMs);
      continue;
    }

    return result;
  }

  throw new Error("Request retry limit reached");
}

async function getCsrfToken(account) {
  const result = await rawRequest(account, {
    method: "POST",
    url: ENDPOINTS.csrf,
  });

  const token = result.headers.get("x-csrf-token");
  if (!token) {
    throw new Error(`Could not obtain CSRF token, status=${result.status}`);
  }

  return token;
}

async function getAuthenticatedUser(account) {
  const result = await robloxRequest(account, {
    method: "GET",
    url: ENDPOINTS.authenticatedUser,
  });

  if (result.status === 401) {
    return { ok: false, status: "invalid_cookie", httpStatus: result.status };
  }

  if (result.status === 403) {
    return { ok: false, status: "challenge_or_forbidden", httpStatus: result.status };
  }

  if (!result.ok || !result.body || typeof result.body.id !== "number") {
    return {
      ok: false,
      status: "auth_failed",
      httpStatus: result.status,
      reason: sanitizeError(JSON.stringify(result.body || {})),
    };
  }

  return {
    ok: true,
    userId: result.body.id,
    username: result.body.name || null,
    displayName: result.body.displayName || null,
  };
}

async function validateAccounts(accounts, logger, options = {}) {
  const output = createLogger(logger);
  const requestedConcurrency = clampNumber(options.validateConcurrency, 1, 50, CONFIG.validateConcurrency);
  const largeJobCap =
    accounts.length >= 400
      ? 2
      : accounts.length >= 250
        ? 3
        : accounts.length >= 100
          ? 4
          : accounts.length >= 60
            ? 6
            : requestedConcurrency;
  const concurrency = Math.min(requestedConcurrency, largeJobCap);
  if (accounts.length >= 100) {
    output.log(`Validate throttle: accounts=${accounts.length}, concurrency=${concurrency}`);
  }

  function isTransientValidateFailure(auth) {
    if (!auth || auth.ok) return false;
    if (auth.httpStatus === 429 || auth.status === "exception") return true;
    const reason = String(auth.reason || "");
    return auth.status === "auth_failed" && reason.includes('"code":0');
  }

  await mapConcurrent(accounts, concurrency, async (account) => {
    const maxAttempts = accounts.length >= 100 ? 5 : 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      output.write(`Validating ${account.alias}${attempt > 1 ? ` retry${attempt}` : ""}... `);
      try {
        const auth = await getAuthenticatedUser(account);
        account.auth = auth;
        account.valid = Boolean(auth.ok);

        if (auth.ok) {
          output.log(`OK userId=${auth.userId} username=${auth.username || "unknown"}`);
          return;
        }

        output.log(`FAILED ${auth.status}`);
        if (!isTransientValidateFailure(auth) || attempt >= maxAttempts) {
          return;
        }
      } catch (error) {
        account.auth = {
          ok: false,
          status: "exception",
          reason: sanitizeError(error.message),
        };
        account.valid = false;
        output.log(`FAILED exception`);
        if (attempt >= maxAttempts) {
          return;
        }
      }

      const auth = account.auth || {};
      const waitMs = auth.httpStatus === 429 ? 15000 * attempt : 2500 * attempt;
      await sleep(waitMs);
    }
  });
}

function readStateAuthMap() {
  if (!fs.existsSync(STATE_FILE)) return new Map();
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const map = new Map();
    for (const item of Array.isArray(state.accounts) ? state.accounts : []) {
      if (!item || !item.valid || !item.userId) continue;
      if (item.lineNo) map.set(`line:${item.lineNo}`, item);
      if (item.alias) map.set(`alias:${String(item.alias).toLowerCase()}`, item);
      if (item.username) map.set(`username:${String(item.username).toLowerCase()}`, item);
    }
    return map;
  } catch {
    return new Map();
  }
}

function hydrateAccountsFromState(accounts) {
  const map = readStateAuthMap();
  let hydrated = 0;
  for (const account of accounts) {
    const snapshot =
      map.get(`line:${account.lineNo}`) ||
      map.get(`alias:${String(account.alias || "").toLowerCase()}`) ||
      map.get(`username:${String(account.username || "").toLowerCase()}`);
    if (!snapshot || !snapshot.userId) continue;
    account.auth = {
      ok: true,
      userId: Number(snapshot.userId),
      username: snapshot.username || account.username || account.alias || null,
      displayName: snapshot.displayName || null,
      status: "ok",
    };
    account.valid = true;
    hydrated += 1;
  }
  return hydrated;
}

async function prepareAccountsAuth(accounts, logger, options = {}, args = {}) {
  const output = createLogger(logger);
  let hydrated = 0;
  if (args.useStateAuth) {
    hydrated = hydrateAccountsFromState(accounts);
    output.log(`Using auth snapshot from state: ${hydrated}/${accounts.length} accounts hydrated.`);
  }
  const missing = accounts.filter((account) => !account.valid || !account.auth || !account.auth.userId);
  if (missing.length > 0) {
    if (args.useStateAuth && hydrated > 0) {
      output.log(`Validating ${missing.length} accounts missing from snapshot.`);
    }
    await validateAccounts(missing, logger, options);
  }
  return { hydrated, validated: missing.length };
}

function findDuplicateValidAccounts(accounts) {
  const byUserId = new Map();
  const duplicates = [];

  for (const account of accounts.filter((item) => item.valid && item.auth && item.auth.userId)) {
    const existing = byUserId.get(account.auth.userId);
    if (existing) {
      duplicates.push({
        userId: account.auth.userId,
        aliases: [existing.alias, account.alias],
      });
    } else {
      byUserId.set(account.auth.userId, account);
    }
  }

  return duplicates;
}

function validUniqueAccounts(accounts) {
  const seen = new Set();
  const unique = [];

  for (const account of accounts) {
    if (!account.valid || !account.auth || !account.auth.userId) continue;
    if (seen.has(account.auth.userId)) continue;
    seen.add(account.auth.userId);
    unique.push(account);
  }

  return unique;
}

async function loadBlockedUsers(account) {
  const errors = [];

  for (const candidate of ENDPOINTS.blockedUsersCandidates) {
    const blocked = new Set();
    let cursor = null;
    let pages = 0;
    let failed = false;

    while (true) {
      const url = candidate.url(account, cursor);
      let result;

      try {
        result = await robloxRequest(account, { method: "GET", url, csrf: Boolean(candidate.csrf) });
      } catch (error) {
        errors.push(`${candidate.name}=${sanitizeError(error.message)}`);
        failed = true;
        break;
      }

      if (!result.ok) {
        errors.push(`${candidate.name}=status${result.status}`);
        failed = true;
        break;
      }

      const body = result.body || {};
      const data = Array.isArray(body)
        ? body
        : Array.isArray(body.data)
          ? body.data
          : Array.isArray(body.blockedUsers)
            ? body.blockedUsers
            : Array.isArray(body.userIds)
              ? body.userIds
              : [];

      for (const item of data) {
        const id = Number(
          typeof item === "number" || typeof item === "string"
            ? item
            : item.id || item.userId || item.blockedUserId || item.targetUserId,
        );
        if (Number.isFinite(id)) blocked.add(id);
      }

      pages += 1;
      cursor = body.nextPageCursor || body.nextCursor || null;
      if (!cursor || pages >= 20) break;

      await sleep(randomDelay());
    }

    if (!failed) {
      account.blockedUsers = blocked;
      account.blockListStatus = "loaded";
      account.blockListEndpoint = candidate.name;
      return true;
    }
  }

  account.blockedUsers = new Set();
  account.blockListStatus = "unavailable";
  account.blockListError = errors.join(", ") || "no_endpoint_succeeded";
  return false;
}

async function loadAllBlockedUsers(accounts, logger, options = {}) {
  const output = createLogger(logger);
  if (options.skipBlockListCheck) {
    for (const account of accounts) {
      account.blockedUsers = new Set();
      account.blockListStatus = "unavailable";
      account.blockListError = "skipped_by_config";
    }
    output.log(`Skipped block-list check for ${accounts.length} accounts.`);
    return;
  }

  for (const account of accounts) {
    output.write(`Loading blocked list for ${account.alias}... `);
    try {
      const ok = await loadBlockedUsers(account);
      if (ok) {
        output.log(`${account.blockedUsers.size} blocked users`);
      } else {
        output.log(`unavailable (${account.blockListError || "unknown"})`);
      }
    } catch (error) {
      account.blockedUsers = new Set();
      account.blockListStatus = "exception";
      account.blockListError = sanitizeError(error.message);
      output.log("failed");
    }

    await sleep(randomDelay());
  }
}

function buildPairs(accounts, options = {}) {
  const pairs = [];

  for (const source of accounts) {
    for (const target of accounts) {
      if (source.auth.userId === target.auth.userId) continue;

      const alreadyBlocked =
        source.blockedUsers instanceof Set && source.blockedUsers.has(target.auth.userId);

      const sourceBlockedCount = source.blockedUsers instanceof Set ? source.blockedUsers.size : null;
      const blockListUnavailable = source.blockListStatus !== "loaded";
      const limitRisk =
        typeof sourceBlockedCount === "number" && sourceBlockedCount >= CONFIG.blockLimitWarningAt;

      pairs.push({
        source,
        target,
        status: blockListUnavailable
          ? options.allowUnverifiedBlockList
            ? "pending_unverified"
            : "blocked_list_unavailable"
          : alreadyBlocked
          ? "skipped_existing"
          : limitRisk
            ? "blocked_limit_risk"
            : "pending",
      });
    }
  }

  return pairs;
}

async function blockUser(source, target) {
  let lastError = null;

  for (const candidate of ENDPOINTS.blockCandidates) {
    const bodyData = candidate.body(target.auth.userId);
    const result = await robloxRequest(source, {
      method: candidate.method,
      url: candidate.url(target.auth.userId),
      csrf: true,
      headers: bodyHeaders(candidate.bodyType),
      body: buildBody(candidate.bodyType, bodyData),
    });

    if (result.ok || result.status === 200 || result.status === 204) {
      return { ok: true, endpoint: candidate.name, httpStatus: result.status };
    }

    const bodyText = sanitizeError(JSON.stringify(result.body || {}));
    const errorCode = extractRobloxErrorCode(result.body);
    const errorText = bodyText.toLowerCase();

    if (
      result.status === 400 &&
      (errorCode === 1 || errorCode === 3 || errorText.includes("already blocked") || errorText.includes("already_blocked"))
    ) {
      return {
        ok: true,
        alreadyBlocked: true,
        endpoint: candidate.name,
        httpStatus: result.status,
      };
    }

    if (
      result.status === 400 &&
      (errorCode === 4 || errorText.includes("block limit") || errorText.includes("limit"))
    ) {
      return {
        ok: false,
        limitReached: true,
        endpoint: candidate.name,
        httpStatus: result.status,
        error: bodyText,
      };
    }

    lastError = {
      endpoint: candidate.name,
      httpStatus: result.status,
      error: bodyText,
      retryable: result.status === 429 || result.status >= 500,
    };

    if (![400, 404, 405].includes(result.status)) {
      break;
    }
  }

  return { ok: false, ...(lastError || { error: "unknown_error" }) };
}

function extractRobloxErrorCode(body) {
  if (!body) return null;
  if (typeof body === "number" || typeof body === "string") {
    const direct = Number(body);
    return Number.isFinite(direct) ? direct : null;
  }
  if (typeof body.code === "number" || typeof body.code === "string") return Number(body.code);
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    if (typeof first.code === "number" || typeof first.code === "string") return Number(first.code);
  }
  return null;
}

function accountReport(account) {
  return {
    alias: account.alias,
    lineNo: account.lineNo,
    valid: account.valid,
    userId: account.auth && account.auth.userId ? account.auth.userId : null,
    username: account.auth && account.auth.username ? account.auth.username : null,
    displayName: account.auth && account.auth.displayName ? account.auth.displayName : null,
    status: account.auth ? account.auth.status || "ok" : "not_checked",
    blockedCount:
      account.blockedUsers instanceof Set ? account.blockedUsers.size : null,
    blockListStatus: account.blockListStatus,
    blockListEndpoint: account.blockListEndpoint || null,
    error:
      account.auth && account.auth.reason
        ? sanitizeError(account.auth.reason)
        : account.blockListError
          ? sanitizeError(account.blockListError)
          : null,
  };
}

function pairReport(pair, extra = {}) {
  return {
    sourceAlias: pair.source.alias,
    sourceUserId: pair.source.auth.userId,
    sourceUsername: pair.source.auth.username || null,
    targetAlias: pair.target.alias,
    targetUserId: pair.target.auth.userId,
    targetUsername: pair.target.auth.username || null,
    status: pair.status,
    ...extra,
  };
}

function makeSyntheticTarget(pair) {
  return {
    alias: pair.targetAlias || String(pair.targetUserId),
    auth: {
      userId: Number(pair.targetUserId),
      username: pair.targetUsername || pair.targetAlias || null,
    },
  };
}

function groupPendingPairsBySource(pairs) {
  const groups = [];
  const bySource = new Map();

  for (const pair of pairs) {
    if (pair.status !== "pending" && pair.status !== "pending_unverified") continue;

    const sourceUserId = pair.source.auth.userId;
    if (!bySource.has(sourceUserId)) {
      const group = {
        source: pair.source,
        pairs: [],
      };
      bySource.set(sourceUserId, group);
      groups.push(group);
    }
    bySource.get(sourceUserId).pairs.push(pair);
  }

  return groups;
}

function makeLaneState(group) {
  return {
    source: group.source,
    queue: [...group.pairs],
    cooldownUntil: 0,
    blocked: false,
    recent429: 0,
    completed: 0,
    requestTimes: [],
  };
}

function createAdaptiveController(applyOptions, totalPairs) {
  const now = Date.now();
  return {
    maxConcurrency: applyOptions.accountConcurrency,
    activeConcurrency: applyOptions.accountConcurrency,
    targetCooldownMs: applyOptions.targetCooldownMs,
    totalPairs,
    recentResults: [],
    lastAdjustmentAt: 0,
    recoveryHoldUntil: 0,
    successWindows: 0,
    sawRateLimit: false,
    recoveryMaxConcurrency: applyOptions.applyMode === "balanced" ? Math.min(applyOptions.accountConcurrency, 6) : applyOptions.accountConcurrency,
    windowSize: 24,
    currentGlobalDelayMs: applyOptions.globalBlockDelayMs,
    globalDelayFloorMs: applyOptions.globalBlockDelayFloorMs,
    globalDelayCeilingMs: Math.max(applyOptions.globalBlockDelayMs + 300, 650),
    lastGlobalSpeedChangeAt: now,
    globalDelayHoldUntil: 0,
    no429Since: now,
  };
}

function recordAdaptiveResult(controller, result) {
  controller.recentResults.push({
    at: Date.now(),
    status: result.status,
    httpStatus: result.httpStatus || null,
  });
  if (controller.recentResults.length > controller.windowSize) {
    controller.recentResults.shift();
  }
}

function maybeAdjustAdaptiveController(controller, applyOptions, output) {
  if (controller.recentResults.length < Math.min(8, controller.windowSize)) return;
  const now = Date.now();
  if (now - controller.lastAdjustmentAt < 5000) return;

  const recent429 = controller.recentResults.filter((item) => item.httpStatus === 429).length;
  const recentOk = controller.recentResults.filter(
    (item) => item.status === "blocked" || item.status === "skipped_existing_api",
  ).length;
  if (ACTIVE_METRICS) {
    ACTIVE_METRICS.recent429Count = recent429;
    ACTIVE_METRICS.recentSuccessCount = recentOk;
  }

  if (recent429 > 0) {
    controller.no429Since = now;
  }

  let changed = false;
  if (recent429 >= 3 && controller.activeConcurrency > 1) {
    controller.sawRateLimit = true;
    controller.successWindows = 0;
    controller.recoveryHoldUntil = now + applyOptions.recoveryHoldMs;
    controller.activeConcurrency = Math.max(1, controller.activeConcurrency - (recent429 >= 8 ? 2 : 1));
    if (controller.sawRateLimit) {
      controller.activeConcurrency = Math.min(controller.activeConcurrency, controller.recoveryMaxConcurrency);
    }
    applyOptions.perAccountDelayMinMs = Math.min(applyOptions.perAccountDelayMinMs + 250, 8000);
    applyOptions.perAccountDelayMaxMs = Math.min(applyOptions.perAccountDelayMaxMs + 350, 10000);
    controller.targetCooldownMs = Math.min(controller.targetCooldownMs + 500, 12000);
    changed = true;
    output.log(
      `[adaptive] downshift concurrency=${controller.activeConcurrency} delay=${applyOptions.perAccountDelayMinMs}-${applyOptions.perAccountDelayMaxMs} targetCooldown=${controller.targetCooldownMs}`,
    );
  } else if (recent429 === 0 && recentOk >= Math.floor(controller.windowSize * 0.8)) {
    controller.successWindows += 1;
    const maxAllowed = controller.sawRateLimit ? controller.recoveryMaxConcurrency : controller.maxConcurrency;
    if (now >= controller.recoveryHoldUntil && controller.successWindows >= 3 && controller.activeConcurrency < maxAllowed) {
      controller.activeConcurrency += 1;
      controller.successWindows = 0;
      applyOptions.perAccountDelayMinMs = Math.max(500, applyOptions.perAccountDelayMinMs - 75);
      applyOptions.perAccountDelayMaxMs = Math.max(applyOptions.perAccountDelayMinMs, applyOptions.perAccountDelayMaxMs - 100);
      controller.targetCooldownMs = Math.max(1500, controller.targetCooldownMs - 100);
      changed = true;
      output.log(
        `[adaptive] upshift concurrency=${controller.activeConcurrency} delay=${applyOptions.perAccountDelayMinMs}-${applyOptions.perAccountDelayMaxMs} targetCooldown=${controller.targetCooldownMs}`,
      );
    }
  } else {
    controller.successWindows = 0;
  }

  if (changed && ACTIVE_METRICS) {
    const adjustment = {
      at: new Date().toISOString(),
      activeConcurrency: controller.activeConcurrency,
      perAccountDelayMinMs: applyOptions.perAccountDelayMinMs,
      perAccountDelayMaxMs: applyOptions.perAccountDelayMaxMs,
      targetCooldownMs: controller.targetCooldownMs,
      recoveryHoldUntil: controller.recoveryHoldUntil ? new Date(controller.recoveryHoldUntil).toISOString() : null,
      successWindows: controller.successWindows,
      recent429,
      recentOk,
    };
    ACTIVE_METRICS.adaptiveAdjustments.push(adjustment);
    if (controller.eventLogger) {
      controller.eventLogger.write({
        type: "adaptive",
        activeConcurrency: adjustment.activeConcurrency,
        perAccountDelayMinMs: adjustment.perAccountDelayMinMs,
        perAccountDelayMaxMs: adjustment.perAccountDelayMaxMs,
        targetCooldownMs: adjustment.targetCooldownMs,
        recoveryHoldUntil: adjustment.recoveryHoldUntil,
        successWindows: adjustment.successWindows,
        recent429: adjustment.recent429,
        recentOk: adjustment.recentOk,
      });
    }
  }
  if (changed) controller.lastAdjustmentAt = now;

  let speedChanged = false;
  if (recent429 >= applyOptions.speed429Threshold) {
    const oldDelay = CONFIG.globalBlockDelayMs;
    const nextDelay = Math.min(
      controller.globalDelayCeilingMs,
      Math.max(oldDelay + CONFIG.globalDelayRecoveryStepMs, applyOptions.globalBlockDelayMs),
    );
    controller.globalDelayHoldUntil = now + applyOptions.globalDelayHoldMs;
    controller.no429Since = now;
    if (nextDelay !== oldDelay) {
      recordGlobalDelayChange(
        "rate_limit_rollback",
        oldDelay,
        nextDelay,
        {
          recent429,
          recentOk,
          holdUntil: new Date(controller.globalDelayHoldUntil).toISOString(),
        },
        controller.eventLogger,
      );
      output.log(`[speed] rollback globalDelay=${nextDelay}ms recent429=${recent429}`);
      speedChanged = true;
    }
  } else if (
    recent429 === 0 &&
    recentOk >= Math.floor(controller.windowSize * 0.8) &&
    CONFIG.globalBlockDelayMs > controller.globalDelayFloorMs &&
    now >= controller.globalDelayHoldUntil &&
    now - controller.no429Since >= applyOptions.globalDelayStableWindowMs &&
    now - controller.lastGlobalSpeedChangeAt >= 30000
  ) {
    const oldDelay = CONFIG.globalBlockDelayMs;
    const nextDelay = Math.max(controller.globalDelayFloorMs, oldDelay - CONFIG.globalDelayStepMs);
    recordGlobalDelayChange(
      "stable_speedup",
      oldDelay,
      nextDelay,
      {
        recent429,
        recentOk,
        stableForMs: now - controller.no429Since,
      },
      controller.eventLogger,
    );
    output.log(`[speed] speedup globalDelay=${nextDelay}ms stableFor=${Math.round((now - controller.no429Since) / 1000)}s`);
    speedChanged = true;
  }
  if (speedChanged) controller.lastGlobalSpeedChangeAt = now;
}

function pruneSourceWindow(lane, now, applyOptions) {
  const cutoff = now - applyOptions.sourceWindowMs;
  while (lane.requestTimes.length && lane.requestTimes[0] < cutoff) {
    lane.requestTimes.shift();
  }
}

function sourceReadyAt(lane, now, applyOptions) {
  pruneSourceWindow(lane, now, applyOptions);
  if (lane.requestTimes.length < applyOptions.sourceMaxPerWindow) return now;
  return lane.requestTimes[0] + applyOptions.sourceWindowMs;
}

function nextSchedulablePair(lanes, targetCooldowns, applyOptions, reservedSources = new Set(), reservedTargets = new Set()) {
  const now = Date.now();
  const ready = [];
  let bestDelayedAt = Number.POSITIVE_INFINITY;

  for (const lane of lanes) {
    if (lane.blocked || lane.queue.length === 0) continue;
    if (reservedSources.has(lane.source.auth.userId)) continue;
    const sourceReady = sourceReadyAt(lane, now, applyOptions);
    if (sourceReady > now) {
      bestDelayedAt = Math.min(bestDelayedAt, sourceReady);
      continue;
    }
    if (lane.cooldownUntil > now) {
      bestDelayedAt = Math.min(bestDelayedAt, lane.cooldownUntil);
      continue;
    }

    let chosenIndex = -1;
    let chosenAt = Number.POSITIVE_INFINITY;
    for (let index = 0; index < lane.queue.length; index += 1) {
      const pair = lane.queue[index];
      if (reservedTargets.has(pair.target.auth.userId)) continue;
      const targetReadyAt = targetCooldowns.get(pair.target.auth.userId) || 0;
      if (targetReadyAt <= now) {
        chosenIndex = index;
        chosenAt = now;
        break;
      }
      if (targetReadyAt < chosenAt) {
        chosenAt = targetReadyAt;
        chosenIndex = index;
      }
    }

    if (chosenIndex >= 0 && chosenAt <= now) {
      ready.push({ lane, chosenIndex });
    } else if (chosenAt < bestDelayedAt) {
      bestDelayedAt = chosenAt;
    }
  }

  if (ready.length > 0) {
    ready.sort((a, b) => a.lane.completed - b.lane.completed);
    return { type: "ready", item: ready[0] };
  }
  if (Number.isFinite(bestDelayedAt)) {
    return { type: "wait", waitUntil: bestDelayedAt };
  }
  return { type: "done" };
}

function isCancelRequested(cancelToken) {
  return Boolean(cancelToken && typeof cancelToken.isCancelled === "function" && cancelToken.isCancelled());
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m${String(seconds).padStart(2, "0")}s`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function makeTimeoutPairResult(pair, applyOptions, reason) {
  const unverifiedBlockList = pair.status === "pending_unverified";
  pair.status = "failed";
  return pairReport(pair, {
    unverifiedBlockList,
    applyMode: applyOptions.applyMode,
    retryable: true,
    error: reason,
  });
}

async function applyOnePair(pair, output, applyOptions, eventLogger, context = {}) {
  const unverifiedBlockList = pair.status === "pending_unverified";
  const startedAt = Date.now();

  if (!applyOptions.progressOnly) {
    output.write(
      `[${pair.source.alias}] Blocking -> ${pair.target.alias} (${pair.target.auth.userId})... `,
    );
  }
  if (eventLogger) {
    eventLogger.write({
      type: "pair_start",
      sourceAlias: pair.source.alias,
      sourceUserId: pair.source.auth.userId,
      targetAlias: pair.target.alias,
      targetUserId: pair.target.auth.userId,
      activeConcurrency: context.activeConcurrency,
      activeLanes: context.activeLanes,
      batchSize: context.batchSize,
    });
  }

  function finishPair(report) {
    const durationMs = Date.now() - startedAt;
    if (eventLogger) {
      eventLogger.write({
        type: "pair_finish",
        sourceAlias: report.sourceAlias,
        sourceUserId: report.sourceUserId,
        targetAlias: report.targetAlias,
        targetUserId: report.targetUserId,
        status: report.status,
        httpStatus: report.httpStatus || null,
        retryable: Boolean(report.retryable),
        durationMs,
        activeConcurrency: context.activeConcurrency,
        activeLanes: context.activeLanes,
      });
    }
    return { ...report, durationMs };
  }

  try {
    await waitForGlobalBlockSlot();
    const result = await blockUser(pair.source, pair.target);
    if (result.ok && result.alreadyBlocked) {
      pair.status = "skipped_existing_api";
      pair.source.blockedUsers.add(pair.target.auth.userId);
      if (!applyOptions.progressOnly) output.log(`ALREADY BLOCKED via ${result.endpoint}`);
      return finishPair(pairReport(pair, {
        endpoint: result.endpoint,
        httpStatus: result.httpStatus,
        unverifiedBlockList,
        applyMode: applyOptions.applyMode,
      }));
    }

    if (result.ok) {
      pair.status = "blocked";
      pair.source.blockedUsers.add(pair.target.auth.userId);
      if (!applyOptions.progressOnly) output.log(`OK via ${result.endpoint}`);
      return finishPair(pairReport(pair, {
        endpoint: result.endpoint,
        httpStatus: result.httpStatus,
        unverifiedBlockList,
        applyMode: applyOptions.applyMode,
      }));
    }

    pair.status = "failed";
    if (!applyOptions.progressOnly) output.log(`FAILED status=${result.httpStatus || "unknown"}`);
    updateFailureMetrics(result);
    return finishPair(pairReport(pair, {
      endpoint: result.endpoint || null,
      httpStatus: result.httpStatus || null,
      limitReached: Boolean(result.limitReached),
      retryable: Boolean(result.retryable || result.httpStatus === 429 || (result.httpStatus || 0) >= 500),
      unverifiedBlockList,
      applyMode: applyOptions.applyMode,
      error: sanitizeError(result.error || "unknown_error"),
    }));
  } catch (error) {
    pair.status = "failed";
    if (!applyOptions.progressOnly) output.log("FAILED exception");
    updateFailureMetrics({ error: error.message });
    return finishPair(pairReport(pair, {
      unverifiedBlockList,
      applyMode: applyOptions.applyMode,
      retryable: true,
      error: sanitizeError(error.message),
    }));
  }
}

async function runApplyLanes(pairs, output, applyOptions, cancelToken, eventLogger) {
  const results = [];

  for (const pair of pairs) {
    if (pair.status !== "pending" && pair.status !== "pending_unverified") {
      results.push(pairReport(pair, { applyMode: applyOptions.applyMode }));
    }
  }

  const groups = groupPendingPairsBySource(pairs);
  const totalPendingPairs = groups.reduce((sum, group) => sum + group.pairs.length, 0);
  const startedAt = Date.now();
  let lastProgressAt = 0;
  const lanes = groups.map(makeLaneState);
  const targetCooldowns = new Map();
  const controller = createAdaptiveController(applyOptions, pairs.length);
  controller.eventLogger = eventLogger || null;
  if (ACTIVE_METRICS) ACTIVE_METRICS.schedulerMode = "target-aware";
  if (ACTIVE_METRICS) {
    ACTIVE_METRICS.speedProfile = applyOptions.applyMode;
    ACTIVE_METRICS.globalDelayStartMs = applyOptions.globalBlockDelayMs;
    ACTIVE_METRICS.globalDelayEndMs = CONFIG.globalBlockDelayMs;
    ACTIVE_METRICS.globalDelayMinMs = applyOptions.globalBlockDelayFloorMs;
    if (eventLogger) ACTIVE_METRICS.eventLogPath = eventLogger.filePath;
  }

  if (eventLogger) {
    eventLogger.write({
      type: "apply_start",
      totalPairs: pairs.length,
      pendingPairs: totalPendingPairs,
      lanes: groups.length,
      maxConcurrency: controller.maxConcurrency,
      targetCooldownMs: controller.targetCooldownMs,
      recoveryHoldMs: applyOptions.recoveryHoldMs,
      sourceWindowMs: applyOptions.sourceWindowMs,
      sourceMaxPerWindow: applyOptions.sourceMaxPerWindow,
      source429PenaltyMs: applyOptions.source429PenaltyMs,
      globalBlockDelayMs: applyOptions.globalBlockDelayMs,
      globalBlockDelayFloorMs: applyOptions.globalBlockDelayFloorMs,
      speed429Threshold: applyOptions.speed429Threshold,
      perAccountDelayMinMs: applyOptions.perAccountDelayMinMs,
      perAccountDelayMaxMs: applyOptions.perAccountDelayMaxMs,
    });
  }

  if (applyOptions.progressOnly) {
    output.log(`[lanes] ${lanes.length} source lanes ready. Pair logs hidden; progress updates every 5 seconds.`);
  } else {
    for (const lane of lanes) {
      output.log(`[lane] source=${lane.source.alias} targets=${lane.queue.length}`);
    }
  }

  function printProgress(force = false) {
    const now = Date.now();
    if (!force && now - lastProgressAt < 5000) return;
    lastProgressAt = now;
    const done = results.length;
    const elapsedMs = Math.max(1, now - startedAt);
    const ratePerMin = done > 0 ? (done / (elapsedMs / 60000)) : 0;
    const remaining = Math.max(0, totalPendingPairs - done);
    const etaMs = ratePerMin > 0 ? (remaining / ratePerMin) * 60000 : 0;
    const blocked = results.filter((item) => item.status === "blocked").length;
    const already = results.filter((item) => item.status === "skipped_existing_api" || item.status === "skipped_known_success").length;
    const failed = results.filter((item) => item.status === "failed").length;
    const rate429 = results.filter((item) => item.httpStatus === 429).length;
    const pct = totalPendingPairs > 0 ? ((done / totalPendingPairs) * 100).toFixed(1) : "100.0";
    const line = `[progress] ${done}/${totalPendingPairs} (${pct}%) ok=${blocked} already=${already} failed=${failed} 429=${rate429} speed=${ratePerMin.toFixed(1)}/min eta=${formatDuration(etaMs)} active=${controller.activeConcurrency} lanes=${lanes.filter((lane) => !lane.blocked && lane.queue.length > 0).length} globalDelay=${CONFIG.globalBlockDelayMs}ms`;
    if (applyOptions.progressOnly) {
      process.stderr.write(`${line}\n`);
    } else {
      output.log(line);
    }
  }

  printProgress(true);

  while (!isCancelRequested(cancelToken)) {
    const activeLanes = lanes.filter((lane) => !lane.blocked && lane.queue.length > 0);
    if (!activeLanes.length) break;
    if (ACTIVE_METRICS) ACTIVE_METRICS.laneActiveCount = activeLanes.length;

    const batch = [];
    const reservedSources = new Set();
    const reservedTargets = new Set();
    for (let slot = 0; slot < controller.activeConcurrency; slot += 1) {
      const pick = nextSchedulablePair(activeLanes, targetCooldowns, applyOptions, reservedSources, reservedTargets);
      if (pick.type === "done") break;
      if (pick.type === "wait") {
        const delay = Math.max(25, pick.waitUntil - Date.now());
        await sleep(Math.min(delay, 250));
        break;
      }

      const { lane, chosenIndex } = pick.item;
      const pair = lane.queue[chosenIndex];
      lane.queue.splice(chosenIndex, 1);
      reservedSources.add(lane.source.auth.userId);
      reservedTargets.add(pair.target.auth.userId);
      batch.push({ lane, pair });
    }

    if (!batch.length) continue;
    if (eventLogger) {
      eventLogger.write({
        type: "batch_start",
        batchSize: batch.length,
        activeLanes: activeLanes.length,
        activeConcurrency: controller.activeConcurrency,
        remainingPairs: activeLanes.reduce((sum, lane) => sum + lane.queue.length, 0),
      });
    }

    const batchTimeoutMs = Math.max(CONFIG.requestTimeoutMs * 2, CONFIG.requestTimeoutMs + batch.length * 1000);
    const batchResults = await Promise.race([
      Promise.all(batch.map(async ({ lane, pair }) => {
        const result = await applyOnePair(pair, output, applyOptions, eventLogger, {
          activeConcurrency: controller.activeConcurrency,
          activeLanes: activeLanes.length,
          batchSize: batch.length,
        });
        lane.completed += 1;
        lane.requestTimes.push(Date.now());
        lane.cooldownUntil = Date.now() + randomBetween(applyOptions.perAccountDelayMinMs, applyOptions.perAccountDelayMaxMs);
        targetCooldowns.set(pair.target.auth.userId, Date.now() + controller.targetCooldownMs);
        if (result.httpStatus === 429) {
          lane.recent429 += 1;
          const penaltyMs = Math.max(applyOptions.cooldownOn429Ms, applyOptions.source429PenaltyMs);
          lane.cooldownUntil = Math.max(lane.cooldownUntil, Date.now() + penaltyMs);
          if (eventLogger) {
            eventLogger.write({
              type: "source_cooldown",
              sourceAlias: lane.source.alias,
              sourceUserId: lane.source.auth.userId,
              cooldownMs: penaltyMs,
              reason: "429",
            });
          }
        }
        if (
          result.error === "invalid_cookie" ||
          result.error === "challenge_or_forbidden" ||
          result.httpStatus === 401 ||
          result.httpStatus === 403
        ) {
          lane.blocked = true;
        }
        return result;
      })),
      sleep(batchTimeoutMs).then(() => {
        if (eventLogger) {
          eventLogger.write({
            type: "batch_timeout",
            batchSize: batch.length,
            timeoutMs: batchTimeoutMs,
          });
        }
        return batch.map(({ pair }) => makeTimeoutPairResult(pair, applyOptions, `batch_timeout_${batchTimeoutMs}ms`));
      }),
    ]);

    for (const result of batchResults) {
      results.push(result);
      recordAdaptiveResult(controller, result);
    }
    printProgress(false);
    maybeAdjustAdaptiveController(controller, applyOptions, output);
  }

  printProgress(true);

  if (eventLogger) {
    eventLogger.write({
      type: "apply_finish",
      results: results.length,
      cancelled: isCancelRequested(cancelToken),
      pendingAfterCancel: pairs.length - results.length,
    });
  }

  return {
    results,
    cancelled: isCancelRequested(cancelToken),
    pendingAfterCancel: pairs.length - results.length,
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function writeReport(command, report) {
  ensureDirs();
  let filePath = path.join(REPORTS_DIR, `block-report-${timestamp()}.json`);
  let suffix = 1;
  while (fs.existsSync(filePath)) {
    filePath = path.join(REPORTS_DIR, `block-report-${timestamp()}-${suffix}.json`);
    suffix += 1;
  }
  writeJson(filePath, {
    generatedAt: new Date().toISOString(),
    command,
    ...report,
  });
  console.log(`Report written: ${filePath}`);
  return filePath;
}

function writeState(state) {
  ensureDirs();
  writeJson(STATE_FILE, {
    generatedAt: new Date().toISOString(),
    ...state,
  });
}

function pairCacheKey(sourceUserId, targetUserId) {
  return `${Number(sourceUserId)}->${Number(targetUserId)}`;
}

function readPairCache() {
  if (!fs.existsSync(PAIR_CACHE_FILE)) {
    return { generatedAt: null, successes: {} };
  }
  try {
    const cache = JSON.parse(fs.readFileSync(PAIR_CACHE_FILE, "utf8"));
    if (!cache || typeof cache !== "object" || !cache.successes || typeof cache.successes !== "object") {
      return { generatedAt: null, successes: {} };
    }
    return cache;
  } catch {
    return { generatedAt: null, successes: {} };
  }
}

function applyPairCache(pairs, pairCache) {
  let skipped = 0;
  const successes = pairCache && pairCache.successes ? pairCache.successes : {};
  for (const pair of pairs) {
    if (pair.status !== "pending" && pair.status !== "pending_unverified") continue;
    const key = pairCacheKey(pair.source.auth.userId, pair.target.auth.userId);
    if (!successes[key]) continue;
    pair.status = "skipped_known_success";
    skipped += 1;
  }
  return skipped;
}

function updatePairCacheFromResults(results) {
  const cache = readPairCache();
  const successes = cache.successes || {};
  let changed = false;
  for (const item of Array.isArray(results) ? results : []) {
    if (item.status !== "blocked" && item.status !== "skipped_existing_api" && item.status !== "skipped_known_success") continue;
    const key = pairCacheKey(item.sourceUserId, item.targetUserId);
    if (!successes[key]) {
      successes[key] = {
        firstSeenAt: new Date().toISOString(),
        status: item.status,
      };
      changed = true;
    }
  }
  if (changed) {
    ensureDirs();
    writeJson(PAIR_CACHE_FILE, {
      generatedAt: new Date().toISOString(),
      successes,
    });
  }
}

function topFailureReasonsFromPairs(pairs) {
  const counts = new Map();
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (pair.status !== "failed") continue;
    const key = makeFailureReasonKey(pair);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
}

function buildRecommendation(summary, metrics) {
  if ((summary.failed || 0) === 0 && (metrics.rateLimitCount || 0) === 0) {
    if ((metrics.speedProfile || summary.applyMode) === "fast") return "stable_keep_fast";
    if ((metrics.speedProfile || summary.applyMode) === "turbo") return "turbo_ok_watch_429";
    return "stable_keep_balanced";
  }
  if ((metrics.rateLimitCount || 0) >= 50 || (metrics.adaptiveAdjustments || []).length >= 20) {
    return "hold_recovery_longer";
  }
  if ((metrics.rateLimitCount || 0) >= 10) {
    return "retry_with_recovery_profile";
  }
  if ((summary.failed || 0) > 0 && (summary.failed || 0) < 30) {
    return "retry_with_drain_profile";
  }
  if ((summary.failed || 0) > 0) {
    return "run_retry_failed_after_short_cooldown";
  }
  return "balanced_ok";
}

function analyzeEventLog(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;

  const buckets = new Map();
  const failedSources = new Map();
  const failedTargets = new Map();
  const adaptive = [];
  const speed = [];
  let firstAt = null;
  let first429At = null;

  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const at = event.at ? new Date(event.at).getTime() : NaN;
    if (!Number.isFinite(at)) continue;
    if (firstAt === null) firstAt = at;

    if (event.type === "adaptive") {
      adaptive.push(event);
      continue;
    }
    if (event.type === "speed") {
      speed.push(event);
      continue;
    }
    if (event.type !== "pair_finish") continue;

    const minute = Math.max(0, Math.floor((at - firstAt) / 60000));
    const bucket = buckets.get(minute) || { minute, total: 0, ok: 0, failed: 0, rateLimit: 0, timeout: 0, totalLatencyMs: 0 };
    bucket.total += 1;
    bucket.totalLatencyMs += Number(event.durationMs || 0);
    if (event.status === "blocked" || event.status === "skipped_existing_api") bucket.ok += 1;
    if (event.status === "failed") {
      bucket.failed += 1;
      failedSources.set(event.sourceAlias, (failedSources.get(event.sourceAlias) || 0) + 1);
      failedTargets.set(event.targetAlias, (failedTargets.get(event.targetAlias) || 0) + 1);
    }
    if (event.httpStatus === 429) {
      bucket.rateLimit += 1;
      if (!first429At) first429At = event.at;
    }
    if (!event.httpStatus && event.status === "failed") bucket.timeout += 1;
    buckets.set(minute, bucket);
  }

  const perMinute = [...buckets.values()].map((bucket) => ({
    minute: bucket.minute,
    total: bucket.total,
    ok: bucket.ok,
    failed: bucket.failed,
    rateLimit: bucket.rateLimit,
    timeout: bucket.timeout,
    averageLatencyMs: bucket.total ? Math.round(bucket.totalLatencyMs / bucket.total) : 0,
  }));
  const peak = perMinute.reduce((best, item) => (!best || item.rateLimit > best.rateLimit ? item : best), null);
  const sortedEntries = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

  let upshiftCount = 0;
  let downshiftCount = 0;
  for (let index = 1; index < adaptive.length; index += 1) {
    if (adaptive[index].activeConcurrency > adaptive[index - 1].activeConcurrency) upshiftCount += 1;
    if (adaptive[index].activeConcurrency < adaptive[index - 1].activeConcurrency) downshiftCount += 1;
  }

  return {
    eventLogPath: filePath,
    first429At,
    peak429Minute: peak ? peak.minute : null,
    rateLimitPerMinuteMax: peak ? peak.rateLimit : 0,
    perMinute,
    topFailedSources: sortedEntries(failedSources),
    topFailedTargets: sortedEntries(failedTargets),
    adaptiveSummary: {
      total: adaptive.length,
      upshiftCount,
      downshiftCount,
      first: adaptive[0] || null,
      last: adaptive[adaptive.length - 1] || null,
    },
    speedSummary: {
      total: speed.length,
      speedupCount: speed.filter((item) => item.reason === "stable_speedup").length,
      rollbackCount: speed.filter((item) => item.reason === "rate_limit_rollback").length,
      first: speed[0] || null,
      last: speed[speed.length - 1] || null,
    },
  };
}

function writeDiagnostics(command, report) {
  ensureDirs();
  const summary = report.summary || {};
  const metrics = report.metrics || {};
  const failureReasons = topFailureReasonsFromPairs(report.pairs || []);
  const eventLogPath = summary.eventLogPath || metrics.eventLogPath || null;
  const eventAnalysis = analyzeEventLog(eventLogPath);
  const diagnostic = {
    generatedAt: new Date().toISOString(),
    command,
    accountsUsed: summary.validUniqueAccounts || 0,
    directedPairs: summary.directedPairs || 0,
    missingAccountsDuringApply: summary.missingAccountsDuringApply || 0,
    missingPairsDueToValidation: summary.missingPairsDueToValidation || 0,
    blocked: summary.blocked || 0,
    alreadyBlocked: (summary.alreadyBlockedFromApi || 0) + (summary.skippedExisting || 0) + (summary.skippedKnownSuccess || 0),
    failed: summary.failed || 0,
    rateLimitCount: metrics.rateLimitCount || 0,
    averagePairMs: metrics.averagePairMs || 0,
    applyDurationMs: metrics.applyDurationMs || 0,
    first429At: eventAnalysis ? eventAnalysis.first429At : null,
    peak429Minute: eventAnalysis ? eventAnalysis.peak429Minute : null,
    rateLimitPerMinuteMax: eventAnalysis ? eventAnalysis.rateLimitPerMinuteMax : 0,
    topFailedSources: eventAnalysis ? eventAnalysis.topFailedSources.slice(0, 5) : [],
    topFailedTargets: eventAnalysis ? eventAnalysis.topFailedTargets.slice(0, 5) : [],
    adaptiveSummary: eventAnalysis ? eventAnalysis.adaptiveSummary : null,
    speedSummary: eventAnalysis ? eventAnalysis.speedSummary : null,
    eventLogPath,
    topFailureReasons: failureReasons,
    pairsPerMinute: metrics.pairsPerMinute || 0,
    successPairsPerMinute: metrics.successPairsPerMinute || 0,
    globalDelayStartMs: metrics.globalDelayStartMs || null,
    globalDelayEndMs: metrics.globalDelayEndMs || null,
    globalDelayMinMs: metrics.globalDelayMinMs || null,
    speedProfile: metrics.speedProfile || summary.applyMode || null,
    recommendation: buildRecommendation(summary, metrics),
  };
  writeJson(path.join(DIAGNOSTICS_DIR, "latest-summary.json"), diagnostic);
  const lines = [
    `command=${diagnostic.command}`,
    `accountsUsed=${diagnostic.accountsUsed}`,
    `directedPairs=${diagnostic.directedPairs}`,
    `missingAccountsDuringApply=${diagnostic.missingAccountsDuringApply}`,
    `missingPairsDueToValidation=${diagnostic.missingPairsDueToValidation}`,
    `blocked=${diagnostic.blocked}`,
    `alreadyBlocked=${diagnostic.alreadyBlocked}`,
    `failed=${diagnostic.failed}`,
    `rateLimitCount=${diagnostic.rateLimitCount}`,
    `rateLimitPerMinuteMax=${diagnostic.rateLimitPerMinuteMax}`,
    `peak429Minute=${diagnostic.peak429Minute}`,
    `averagePairMs=${diagnostic.averagePairMs}`,
    `pairsPerMinute=${diagnostic.pairsPerMinute}`,
    `successPairsPerMinute=${diagnostic.successPairsPerMinute}`,
    `speedProfile=${diagnostic.speedProfile}`,
    `globalDelayMs=start:${diagnostic.globalDelayStartMs},end:${diagnostic.globalDelayEndMs},floor:${diagnostic.globalDelayMinMs}`,
    `applyDurationMs=${diagnostic.applyDurationMs}`,
    `recommendation=${diagnostic.recommendation}`,
  ];
  if (diagnostic.first429At) lines.push(`first429At=${diagnostic.first429At}`);
  if (diagnostic.adaptiveSummary) {
    lines.push(
      `adaptive=total:${diagnostic.adaptiveSummary.total},up:${diagnostic.adaptiveSummary.upshiftCount},down:${diagnostic.adaptiveSummary.downshiftCount}`,
    );
  }
  if (diagnostic.speedSummary) {
    lines.push(
      `speed=total:${diagnostic.speedSummary.total},up:${diagnostic.speedSummary.speedupCount},rollback:${diagnostic.speedSummary.rollbackCount}`,
    );
  }
  if (diagnostic.topFailedSources.length) {
    lines.push(`topFailedSources=${diagnostic.topFailedSources.map((item) => `${item.name}:${item.count}`).join(",")}`);
  }
  if (diagnostic.topFailedTargets.length) {
    lines.push(`topFailedTargets=${diagnostic.topFailedTargets.map((item) => `${item.name}:${item.count}`).join(",")}`);
  }
  if (failureReasons.length) {
    lines.push(`topFailureReasons=${failureReasons.map((item) => `${item.reason}:${item.count}`).join(",")}`);
  }
  if (eventLogPath) lines.push(`eventLogPath=${eventLogPath}`);
  writeText(path.join(DIAGNOSTICS_DIR, "latest-summary.txt"), lines.join("\n"));
  return diagnostic;
}

function latestReportPath() {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const reports = fs
    .readdirSync(REPORTS_DIR)
    .filter((name) => /^block-report-.*\.json$/i.test(name))
    .sort();
  if (!reports.length) return null;
  return path.join(REPORTS_DIR, reports[reports.length - 1]);
}

async function commandValidate(args) {
  const logger = args.logger || null;
  const metrics = createMetrics();
  ACTIVE_METRICS = metrics;
  const validateStarted = Date.now();
  const applyOptions = normalizeApplyOptions(args);
  const parsed = parseCookiesFile(args.cookiesFile);
  const accounts = limitAccounts(parsed.accounts, args.accountLimit);
  const invalid = parsed.invalid;
  await prepareAccountsAuth(accounts, logger, applyOptions, args);
  metrics.validateDurationMs = Date.now() - validateStarted;

  const duplicates = findDuplicateValidAccounts(accounts);
  const report = {
    inputFile: args.cookiesFile,
    summary: {
      parsedAccounts: accounts.length,
      accountLimit: applyOptions.accountLimit,
      validateConcurrency: applyOptions.validateConcurrency,
      invalidLines: invalid.length,
      validAccounts: accounts.filter((account) => account.valid).length,
      duplicateUserIds: duplicates.length,
    },
    invalid,
    duplicates,
    accounts: accounts.map(accountReport),
    metrics: finishMetrics(metrics),
  };
  ACTIVE_METRICS = null;

  const reportPath = writeReport("validate", report);
  writeDiagnostics("validate", report);
  writeState({ accounts: accounts.map(accountReport), duplicates });
  return { report, reportPath };
}

async function commandPlan(args) {
  const logger = args.logger || null;
  const metrics = createMetrics();
  ACTIVE_METRICS = metrics;
  const applyOptions = normalizeApplyOptions(args);
  const validateStarted = Date.now();
  const parsed = parseCookiesFile(args.cookiesFile);
  const accounts = limitAccounts(parsed.accounts, args.accountLimit);
  const invalid = parsed.invalid;
  await prepareAccountsAuth(accounts, logger, applyOptions, args);
  metrics.validateDurationMs = Date.now() - validateStarted;

  const duplicates = findDuplicateValidAccounts(accounts);
  const unique = validUniqueAccounts(accounts);
  const planStarted = Date.now();
  await loadAllBlockedUsers(unique, logger, {
    skipBlockListCheck: args.skipBlockListCheck || args.allowUnverifiedBlockList,
  });

  const pairs = buildPairs(unique, {
    allowUnverifiedBlockList: args.allowUnverifiedBlockList,
  });
  metrics.planDurationMs = Date.now() - planStarted;
  const reportPairs = args.summaryOnly ? [] : pairs.map((pair) => pairReport(pair));

  const report = {
    inputFile: args.cookiesFile,
    summary: {
      parsedAccounts: accounts.length,
      accountLimit: applyOptions.accountLimit,
      validateConcurrency: applyOptions.validateConcurrency,
      skipBlockListCheck: Boolean(args.skipBlockListCheck || args.allowUnverifiedBlockList),
      invalidLines: invalid.length,
      validUniqueAccounts: unique.length,
      duplicateUserIds: duplicates.length,
      directedPairs: pairs.length,
      pendingBlocks: pairs.filter((pair) => pair.status === "pending").length,
      pendingUnverified: pairs.filter((pair) => pair.status === "pending_unverified").length,
      skippedExisting: pairs.filter((pair) => pair.status === "skipped_existing").length,
      limitRisk: pairs.filter((pair) => pair.status === "blocked_limit_risk").length,
      blockedListUnavailable: pairs.filter((pair) => pair.status === "blocked_list_unavailable").length,
      summaryOnly: Boolean(args.summaryOnly),
    },
    invalid,
    duplicates,
    accounts: accounts.map(accountReport),
    pairs: reportPairs,
    metrics: finishMetrics(metrics),
  };
  ACTIVE_METRICS = null;

  createLogger(logger).log(
    `Plan: ${report.summary.validUniqueAccounts} accounts, ${report.summary.directedPairs} directed pairs, ${report.summary.pendingBlocks} pending blocks, ${report.summary.pendingUnverified} pending unverified.`,
  );
  const reportPath = writeReport("plan", report);
  writeState({ accounts: accounts.map(accountReport), duplicates, lastPlan: report.summary });
  return { report, reportPath };
}

async function commandSimulate(args) {
  const logger = args.logger || null;
  const output = createLogger(logger);
  const metrics = createMetrics();
  ACTIVE_METRICS = metrics;
  const applyOptions = normalizeApplyOptions(args);
  setRuntimeConfig(applyOptions);
  const profile = normalizeSimulationProfile(args.simulationProfile);

  const validateStarted = Date.now();
  const parsed = parseCookiesFile(args.cookiesFile);
  const accounts = limitAccounts(parsed.accounts, applyOptions.accountLimit);
  const invalid = parsed.invalid;
  await prepareAccountsAuth(accounts, logger, applyOptions, args);
  metrics.validateDurationMs = Date.now() - validateStarted;

  const duplicates = findDuplicateValidAccounts(accounts);
  const unique = validUniqueAccounts(accounts);
  const planStarted = Date.now();
  await loadAllBlockedUsers(unique, logger, {
    skipBlockListCheck: true,
  });

  const pairs = buildPairs(unique, {
    allowUnverifiedBlockList: true,
  });
  metrics.planDurationMs = Date.now() - planStarted;
  const pending = pairs.filter((pair) => pair.status === "pending" || pair.status === "pending_unverified");
  const estimatedApplyDurationMs = estimateApplyMs(pending.length, applyOptions);

  output.log(
    `Simulation: ${unique.length} accounts, ${pairs.length} directed pairs, profile=${profile.name}, estimated apply ${Math.round(estimatedApplyDurationMs / 1000)}s. No block requests will be sent.`,
  );

  const applyStarted = Date.now();
  const results = pairs.map((pair, index) => {
    if (pair.status !== "pending" && pair.status !== "pending_unverified") {
      return pairReport(pair, { applyMode: applyOptions.applyMode, simulated: true });
    }
    return simulatePairResult(pair, index, profile, applyOptions);
  });
  metrics.applyDurationMs = Date.now() - applyStarted;
  metrics.averagePairMs = results.length > 0 ? Math.round(estimatedApplyDurationMs / results.length) : 0;
  metrics.pairsPerMinute = estimatedApplyDurationMs > 0 ? Math.round((results.length / (estimatedApplyDurationMs / 60000)) * 10) / 10 : 0;
  metrics.successPairsPerMinute = estimatedApplyDurationMs > 0
    ? Math.round((results.filter((item) => item.status === "blocked" || item.status === "skipped_existing_api").length / (estimatedApplyDurationMs / 60000)) * 10) / 10
    : 0;
  metrics.globalDelayStartMs = applyOptions.globalBlockDelayMs;
  metrics.globalDelayEndMs = applyOptions.globalBlockDelayMs;
  metrics.globalDelayMinMs = applyOptions.globalBlockDelayFloorMs;
  metrics.speedProfile = applyOptions.applyMode;

  const report = {
    inputFile: args.cookiesFile,
    summary: {
      parsedAccounts: accounts.length,
      accountLimit: applyOptions.accountLimit,
      invalidLines: invalid.length,
      validUniqueAccounts: unique.length,
      duplicateUserIds: duplicates.length,
      directedPairs: pairs.length,
      applyMode: applyOptions.applyMode,
      accountConcurrency: applyOptions.accountConcurrency,
      validateConcurrency: applyOptions.validateConcurrency,
      perAccountDelayMinMs: applyOptions.perAccountDelayMinMs,
      perAccountDelayMaxMs: applyOptions.perAccountDelayMaxMs,
      globalBlockDelayStartMs: applyOptions.globalBlockDelayMs,
      globalBlockDelayEndMs: applyOptions.globalBlockDelayMs,
      globalBlockDelayFloorMs: applyOptions.globalBlockDelayFloorMs,
      speedProfile: applyOptions.applyMode,
      skipBlockListCheck: true,
      simulationProfile: profile.name,
      estimatedApplyDurationMs,
      estimatedApplySeconds: Math.round(estimatedApplyDurationMs / 1000),
      blocked: results.filter((item) => item.status === "blocked").length,
      failed: results.filter((item) => item.status === "failed").length,
      alreadyBlockedFromApi: results.filter((item) => item.status === "skipped_existing_api").length,
      skippedExisting: results.filter((item) => item.status === "skipped_existing").length,
      limitRisk: results.filter((item) => item.status === "blocked_limit_risk").length,
      blockedListUnavailable: results.filter((item) => item.status === "blocked_list_unavailable").length,
      unverifiedAttempts: results.filter((item) => item.unverifiedBlockList === true).length,
      pairsPerMinute: metrics.pairsPerMinute,
      successPairsPerMinute: metrics.successPairsPerMinute,
      simulated: true,
    },
    invalid,
    duplicates,
    accounts: accounts.map(accountReport),
    pairs: results,
    metrics: finishMetrics(metrics),
  };
  ACTIVE_METRICS = null;

  const reportPath = writeReport("simulate", report);
  writeDiagnostics("simulate", report);
  writeState({ accounts: accounts.map(accountReport), duplicates, lastSimulation: report.summary });
  return { report, reportPath };
}

async function commandApply(args) {
  const logger = args.logger || null;
  const output = createLogger(logger);
  const metrics = createMetrics();
  ACTIVE_METRICS = metrics;
  const applyOptions = normalizeApplyOptions(args);
  setRuntimeConfig(applyOptions);
  const validateStarted = Date.now();
  const parsed = parseCookiesFile(args.cookiesFile);
  const accounts = limitAccounts(parsed.accounts, applyOptions.accountLimit);
  const invalid = parsed.invalid;
  await prepareAccountsAuth(accounts, logger, applyOptions, args);
  metrics.validateDurationMs = Date.now() - validateStarted;

  const duplicates = findDuplicateValidAccounts(accounts);
  const unique = validUniqueAccounts(accounts);
  const expectedAccounts = clampNumber(args.expectAccounts, 0, 10000, 0);
  if (expectedAccounts > 0 && unique.length < expectedAccounts) {
    const missing = accounts
      .filter((account) => !account.valid)
      .map((account) => `${account.alias || `line${account.lineNo}`}: ${account.auth ? account.auth.status || "invalid" : "not_checked"}`)
      .slice(0, 20)
      .join(", ");
    ACTIVE_METRICS = null;
    throw new Error(
      `Apply aborted before sending block requests: validated ${unique.length}/${expectedAccounts} expected accounts. Missing/invalid sample: ${missing || "none"}`,
    );
  }
  const planStarted = Date.now();
  await loadAllBlockedUsers(unique, logger, {
    skipBlockListCheck: args.skipBlockListCheck || args.allowUnverifiedBlockList,
  });

  const pairs = buildPairs(unique, {
    allowUnverifiedBlockList: args.allowUnverifiedBlockList,
  });
  const cacheSkipped = applyPairCache(pairs, readPairCache());
  metrics.planDurationMs = Date.now() - planStarted;
  const pending = pairs.filter((pair) => pair.status === "pending" || pair.status === "pending_unverified");
  const skippedExisting = pairs.filter((pair) => pair.status === "skipped_existing");
  const skippedKnownSuccess = pairs.filter((pair) => pair.status === "skipped_known_success");
  const limitRisk = pairs.filter((pair) => pair.status === "blocked_limit_risk");
  const blockedListUnavailable = pairs.filter((pair) => pair.status === "blocked_list_unavailable");
  const results = [];

  output.log(
    `Apply summary: ${unique.length} accounts, ${pairs.length} directed pairs, ${pending.length} to block, ${skippedExisting.length} already blocked, ${skippedKnownSuccess.length} known-success cached, ${limitRisk.length} limit-risk skipped, ${blockedListUnavailable.length} blocked-list-unavailable skipped.`,
  );
  output.log(
    `Starting ${applyOptions.applyMode} per-account lanes. concurrency=${applyOptions.accountConcurrency}, delay=${applyOptions.perAccountDelayMinMs}-${applyOptions.perAccountDelayMaxMs}ms, globalDelay=${applyOptions.globalBlockDelayMs}ms floor=${applyOptions.globalBlockDelayFloorMs}ms. Secrets will not be printed or written.`,
  );

  const applyStarted = Date.now();
  const eventLogger = createEventLogger("apply");
  const laneRun = await runApplyLanes(pairs, output, applyOptions, args.cancelToken, eventLogger);
  metrics.applyDurationMs = Date.now() - applyStarted;
  results.push(...laneRun.results);
  metrics.averagePairMs = results.length > 0 ? Math.round(metrics.applyDurationMs / results.length) : 0;
  finalizeApplySpeedMetrics(metrics, results, applyOptions);
  updatePairCacheFromResults(results);

  const report = {
    inputFile: args.cookiesFile,
    summary: {
      parsedAccounts: accounts.length,
      accountLimit: applyOptions.accountLimit,
      invalidLines: invalid.length,
      validUniqueAccounts: unique.length,
      missingAccountsDuringApply: Math.max(0, accounts.length - unique.length - duplicates.length),
      missingPairsDueToValidation: Math.max(0, accounts.length * Math.max(0, accounts.length - 1) - unique.length * Math.max(0, unique.length - 1)),
      duplicateUserIds: duplicates.length,
      directedPairs: pairs.length,
      applyMode: applyOptions.applyMode,
      accountConcurrency: applyOptions.accountConcurrency,
      validateConcurrency: applyOptions.validateConcurrency,
      perAccountDelayMinMs: applyOptions.perAccountDelayMinMs,
      perAccountDelayMaxMs: applyOptions.perAccountDelayMaxMs,
      globalBlockDelayStartMs: applyOptions.globalBlockDelayMs,
      globalBlockDelayEndMs: CONFIG.globalBlockDelayMs,
      globalBlockDelayFloorMs: applyOptions.globalBlockDelayFloorMs,
      speedProfile: applyOptions.applyMode,
      targetCooldownMs: applyOptions.targetCooldownMs,
      recoveryHoldMs: applyOptions.recoveryHoldMs,
      sourceWindowMs: applyOptions.sourceWindowMs,
      sourceMaxPerWindow: applyOptions.sourceMaxPerWindow,
      source429PenaltyMs: applyOptions.source429PenaltyMs,
      cacheSkipped,
      skipBlockListCheck: Boolean(args.skipBlockListCheck || args.allowUnverifiedBlockList),
      cancelled: laneRun.cancelled,
      pendingAfterCancel: laneRun.pendingAfterCancel,
      blocked: results.filter((item) => item.status === "blocked").length,
      failed: results.filter((item) => item.status === "failed").length,
      alreadyBlockedFromApi: results.filter((item) => item.status === "skipped_existing_api").length,
      skippedExisting: results.filter((item) => item.status === "skipped_existing").length,
      skippedKnownSuccess: results.filter((item) => item.status === "skipped_known_success").length,
      limitRisk: results.filter((item) => item.status === "blocked_limit_risk").length,
      blockedListUnavailable: results.filter((item) => item.status === "blocked_list_unavailable").length,
      unverifiedAttempts: results.filter((item) => item.unverifiedBlockList === true).length,
      pairsPerMinute: metrics.pairsPerMinute,
      successPairsPerMinute: metrics.successPairsPerMinute,
      eventLogPath: eventLogger.filePath,
    },
    invalid,
    duplicates,
    accounts: accounts.map(accountReport),
    pairs: results,
    metrics: finishMetrics(metrics),
  };
  ACTIVE_METRICS = null;

  const reportPath = writeReport("apply", report);
  writeDiagnostics("apply", report);
  writeState({ accounts: accounts.map(accountReport), duplicates, lastApply: report.summary });
  return { report, reportPath };
}

async function commandRetryFailed(args) {
  if (!args.reportFile) {
    throw new Error("Missing --report reports\\block-report-xxxx.json");
  }
  if (!fs.existsSync(args.reportFile)) {
    throw new Error(`Missing report file: ${args.reportFile}`);
  }

  const logger = args.logger || null;
  const output = createLogger(logger);
  const metrics = createMetrics();
  ACTIVE_METRICS = metrics;
  const applyOptions = normalizeApplyOptions(args);
  setRuntimeConfig(applyOptions);

  const sourceReport = JSON.parse(fs.readFileSync(args.reportFile, "utf8"));
  const failedPairs = Array.isArray(sourceReport.pairs)
    ? sourceReport.pairs.filter(
        (pair) => pair.status === "failed" && (pair.retryable === true || pair.httpStatus === 429 || (pair.httpStatus || 0) >= 500),
      )
    : [];

  const validateStarted = Date.now();
  const parsed = parseCookiesFile(args.cookiesFile);
  const accounts = limitAccounts(parsed.accounts, applyOptions.accountLimit);
  const invalid = parsed.invalid;
  await prepareAccountsAuth(accounts, logger, applyOptions, args);
  metrics.validateDurationMs = Date.now() - validateStarted;

  const duplicates = findDuplicateValidAccounts(accounts);
  const unique = validUniqueAccounts(accounts);
  for (const account of unique) {
    if (!(account.blockedUsers instanceof Set)) {
      account.blockedUsers = new Set();
      account.blockListStatus = "unavailable";
      account.blockListError = "retry_assumed_unverified";
    }
  }
  const accountsByUserId = new Map(unique.map((account) => [Number(account.auth.userId), account]));
  const pairs = [];
  const skipped = [];

  for (const failedPair of failedPairs) {
    const source = accountsByUserId.get(Number(failedPair.sourceUserId));
    if (!source) {
      skipped.push({
        ...failedPair,
        status: "skipped_missing_source_cookie",
      });
      continue;
    }
    pairs.push({
      source,
      target: makeSyntheticTarget(failedPair),
      status: "pending_unverified",
    });
  }
  const cacheSkipped = applyPairCache(pairs, readPairCache());

  output.log(
    `Retry failed: sourceReport=${path.basename(args.reportFile)}, failedPairs=${failedPairs.length}, retryable=${pairs.length}, skipped=${skipped.length}.`,
  );

  const applyStarted = Date.now();
  const eventLogger = createEventLogger("retry-failed");
  const laneRun = await runApplyLanes(pairs, output, applyOptions, args.cancelToken, eventLogger);
  metrics.applyDurationMs = Date.now() - applyStarted;
  metrics.averagePairMs = laneRun.results.length > 0 ? Math.round(metrics.applyDurationMs / laneRun.results.length) : 0;
  finalizeApplySpeedMetrics(metrics, laneRun.results, applyOptions);

  const results = [...skipped, ...laneRun.results];
  updatePairCacheFromResults(results);
  const report = {
    inputFile: args.cookiesFile,
    sourceReport: args.reportFile,
    summary: {
      parsedAccounts: accounts.length,
      accountLimit: applyOptions.accountLimit,
      invalidLines: invalid.length,
      validUniqueAccounts: unique.length,
      duplicateUserIds: duplicates.length,
      sourceFailedPairs: failedPairs.length,
      retryablePairs: pairs.length,
      directedPairs: pairs.length,
      applyMode: applyOptions.applyMode,
      accountConcurrency: applyOptions.accountConcurrency,
      validateConcurrency: applyOptions.validateConcurrency,
      perAccountDelayMinMs: applyOptions.perAccountDelayMinMs,
      perAccountDelayMaxMs: applyOptions.perAccountDelayMaxMs,
      globalBlockDelayStartMs: applyOptions.globalBlockDelayMs,
      globalBlockDelayEndMs: CONFIG.globalBlockDelayMs,
      globalBlockDelayFloorMs: applyOptions.globalBlockDelayFloorMs,
      speedProfile: applyOptions.applyMode,
      targetCooldownMs: applyOptions.targetCooldownMs,
      recoveryHoldMs: applyOptions.recoveryHoldMs,
      sourceWindowMs: applyOptions.sourceWindowMs,
      sourceMaxPerWindow: applyOptions.sourceMaxPerWindow,
      source429PenaltyMs: applyOptions.source429PenaltyMs,
      cacheSkipped,
      cancelled: laneRun.cancelled,
      pendingAfterCancel: laneRun.pendingAfterCancel,
      blocked: results.filter((item) => item.status === "blocked").length,
      failed: results.filter((item) => item.status === "failed").length,
      alreadyBlockedFromApi: results.filter((item) => item.status === "skipped_existing_api").length,
      skippedKnownSuccess: results.filter((item) => item.status === "skipped_known_success").length,
      skippedMissingSourceCookie: results.filter((item) => item.status === "skipped_missing_source_cookie").length,
      unverifiedAttempts: results.filter((item) => item.unverifiedBlockList === true).length,
      pairsPerMinute: metrics.pairsPerMinute,
      successPairsPerMinute: metrics.successPairsPerMinute,
      eventLogPath: eventLogger.filePath,
    },
    invalid,
    duplicates,
    accounts: accounts.map(accountReport),
    pairs: results,
    metrics: finishMetrics(metrics),
  };
  ACTIVE_METRICS = null;

  const reportPath = writeReport("retry-failed", report);
  writeDiagnostics("retry-failed", report);
  writeState({ accounts: accounts.map(accountReport), duplicates, lastRetryFailed: report.summary });
  return { report, reportPath };
}

function commandDiagnose() {
  const reportPath = latestReportPath();
  if (!reportPath) {
    throw new Error("No report found to diagnose");
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const diagnostic = writeDiagnostics(report.command || "unknown", report);
  console.log(`Diagnostic written: ${path.join(DIAGNOSTICS_DIR, "latest-summary.txt")}`);
  console.log(`Diagnostic summary: ${JSON.stringify(diagnostic)}`);
  return diagnostic;
}

function commandStatus() {
  const stateExists = fs.existsSync(STATE_FILE);
  const reportPath = latestReportPath();
  const status = {
    statePath: stateExists ? STATE_FILE : null,
    latestReportPath: reportPath,
    state: null,
    latestReport: null,
  };

  console.log(`State: ${stateExists ? STATE_FILE : "not found"}`);
  console.log(`Latest report: ${reportPath || "not found"}`);

  if (stateExists) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    status.state = state;
    console.log(`State generatedAt: ${state.generatedAt || "unknown"}`);
    if (state.accounts) {
      console.log(`Accounts in state: ${state.accounts.length}`);
      for (const account of state.accounts) {
        console.log(
          `- ${account.alias}: ${account.valid ? "valid" : "invalid"} userId=${account.userId || "-"} username=${account.username || "-"}`,
        );
      }
    }
  }

  if (reportPath) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    status.latestReport = report;
    console.log(`Latest command: ${report.command || "unknown"}`);
    console.log(`Summary: ${JSON.stringify(report.summary || {})}`);
  }

  return status;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.command === "help") {
    printUsage();
    return;
  }

  if (!["validate", "plan", "simulate", "apply", "retry-failed", "status", "diagnose"].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command}`);
  }

  if (args.command === "status") {
    commandStatus();
    return;
  }
  if (args.command === "diagnose") {
    commandDiagnose();
    return;
  }

  console.log("Roblox Block Mesh");
  console.log("Secrets policy: passwords, cookies, and CSRF tokens are redacted and never written.");
  console.log(`Input: ${args.cookiesFile}`);

  if (args.command === "validate") await commandValidate(args);
  if (args.command === "plan") await commandPlan(args);
  if (args.command === "simulate") await commandSimulate(args);
  if (args.command === "apply") await commandApply(args);
  if (args.command === "retry-failed") await commandRetryFailed(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Fatal: ${sanitizeError(error.message)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ROOT,
  DEFAULT_COOKIES_FILE,
  REPORTS_DIR,
  STATE_DIR,
  STATE_FILE,
  CONFIG,
  setRuntimeConfig,
  sanitizeError,
  parseCookiesFile,
  commandValidate,
  commandPlan,
  commandSimulate,
  commandApply,
  commandRetryFailed,
  commandStatus,
  latestReportPath,
};
