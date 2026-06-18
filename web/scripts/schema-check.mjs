import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "..", "supabase", "schema.sql");
const schema = await readFile(schemaPath, "utf8");
const normalized = schema.replace(/\s+/g, " ").toLowerCase();

function includes(fragment, message) {
  assert.equal(normalized.includes(fragment.toLowerCase().replace(/\s+/g, " ")), true, message || `Missing SQL fragment: ${fragment}`);
}

for (const table of [
  "profiles",
  "wallet_ledger",
  "jobs",
  "job_reports",
  "job_inputs",
  "payment_vouchers",
  "worker_nodes",
  "audit_logs",
]) {
  includes(`create table if not exists public.${table}`, `missing table ${table}`);
  includes(`alter table public.${table} enable row level security`, `missing RLS enable for ${table}`);
}

for (const policy of [
  "profiles_select_own",
  "profiles_admin_select",
  "wallet_select_own",
  "wallet_admin_select",
  "jobs_select_own",
  "jobs_admin_select",
  "reports_select_own",
  "reports_admin_select",
  "job_inputs_select_own",
  "vouchers_select_own",
  "vouchers_admin_select",
  "worker_nodes_admin_select",
  "audit_logs_admin_select",
]) {
  includes(`create policy "${policy}"`, `missing policy ${policy}`);
}

includes("create extension if not exists \"pgcrypto\"", "missing pgcrypto extension");
includes("create trigger on_auth_user_created", "missing profile creation trigger");
includes("create or replace function public.is_admin()", "missing admin helper");
includes("create unique index if not exists wallet_ledger_provider_reference_unique_idx on public.wallet_ledger(provider, reference)", "missing wallet ledger idempotency index");
includes("unique(provider, reference)", "missing voucher duplicate guard");
includes("status text not null check (status in ('draft', 'queued', 'running', 'retrying', 'completed', 'failed', 'cancelled'))", "missing job status constraint");
includes("type text not null check (type in ('topup', 'reserve', 'capture', 'refund', 'manual_adjust'))", "missing wallet ledger type constraint");
includes("account_count integer not null check (account_count between 2 and 5000)", "missing account count safety constraint");
includes("account_text text not null", "missing encrypted account text storage column");

console.log("Schema check passed.");
