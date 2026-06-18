# BlockMesh Deployment Checklist

Use this checklist before opening the system to real users. TrueMoney live verification is intentionally excluded until after deploy.

## 1. Supabase

- [ ] Create a Supabase project.
- [ ] Run `web/supabase/schema.sql` in the SQL Editor.
- [ ] Confirm these tables exist:
  - `profiles`
  - `wallet_ledger`
  - `jobs`
  - `job_reports`
  - `job_inputs`
  - `payment_vouchers`
  - `worker_nodes`
  - `audit_logs`
- [ ] Enable email/password auth.
- [ ] Seed admin:

```powershell
cd web
$env:NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
$env:ADMIN_EMAIL="admin@blockmesh.local"
$env:ADMIN_PASSWORD="your-password"
npm run seed:admin
```

## 2. Vercel Web

- [ ] Deploy the `web/` folder.
- [ ] Generate secrets locally:

```powershell
cd web
npm run generate:secrets
```

- [ ] Set env vars:
  - `NEXT_PUBLIC_APP_ENV=production`
  - `NEXT_PUBLIC_SITE_URL=https://your-domain.com`
  - `NEXT_PUBLIC_SUPABASE_URL=...`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY=...`
  - `SUPABASE_SERVICE_ROLE_KEY=...`
  - `JOB_INPUT_ENCRYPTION_KEY=<long random secret>`
  - `WORKER_API_BASE=https://your-worker-domain`
  - `WORKER_API_TOKEN=<same token as worker>`
  - `PAYMENT_PROVIDER_MODE=placeholder`
  - `ALLOW_PLACEHOLDER_TOPUP=0`
  - `MAX_ACTIVE_JOBS_PER_USER=2`
- [ ] Do not set `BLOCKMESH_LOCAL_WORKER=1` on Vercel. It is only for local development; production must use `WORKER_API_BASE`.
- [ ] Do not set `ALLOW_PLACEHOLDER_TOPUP=1` in production. Use admin wallet adjustment until live payment verification is connected.
- [ ] Run the local predeploy check successfully:

```powershell
cd web
npm run predeploy:check
```

- [ ] Visit `/admin` with the admin account.
- [ ] Confirm `/admin` can list users.
- [ ] Test a small manual wallet adjustment on a test user.
- [ ] Confirm manual adjustment appears in `/admin` audit logs.
- [ ] Test expired account input cleanup from `/admin`.
- [ ] Confirm admin wallet adjustment, admin cancellation, and cleanup all write audit logs.

## 3. Worker

- [ ] Put `blockmesh.exe` on the worker machine.
- [ ] Copy `worker/.env.example` to `worker/.env`.
- [ ] Set:
  - `WORKER_API_TOKEN=<same token as Vercel>`
  - `WEB_CALLBACK_BASE=https://your-domain.com`
  - `BLOCKMESH_EXE=C:\path\to\blockmesh.exe`
  - `WORKER_WORKSPACE=C:\BlockMeshWorker\.work`
  - `WORKER_CONCURRENCY=1`
- [ ] Start with `worker/run-worker.bat`.
- [ ] Run `npm run verify:worker` on the worker machine and confirm the result is `READY`.
- [ ] Verify `GET /health` returns `{ "ok": true }`.

## 4. Readiness

From an environment with production env vars:

```powershell
cd web
npm run verify:production
```

The result should be `READY`.

## 5. End-to-End Test

- [ ] Sign up/login on the deployed web app.
- [ ] Top up in placeholder mode.
- [ ] Confirm admin manual wallet adjustment appears in the user ledger.
- [ ] Confirm admin cancel/manual adjustment writes audit logs.
- [ ] Create a small test job.
- [ ] Confirm pasted account lines are counted server-side and quote matches line count.
- [ ] Confirm invalid account input is rejected without echoing cookies.
- [ ] Confirm rate limits return 429 on repeated quote/draft/confirm/top-up requests.
- [ ] Confirm job and verify wallet reserve.
- [ ] Confirm active job limit blocks duplicate concurrent submissions.
- [ ] Confirm job confirmation fails before reserve if `WORKER_API_BASE` is missing.
- [ ] Confirm users cannot self-credit wallet through placeholder top-up in production mode.
- [ ] Confirm top-up dialog shows admin-adjustment required while live payment is disabled.
- [ ] Confirm user/admin job cancel refunds reserved balance exactly once.
- [ ] Confirm worker receives job.
- [ ] Confirm progress appears in dashboard.
- [ ] Confirm report cannot be generated before the job is completed/failed/cancelled.
- [ ] Confirm final report appears.
- [ ] Confirm duplicate worker completion callbacks do not create duplicate wallet settlement.
- [ ] Confirm failed pairs refund correctly.
- [ ] Confirm raw cookies are not present in report, logs, or DB report JSON.
- [ ] Confirm expired `job_inputs.account_text` can be cleaned.

## 6. Do Not Enable Yet

- [ ] TrueMoney live voucher redemption.
- [ ] Public marketing launch.
- [ ] High worker concurrency.
