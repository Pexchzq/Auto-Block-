import { loadEnv } from "../src/env.mjs";

await loadEnv();

const required = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "DISCORD_ALLOWED_ROLE_IDS",
  "WEB_API_BASE",
  "BOT_API_TOKEN",
];

let passed = true;

function status(name, ok, detail = "") {
  console.log(`${ok ? "OK" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
  passed = ok && passed;
}

for (const key of required) {
  status(key, Boolean(String(process.env[key] || "").trim()), process.env[key] ? "configured" : "missing");
}

const ids = ["DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"]
  .flatMap((key) => [key, String(process.env[key] || "").trim()]);
for (let index = 0; index < ids.length; index += 2) {
  status(`${ids[index]} format`, /^\d{5,30}$/.test(ids[index + 1]), "must be a Discord snowflake");
}

const roleIds = String(process.env.DISCORD_ALLOWED_ROLE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
status(
  "DISCORD_ALLOWED_ROLE_IDS format",
  roleIds.length > 0 && roleIds.every((value) => /^\d{5,30}$/.test(value)),
  `${roleIds.length} role(s)`,
);

const botToken = String(process.env.BOT_API_TOKEN || "");
status("BOT_API_TOKEN length", botToken.length >= 32, "minimum 32 characters");
status(
  "BOT_API_TOKEN separation",
  Boolean(botToken) && botToken !== String(process.env.WORKER_API_TOKEN || ""),
  "must differ from WORKER_API_TOKEN",
);

try {
  const base = new URL(String(process.env.WEB_API_BASE || ""));
  const local = ["localhost", "127.0.0.1"].includes(base.hostname);
  status("WEB_API_BASE protocol", base.protocol === "https:" || local, base.origin);
} catch {
  status("WEB_API_BASE format", false, "invalid URL");
}

console.log(`\nResult: ${passed ? "READY" : "NOT READY"}`);
process.exit(passed ? 0 : 1);
