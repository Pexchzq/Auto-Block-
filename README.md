# BlockMesh

BlockMesh is a Roblox account block-mesh automation project with four parts:

1. `block-mesh.js` / portable CLI release for local batch blocking.
2. `web/` Next.js dashboard for users, wallet ledger, jobs, admin, and reports.
3. `worker/` external worker service that runs the CLI outside Vercel and reports results back to the web app.
4. `discord-bot/` role-gated Discord UI that creates jobs and sends progress/reports by DM.

TrueMoney live payment verification is intentionally not implemented yet. The current web payment flow uses placeholder top-up mode until after deployment.

## Current Production Shape

```text
User Browser
  -> Vercel Next.js web app
  -> Supabase Auth + Database
  -> External BlockMesh worker
  -> blockmesh.exe / CLI
  -> Worker callbacks to web app
  -> Supabase report + wallet refund/capture
```

Vercel provides the dashboard/API layer. Long-running BlockMesh jobs run on the external worker.

## Main Folders

```text
web/                  Production-facing Next.js app
worker/               External worker service
discord-bot/          Discord control panel and DM report process
release/              Portable CLI builds and test copies
block-mesh.js         CLI source
server.js             Old local-only web UI server
DEPLOYMENT_CHECKLIST.md
deploy-checklist.json
```

## Web App

See [web/README.md](web/README.md).

Features:

- Login-first Supabase auth
- wallet ledger
- placeholder top-up
- quote calculation
- job draft/confirm
- job history
- job cancel
- worker status/report callbacks
- admin dashboard
- production readiness endpoint

Useful commands:

```powershell
cd web
npm install
npm run lint
npm run build
npm run verify:production
```

## Worker

See [worker/README.md](worker/README.md).

Features:

- `POST /jobs`
- queue/concurrency
- temporary cookie workspace
- CLI process runner
- progress callback
- final report callback
- cancel endpoint
- health endpoint

Useful commands:

```powershell
cd worker
copy .env.example .env
notepad .env
npm run check
.\run-worker.bat
```

The worker is intentionally locked to one active CLI job at a time. Additional
jobs wait in a FIFO queue so multiple processes do not compete for the same
upstream rate-limit bucket.

## Discord Bot

See [discord-bot/README.md](discord-bot/README.md).

The bot accepts a Discord CDN `.txt` URL through a Modal, checks the configured
server role, requires an open DM, and edits one DM message until the sanitized
final report is ready.

## Deployment

Use [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) before opening the system to real users.

Minimum deployment steps:

1. Create Supabase project.
2. Run `web/supabase/schema.sql`.
3. Seed admin with `npm run seed:admin`.
4. Deploy `web/` to Vercel.
5. Start `worker/` on a long-running machine or VPS.
6. Set matching `WORKER_API_TOKEN` on both web and worker.
7. Run `npm run verify:production`.
8. Run a small end-to-end test job.

## Data Handling

- Worker writes cookies to temporary workspace files.
- Worker deletes temporary cookie files after each job.
- Reports pass through the report sanitizer.
- `WORKER_KEEP_WORKSPACES=0` enables production cleanup.
- Public workers support firewall and HTTPS reverse-proxy deployment.

## Payment Status

Current:

- `PAYMENT_PROVIDER_MODE=placeholder`
- valid-looking TrueMoney URLs credit test balance only
- wallet ledger and reserve/capture/refund are implemented

Not implemented yet:

- live TrueMoney voucher redemption
- production voucher signature verification
- real provider duplicate redemption checks

## Validation Status

Known validation commands:

```powershell
cd web
npm run lint
npm run build

cd ..\worker
npm run check
```

Production readiness:

```powershell
cd web
npm run verify:production
```

`verify:production` is expected to return `NOT READY` until real Supabase and worker environment variables are configured.
