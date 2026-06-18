# BlockMesh Web

Production-facing web control panel for BlockMesh. This web app does not run the long-running block engine directly. It provides quote, wallet top-up UI, job dashboard, and sanitized report views, then proxies to an external worker when `WORKER_API_BASE` is configured.

## Local

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

Requires Node.js 20.9+.

## Environment

```text
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_SITE_URL=https://your-domain.com
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WORKER_API_BASE=
WORKER_API_TOKEN=
PAYMENT_PROVIDER_MODE=placeholder
TRUEMONEY_API_BASE=
TRUEMONEY_API_TOKEN=
```

## Supabase Setup

1. Create a Supabase project.
2. Open the SQL Editor and run `supabase/schema.sql`.
3. Copy the project URL, anon key, and service role key into your hosting env.
4. Enable email/password auth in Supabase Auth for the first release.

When Supabase env vars are configured, wallet ledger, job drafts, confirmed jobs, and sanitized reports are stored in the database. Without these env vars, the app stays in local demo mode.

## Admin Account

After running `supabase/schema.sql`, create the first admin account from a local terminal:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
$env:ADMIN_EMAIL="admin@blockmesh.local"
$env:ADMIN_PASSWORD="your-admin-password"
npm run seed:admin
```

Then login on the website with that account and open `/admin`.

## Local BlockMesh Worker Bridge

For local testing on your own machine, set:

```text
BLOCKMESH_LOCAL_WORKER=1
BLOCKMESH_CLI_DIR=C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\release\BlockMeshCLI Sim
BLOCKMESH_EXE=C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\release\BlockMeshCLI Sim\blockmesh.exe
```

After a paid/confirmed job is reserved, the server writes a temporary `cookies.txt`, runs the local CLI, imports the sanitized report, refunds failed pairs, and deletes the temporary cookie file. Do not enable this on serverless hosting.

## Deploy

Deploy the `web/` folder to Vercel or another Next.js host and connect your own domain. Keep the BlockMesh worker separate from the frontend runtime.

Production checklist:

1. Set Supabase env vars in Vercel.
2. Set `NEXT_PUBLIC_SITE_URL` to the deployed HTTPS origin.
3. Set `WORKER_API_BASE` and `WORKER_API_TOKEN` when the external worker is ready.
4. Keep `PAYMENT_PROVIDER_MODE=placeholder` until TrueMoney live verification is implemented.
5. Run `npm run build` before deploy.
6. Run `npm run verify:production` from an environment that has the same production env vars.

Readiness check:

```powershell
npm run predeploy:check
npm run verify:production
```

`predeploy:check` runs the pure logic unit check, Supabase schema static check, lint, production build, worker syntax check, and worker self-test.

The script checks required env vars, Supabase tables, admin account presence, and worker health when `WORKER_API_BASE` is configured.

Generate strong deployment secrets:

```powershell
npm run generate:secrets
```

Use the same generated `WORKER_API_TOKEN` in Vercel and `worker/.env`.

Cleanup expired raw account inputs:

```powershell
npm run cleanup:expired-inputs
```

You can also run the cleanup from `/admin`. This clears expired `job_inputs.account_text` and writes an audit log entry.

## External Worker Contract

When a user confirms a job, the web API reserves wallet balance and sends this server-side request to the worker if `WORKER_API_BASE` is configured:

```http
POST {WORKER_API_BASE}/jobs
Authorization: Bearer {WORKER_API_TOKEN}
Content-Type: application/json
```

Body:

```json
{
  "jobId": "uuid",
  "userId": "uuid",
  "mode": "balanced",
  "accountCount": 50,
  "directedPairs": 2450,
  "pricePerPairBaht": 0.01,
  "accountText": "username:password:cookie...",
  "callbackUrl": "https://your-domain.com/api/worker/jobs/JOB_ID/complete"
}
```

The worker should not log cookies. It should store them only in an isolated temporary workspace and delete them after the run.

The included worker scaffold lives in `../worker`. Read `../worker/README.md` before exposing it publicly.

During execution, the worker can update progress:

```http
POST https://your-domain.com/api/worker/jobs/{jobId}/status
Authorization: Bearer {WORKER_API_TOKEN}
Content-Type: application/json
```

```json
{
  "status": "running",
  "workerRegion": "worker-1",
  "blocked": 120,
  "alreadyBlocked": 30,
  "failed": 2
}
```

When finished, the worker must send sanitized final results:

```http
POST https://your-domain.com/api/worker/jobs/{jobId}/complete
Authorization: Bearer {WORKER_API_TOKEN}
Content-Type: application/json
```

```json
{
  "status": "completed",
  "blocked": 2000,
  "alreadyBlocked": 400,
  "failed": 50,
  "report": {
    "durationMs": 1200000,
    "rateLimitCount": 4
  }
}
```

The web app calculates charged/refunded amounts from the final counters and writes a sanitized report. Reports must never include cookies, passwords, CSRF tokens, or raw worker logs.

## User Flow

1. User signs up or logs in.
2. User pastes account lines or enters account count.
3. User creates a draft and checks quote.
4. Admin adds test balance from `/admin` until live TrueMoney verification is connected.
5. User confirms the job; wallet balance is reserved.
6. Worker runs validate/plan/apply/retry/diagnose.
7. Worker posts status and final report.
8. User downloads sanitized report.
9. Failed final pairs are refunded automatically.

Account input format:

```text
username:password:_|WARNING:-DO-NOT-SHARE-THIS...
```

The server counts and validates account lines before draft/confirm. Validation errors only report line numbers and never echo cookies.

Set `JOB_INPUT_ENCRYPTION_KEY` in production to encrypt `job_inputs.account_text` at rest. `npm run verify:production` treats this as required. Local/demo mode can still run without it, but stored job input remains plaintext until cleanup and is not release-ready.

Queue safety:

```text
MAX_ACTIVE_JOBS_PER_USER=2
```

Users cannot confirm more queued/running/retrying jobs than this limit. Increase it only after the worker queue is stable.

`BLOCKMESH_LOCAL_WORKER=1` is only for local development. Do not enable it on Vercel or any production web deployment; production jobs must dispatch to an external worker through `WORKER_API_BASE`.

Payment safety:

```text
ALLOW_PLACEHOLDER_TOPUP=0
```

Keep placeholder self top-up disabled in production. Until live TrueMoney verification is connected, add balance through the admin dashboard only.

## Admin Console

Login with an admin account and open `/admin`.

The admin console currently supports:

- system metrics
- latest jobs
- queued/running job cancellation
- wallet total overview

The seed script creates or promotes the first admin:

```powershell
$env:ADMIN_EMAIL="admin@blockmesh.local"
$env:ADMIN_PASSWORD="your-admin-password"
npm run seed:admin
```

## TrueMoney Webhook Endpoint

After deploying your domain, register this endpoint in the TrueMoney dashboard:

```text
https://your-domain.com/api/payments/truemoney/webhook
```

Localhost URLs such as `http://127.0.0.1:3000` cannot receive real TrueMoney webhooks unless you expose them with a temporary tunnel such as ngrok or Cloudflare Tunnel.
