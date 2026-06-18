-- BlockMesh production-ready starter schema.
-- Run this in the Supabase SQL Editor before enabling Supabase-backed mode.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid,
  type text not null check (type in ('topup', 'reserve', 'capture', 'refund', 'manual_adjust')),
  amount_baht numeric(12,2) not null,
  label text not null,
  provider text,
  reference text,
  status text not null default 'posted' check (status in ('posted', 'reserved', 'void', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('draft', 'queued', 'running', 'retrying', 'completed', 'failed', 'cancelled')),
  mode text not null check (mode in ('balanced', 'stable')),
  account_count integer not null check (account_count between 2 and 5000),
  directed_pairs integer not null,
  price_per_pair_baht numeric(10,4) not null,
  reserved_baht numeric(12,2) not null default 0,
  charged_baht numeric(12,2) not null default 0,
  refunded_baht numeric(12,2) not null default 0,
  blocked integer not null default 0,
  already_blocked integer not null default 0,
  failed integer not null default 0,
  worker_region text,
  worker_status text not null default 'mock',
  note text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  report_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.job_inputs (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_text text not null,
  status text not null default 'stored' check (status in ('stored', 'consumed', 'deleted')),
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now()
);

create table if not exists public.payment_vouchers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'truemoney',
  reference text not null,
  amount_baht numeric(12,2),
  status text not null default 'preview' check (status in ('preview', 'posted', 'duplicate', 'failed')),
  raw_hash text,
  created_at timestamptz not null default now(),
  unique(provider, reference)
);

create table if not exists public.worker_nodes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region text,
  status text not null default 'offline' check (status in ('online', 'offline', 'draining', 'failed')),
  active_jobs integer not null default 0,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wallet_ledger_user_created_idx on public.wallet_ledger(user_id, created_at desc);
create unique index if not exists wallet_ledger_provider_reference_unique_idx
  on public.wallet_ledger(provider, reference);
create index if not exists jobs_user_created_idx on public.jobs(user_id, created_at desc);
create index if not exists job_reports_job_created_idx on public.job_reports(job_id, created_at desc);
create index if not exists job_inputs_user_created_idx on public.job_inputs(user_id, created_at desc);
create index if not exists payment_vouchers_user_created_idx on public.payment_vouchers(user_id, created_at desc);
create index if not exists worker_nodes_status_seen_idx on public.worker_nodes(status, last_seen_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.jobs enable row level security;
alter table public.job_reports enable row level security;
alter table public.job_inputs enable row level security;
alter table public.payment_vouchers enable row level security;
alter table public.worker_nodes enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_admin_select" on public.profiles;
drop policy if exists "profiles_admin_update" on public.profiles;
drop policy if exists "wallet_select_own" on public.wallet_ledger;
drop policy if exists "wallet_admin_select" on public.wallet_ledger;
drop policy if exists "jobs_select_own" on public.jobs;
drop policy if exists "jobs_admin_select" on public.jobs;
drop policy if exists "reports_select_own" on public.job_reports;
drop policy if exists "reports_admin_select" on public.job_reports;
drop policy if exists "job_inputs_select_own" on public.job_inputs;
drop policy if exists "vouchers_select_own" on public.payment_vouchers;
drop policy if exists "vouchers_admin_select" on public.payment_vouchers;
drop policy if exists "worker_nodes_admin_select" on public.worker_nodes;
drop policy if exists "audit_logs_admin_select" on public.audit_logs;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_admin_select" on public.profiles for select using (public.is_admin());
create policy "profiles_admin_update" on public.profiles for update using (public.is_admin());
create policy "wallet_select_own" on public.wallet_ledger for select using (auth.uid() = user_id);
create policy "wallet_admin_select" on public.wallet_ledger for select using (public.is_admin());
create policy "jobs_select_own" on public.jobs for select using (auth.uid() = user_id);
create policy "jobs_admin_select" on public.jobs for select using (public.is_admin());
create policy "reports_select_own" on public.job_reports for select using (auth.uid() = user_id);
create policy "reports_admin_select" on public.job_reports for select using (public.is_admin());
create policy "job_inputs_select_own" on public.job_inputs for select using (auth.uid() = user_id);
create policy "vouchers_select_own" on public.payment_vouchers for select using (auth.uid() = user_id);
create policy "vouchers_admin_select" on public.payment_vouchers for select using (public.is_admin());
create policy "worker_nodes_admin_select" on public.worker_nodes for select using (public.is_admin());
create policy "audit_logs_admin_select" on public.audit_logs for select using (public.is_admin());
