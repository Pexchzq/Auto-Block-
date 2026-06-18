# BlockMesh Worker

External worker service for BlockMesh Web. Vercel should not run long BlockMesh jobs directly; this process runs on your own Windows VPS, desktop, or controlled server.

## What It Does

1. Receives a confirmed job from the web app at `POST /jobs`.
2. Writes the submitted account text to an isolated temporary `cookies.txt`.
3. Runs `blockmesh.exe apply`.
4. Sends progress to the web app:
   - `POST /api/worker/jobs/{jobId}/status`
5. Sends final sanitized results to the web app:
   - `POST /api/worker/jobs/{jobId}/complete`
6. Deletes the temporary cookie file.

The worker never sends raw cookies back to the web app in reports. The callback report should contain only counters, timing, and sanitized diagnostics. Secret-looking report keys such as `cookie`, `password`, `token`, `csrf`, and `authorization` are redacted before callback, and the web callback sanitizes again before writing the report.

## Setup

Requires Node.js 20.9+.

```powershell
cd worker
copy .env.example .env
notepad .env
npm run check
npm run verify:worker
.\run-worker.bat
```

The worker has no npm package dependencies. It loads `worker/.env` by itself, so `dotenv` is not required. `npm run check` only validates JavaScript syntax. `npm run verify:worker` checks production env readiness, token length, callback URL, CLI path, workspace write access, and cleanup settings.

Run the local contract self-test before connecting production:

```powershell
npm run self-test
```

The self-test starts a temporary worker, uses a fake CLI, receives status/complete callbacks, and verifies the final counters. It does not contact Roblox and does not need real cookies.

## Required Environment

```text
PORT=4567
WORKER_API_TOKEN=replace-with-long-random-secret
WEB_CALLBACK_BASE=https://your-domain.com
BLOCKMESH_EXE=C:\BlockMeshCLI\blockmesh.exe
# Optional test/debug only. Leave empty in production.
BLOCKMESH_SCRIPT=
WORKER_WORKSPACE=C:\BlockMeshWorker\.work
WORKER_CONCURRENCY=1
WORKER_STATUS_INTERVAL_MS=10000
WORKER_KEEP_WORKSPACES=0
```

Use the same `WORKER_API_TOKEN` in the web app and worker.

Web app env:

```text
WORKER_API_BASE=http://your-worker-host:4567
WORKER_API_TOKEN=replace-with-long-random-secret
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

## API

### Health

```http
GET /health
```

No auth required. Returns active job count, queue depth, and known job count.

### Create Job

```http
POST /jobs
Authorization: Bearer {WORKER_API_TOKEN}
Content-Type: application/json
```

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

### Check Job

```http
GET /jobs/{jobId}
Authorization: Bearer {WORKER_API_TOKEN}
```

### Cancel Job

```http
POST /jobs/{jobId}/cancel
Authorization: Bearer {WORKER_API_TOKEN}
```

Queued jobs are cancelled immediately. Running jobs are terminated and reported back as cancelled.

## Deployment Notes

- Run this on a normal long-running Node host, not Vercel serverless.
- Start with `WORKER_CONCURRENCY=1`.
- Put the worker behind a firewall or private network if possible.
- Use HTTPS if the worker is public.
- Keep `WORKER_API_TOKEN` long, random, and identical to the web app token.
- Never log the raw request body.
- Keep `WORKER_KEEP_WORKSPACES=0` in production.
- Monitor `.work` disk usage if you enable debug workspaces.

## Local Smoke Test

Start the worker:

```powershell
npm start
```

Check health:

```powershell
Invoke-RestMethod http://127.0.0.1:4567/health
```

The full job flow should be tested from the web app after Supabase env and `WORKER_API_BASE` are configured.
