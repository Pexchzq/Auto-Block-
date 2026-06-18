import { createClient } from "@supabase/supabase-js";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "JOB_INPUT_ENCRYPTION_KEY",
  "MAX_ACTIVE_JOBS_PER_USER",
];

const optional = [
  "WORKER_API_BASE",
  "WORKER_API_TOKEN",
  "PAYMENT_PROVIDER_MODE",
];

function status(name, ok, detail = "") {
  const mark = ok ? "OK" : "FAIL";
  console.log(`${mark} ${name}${detail ? ` - ${detail}` : ""}`);
  return ok;
}

function mask(value) {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

let passed = true;

console.log("BlockMesh production readiness check\n");

for (const key of required) {
  passed = status(`env ${key}`, Boolean(process.env[key]), process.env[key] ? mask(process.env[key]) : "missing") && passed;
}

for (const key of optional) {
  status(`env ${key}`, Boolean(process.env[key]), process.env[key] ? mask(process.env[key]) : "not set");
}

if (process.env.MAX_ACTIVE_JOBS_PER_USER) {
  const limit = Number(process.env.MAX_ACTIVE_JOBS_PER_USER);
  passed = status("env MAX_ACTIVE_JOBS_PER_USER value", Number.isFinite(limit) && limit > 0, String(process.env.MAX_ACTIVE_JOBS_PER_USER)) && passed;
}

if (process.env.JOB_INPUT_ENCRYPTION_KEY) {
  passed = status("env JOB_INPUT_ENCRYPTION_KEY length", process.env.JOB_INPUT_ENCRYPTION_KEY.length >= 32, "minimum 32 characters recommended") && passed;
}

passed = status(
  "env BLOCKMESH_LOCAL_WORKER disabled",
  process.env.BLOCKMESH_LOCAL_WORKER !== "1",
  process.env.BLOCKMESH_LOCAL_WORKER === "1" ? "local worker is dev-only; use WORKER_API_BASE in production" : "ok",
) && passed;

passed = status(
  "env ALLOW_PLACEHOLDER_TOPUP disabled",
  process.env.ALLOW_PLACEHOLDER_TOPUP !== "1",
  process.env.ALLOW_PLACEHOLDER_TOPUP === "1" ? "placeholder top-up grants free balance; use admin adjustment until live payment is connected" : "ok",
) && passed;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (url && serviceRole) {
  const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });

  const tableChecks = [
    "profiles",
    "wallet_ledger",
    "jobs",
    "job_reports",
    "job_inputs",
    "payment_vouchers",
    "worker_nodes",
    "audit_logs",
  ];

  for (const table of tableChecks) {
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true });
    passed = status(`supabase table ${table}`, !error, error?.message) && passed;
  }

  const { data: admins, error: adminError } = await supabase
    .from("profiles")
    .select("id,email")
    .eq("role", "admin")
    .limit(1);
  passed = status("admin account", !adminError && Array.isArray(admins) && admins.length > 0, adminError?.message || (admins?.length ? admins[0].email : "no admin profile found")) && passed;
}

if (process.env.WORKER_API_BASE) {
  try {
    const healthUrl = new URL("/health", process.env.WORKER_API_BASE);
    const response = await fetch(healthUrl, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    passed = status("worker health", response.ok && body.ok === true, response.ok ? JSON.stringify(body) : `HTTP ${response.status}`) && passed;
  } catch (error) {
    passed = status("worker health", false, error instanceof Error ? error.message : "unknown error") && passed;
  }
}

console.log(`\nResult: ${passed ? "READY" : "NOT READY"}`);
process.exit(passed ? 0 : 1);
