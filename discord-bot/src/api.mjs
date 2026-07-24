import { requiredEnv } from "./env.mjs";
import { safeError } from "./sanitize.mjs";

function apiBase() {
  const url = new URL(requiredEnv("WEB_API_BASE"));
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && process.env.NODE_ENV !== "production")) {
    throw new Error("WEB_API_BASE must use HTTPS");
  }
  return url;
}

async function requestJson(pathname, init = {}) {
  const url = new URL(pathname, apiBase());
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requiredEnv("BOT_API_TOKEN")}`,
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? safeError(body.error) : `BlockMesh API HTTP ${response.status}`);
  }
  return body;
}

export function createJob(discordUserId, accountText, mode = "balanced") {
  return requestJson("/api/bot/jobs", {
    method: "POST",
    body: JSON.stringify({ discordUserId, accountText, mode }),
  });
}

export function getJob(discordUserId, jobId) {
  return requestJson(`/api/bot/jobs/${encodeURIComponent(jobId)}?discordUserId=${encodeURIComponent(discordUserId)}`);
}

export function getReport(discordUserId, jobId) {
  return requestJson(`/api/bot/jobs/${encodeURIComponent(jobId)}/report?discordUserId=${encodeURIComponent(discordUserId)}`);
}

export function getUser(discordUserId) {
  return requestJson(`/api/bot/users/${encodeURIComponent(discordUserId)}`);
}

export function getActiveJobs() {
  return requestJson("/api/bot/jobs?active=1");
}
