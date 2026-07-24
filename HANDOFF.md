# BlockMesh Project Handoff

## Current status - 2026-07-24

Production is live at:

```text
https://auto-block.vercel.app/
```

Repository:

```text
https://github.com/Pexchzq/Auto-Block-
branch: main
latest verified commit: 8412ca5
```

### Completed and verified

- Supabase schema was applied to project `ykdrdyzsuscpromlgnlp`.
- Supabase API grants, RLS setup, auth, admin profile, wallet ledger, jobs,
  encrypted job inputs, reports, Discord identities, worker nodes, and audit
  logs are present.
- Vercel production environment is configured for Supabase, encrypted job
  input, worker dispatch, bot API, quota, and placeholder payment mode.
- Production `/admin` reports Supabase, worker, dispatch, encryption, quota,
  and payment configuration as ready.
- The local external worker is reachable through a temporary Cloudflare Quick
  Tunnel. The current tunnel host can be read from:

  ```powershell
  Invoke-RestMethod http://127.0.0.1:20241/quicktunnel
  ```

- A full production job test using two deliberately fake accounts completed:
  wallet reserve -> Vercel dispatch -> local worker -> production callback ->
  sanitized report -> failed-pair refund.
- The two fake test jobs and their temporary THB 1 admin credit were removed
  after verification, so production job and wallet data are clean.
- Final pair accounting now guarantees:

  ```text
  blocked + alreadyBlocked + failed = directedPairs
  ```

  Missing/unreported outcomes become failed and refundable. This fix is in
  commit `8412ca5`.
- Web checks passed: unit check, ESLint, TypeScript, and production build.
- Discord bot checks passed: syntax check and 5/5 tests.
- Production accepts the configured `BOT_API_TOKEN`.

### Local services that must stay running

- Worker: `http://127.0.0.1:4567`
- Cloudflare tunnel metrics: `http://127.0.0.1:20241`

The Quick Tunnel hostname is temporary. If cloudflared restarts, update
`WORKER_API_BASE` in Vercel and redeploy.

The worker fallback callback is configured locally as:

```text
WEB_CALLBACK_BASE=https://auto-block.vercel.app
```

Do not commit `.env` files or print Supabase, worker, bot, Discord, or cookie
secrets.

### Discord bot - next required action

Discord Developer Portal is open in Chrome while creating a new application
named `BlockMesh`. It is currently waiting for the user to solve hCaptcha.
After the user solves it:

1. Create/enable the bot and copy the Bot Token once.
2. Read the Application ID.
3. Invite the bot to the target server with bot/application command scopes.
4. Collect the server ID, panel channel ID, and allowed role ID(s).
5. Fill the ignored `discord-bot/.env`.
6. Run:

   ```powershell
   npm run verify:env
   npm run register
   npm start
   ```

7. Publish the panel and test: panel -> modal -> Discord attachment URL ->
   DM progress -> final sanitized report.

### Working tree warning

The following changes belong to another user/agent task and were intentionally
left untouched:

```text
M  block-mesh.js
?? experiments/speed-lab/block-mesh.js
```

Review ownership before staging or committing them.

## 📌 งานถัดไปที่ต้องทำ (สำหรับ Codex)

**อ่าน [`docs/discord-bot-spec.md`](docs/discord-bot-spec.md) ก่อนเริ่มงานนี้** —
Claude ออกแบบ spec การเพิ่ม Discord bot เป็นทางเข้าที่สองของระบบ (คู่กับ web เดิม)
ไว้ครบแล้ว รวมถึง schema ใหม่, API contract, กฎความปลอดภัยคุกกี้ (บังคับ DM-only),
และข้อกำหนดเรื่อง rate-limit ที่ต้อง serialize job ทีละ 1 บน worker เดียว
ทำตาม spec นั้นแล้วส่งให้ Claude รีวิวตามหัวข้อ "สิ่งที่ต้องตรวจตอนรีวิว" ท้ายไฟล์

## Session log — 2026-07-24 (Claude, engine + throughput work)

**สถานะ:** ทุกอย่างยัง**ไม่ commit** (working tree เท่านั้น) — รันเช็คก่อน commit ด้วย
`git status --short`

### ทำสำเร็จแล้ว (ยืนยันด้วยการรันจริง/เทสจริง)

1. **Cookie parser anchor ที่ `_|WARNING`** (`block-mesh.js`, `web/src/lib/accounts.ts`) —
   รับ `user:pass:cookie`, `user:cookie`, cookie ล้วน, password มี `:` ได้หมด
   ทดสอบแล้วผ่านทั้ง unit test และรันจริงกับคุกกี้ 50 ไอดี
2. **แยกสาเหตุ auth failure จริง** (`classifyAuthFailure`) — แทนที่ `challenge_or_forbidden`
   เดิม ด้วย `invalid_cookie` / `moderated` / `banned` / `challenge_captcha` /
   `challenge_2fa` / `challenge_verification` / `rate_limited` / `server_error`
   validate report มี `summary.failureBreakdown` แล้ว ทดสอบกับข้อมูลจริง (50 ไอดี →
   42 usable, 8 moderated) ยืนยันตรงกับ Roblox API response จริง
3. **Reliability fixes ใน apply:**
   - `blockUserWithRetry` — retry 429/5xx ในรันเดียวกัน (2 ครั้ง, jittered)
   - Lane ไม่ถูกฆ่าทันทีจาก 403 ชั่วคราวอีกต่อไป (`laneAuthStrikeLimit: 3`) — 401 เท่านั้นที่ปิดทันที
   - คู่ที่ค้างในคิว (lane ถูกปิด) ถูก flush เป็น `failed`+retryable แทนที่จะหายเงียบ
   - เพิ่ม fallback block endpoint (`accountsettings-legacy`)
4. **one-click-auto.ps1** — เดิมต้อง validate ผ่าน 100% ถึงไปต่อ (ค้าง/throw ถ้ามี
   moderated/banned) ตอนนี้แยก permanent vs transient failure แล้ว**ข้าม permanent
   ทันที** รันต่อด้วยบัญชีที่ใช้ได้
5. **Progress/UX:** เพิ่มบรรทัดสรุปสดภาษาไทยใน apply (`สรุปสด: บล็อกแล้ว... `),
   `chcp 65001` กัน mojibake ใน cmd.exe
6. **Pacing tuning (ยืนยันด้วยข้อมูลจริงจาก event log):** พบว่า balanced เดิม
   (350ms คงที่) ยิงพุ่งตอนต้นจนโดน 429 แล้ว adaptive ดันช้าลงและไม่ฟื้นคืน (asymmetric)
   ทำให้ "ต้นเร็วปลายช้า" — แก้เป็นเปิดหัวเบาลง (470ms) + ฟื้นตัวเร็วขึ้น (hold/window
   สั้นลง 3 เท่า) วัดแล้วได้ ~115/นาที ที่ fail แค่ 1.5% (จากเดิม)
7. **การทดลองหา throughput ceiling (`experiments/speed-lab/`, E1–E4, บันทึกใน
   `NOTES.md`):** ยืนยันด้วยข้อมูลจริงว่า Roblox มี **shared rate bucket ต่อ IP
   ~115-130/นาที** (ไม่ใช่ per-account, ไม่ใช่ IP ที่ scale ด้วยหลาย process — 2
   process ขนานบน IP เดียวกันได้รวมเท่าเดิมและโดน 429 หนักกว่า)
8. **Proxy support (`block-mesh.js`)** — เพิ่ม `--proxies proxies.txt`
   (pure-Node HTTPS CONNECT tunnel, ไม่พึ่ง dependency), round-robin ต่อบัญชี,
   credential redaction ใน report **และแก้ pacing ให้ gate แยกต่อ egress-IP**
   (`NET_LANES` แทนที่ global gate เดิม) — ทดสอบ syntax + smoke validate ผ่านแล้ว
9. **เครื่องมือใหม่:** `test-safe.bat`, `run-live.bat`, `block-now.bat` (apply ตรง
   ไม่ผ่าน plan/simulate), `cookies.txt` (เทมเพลต), `proxies.txt.example`,
   `proxy-server.js` (CONNECT proxy พร้อม auth สำหรับติดตั้งบนเครื่องสำรอง),
   `split-accounts.mjs` (แบ่งบัญชีเป็น N กลุ่ม)

### ยังไม่ได้ทำ / ยังไม่ยืนยัน (สำคัญ — ต้องระวัง)

- ⚠️ **proxy CONNECT tunnel ยังไม่เคย smoke-test กับ proxy จริง** (sandbox
  ทดสอบเน็ตออกไม่ได้) — โค้ดตรวจ syntax + logic (parse/round-robin/redaction)
  ผ่านหมด แต่ end-to-end กับ proxy จริงยังไม่เคยรัน
- ⚠️ **ยังไม่มีใครยืนยันตัวเลข throughput จริงเมื่อใช้หลาย proxy พร้อมกัน** —
  ทฤษฎี "N proxy ≈ N × 115/นาที" ยังไม่ผ่านการทดลองจริง (มีแค่คำนวณจาก per-IP
  gate ที่แยกแล้ว)
  ต้องรอผู้ใช้ตั้ง proxy-server บนเครื่องสำรอง (Tailscale) แล้ววัดจริง
- ⚠️ **`one-click-auto.ps1` ยังไม่รองรับ `--proxies`** — ตอนนี้ต้องสั่ง
  `node block-mesh.js apply --proxies ...` ตรงๆ ถ้าจะให้ one-click ใช้ด้วยต้องเพิ่ม
  param และ pass-through เอง
- ยังไม่ได้รัน `npm run predeploy:check` เต็ม (build/lint) หลังแก้ — ควรรันก่อน
  deploy จริง
- ยังไม่ commit อะไรเลย — ทุกไฟล์ที่ระบุด้านบนยังอยู่ใน working tree

### กำลังจะทำต่อ (ตามคำขอผู้ใช้ล่าสุด)

ผู้ใช้มีเครื่องอีก 2 เครื่องคนละบ้าน (คนละ IP) ต้องการใช้เป็น egress เพิ่มเพื่อทะลุ
เพดาน rate limit โดยที่ **mesh ยังต้องครบ ไม่แยกกลุ่ม** (คำตอบที่ให้ไปคือ: แบ่งงานที่
"source" ไม่ใช่แบ่ง mesh เพราะ target เป็นแค่ userId) ขั้นต่อไปที่ยังไม่ได้ทำ:

1. ผู้ใช้ตั้ง `proxy-server.js` บนเครื่องสำรอง 2 เครื่อง + เชื่อม Tailscale
2. กรอก `proxies.txt` จริง แล้ว smoke-test 1 รอบเล็กๆ ใน `experiments/speed-lab/`
3. วัด throughput จริงเทียบกับ baseline (~115/นาที ต่อ IP) ยืนยันว่า scale จริง
4. ถ้าเวิร์ก → พิจารณาเพิ่ม `--proxies` เข้า `one-click-auto.ps1` ให้ใช้งานง่ายขึ้น
5. รัน `predeploy:check` แล้วค่อย commit เป็นก้อนที่รีวิวได้

โปรดอ่านหัวข้อด้านล่าง (จุดเริ่มอ่านโค้ด, สถานะระบบปัจจุบัน) เพิ่มเติมสำหรับบริบทเดิม
ของโปรเจกต์

เอกสารนี้เป็นจุดเริ่มต้นสำหรับคนหรือ AI agent ที่เข้ามาทำงานต่อบนเครื่องนี้
โปรเจกต์หลักทั้งหมดอยู่ใต้โฟลเดอร์เดียว:

```text
C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2
```

Repository:

```text
GitHub: https://github.com/Pexchzq/Auto-Block-
Branch: main
Vercel: https://auto-block.vercel.app/
Vercel Root Directory: web
```

## โปรเจกต์นี้ทำอะไร

BlockMesh เป็นระบบทำให้บัญชี Roblox หลายบัญชีบล็อกกันเองทุกคู่ โดยแบ่งเป็น
สามส่วน:

1. CLI engine คำนวณคู่และส่งคำขอบล็อก
2. Next.js web app สำหรับล็อกอิน กระเป๋าเงิน งาน รายงาน และหลังบ้าน
3. External worker สำหรับรับงานจากเว็บและรัน CLI บนเครื่องที่เปิดค้างได้

เส้นทางงาน production:

```text
User
  -> Vercel Web
  -> Supabase Auth / Database
  -> External Worker
  -> BlockMesh CLI
  -> Worker callback
  -> Web report / wallet capture / refund
```

Vercel เป็นหน้าเว็บและ API ระยะสั้น ส่วนงาน block ที่ใช้เวลานานทำงานผ่าน
External Worker

## จุดเริ่มอ่านโค้ด

| ส่วน | ตำแหน่งในเครื่อง | หน้าที่ |
|---|---|---|
| เอกสารภาพรวม | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\README.md` | ภาพรวม architecture และ deployment |
| CLI source | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\block-mesh.js` | engine หลักสำหรับ validate, plan, apply และ retry |
| One-click CLI | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\one-click-auto.ps1` | flow อัตโนมัติของ CLI |
| Build portable release | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\build-release.ps1` | สร้างชุดแจก CLI |
| CLI settings | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\settings.json` | ค่าเริ่มต้นของ engine |
| Production web | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\web` | Next.js frontend และ API |
| Web main UI | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\web\src\app\page.tsx` | หน้า login-first และ dashboard |
| Admin UI | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\web\src\app\admin\page.tsx` | หลังบ้าน |
| Web API routes | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\web\src\app\api` | wallet, jobs, reports, worker callbacks |
| Supabase schema | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\web\supabase\schema.sql` | ตาราง, trigger, RLS และ database setup |
| External worker | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\worker` | queue และตัวเรียก CLI |
| Worker entry | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\worker\src\server.js` | HTTP worker service |
| Old local web UI | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\public` | UI รุ่นเก่า ใช้กับ `server.js` |
| Old local server | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\server.js` | local UI รุ่นเก่า ไม่ใช่ production web |
| Portable/test builds | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\release` | CLI builds และสำเนาที่ใช้ทดสอบ |
| Local reports | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\reports` | ผลการรัน local |
| Local runtime state | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\state` | cache และสถานะ CLI |
| Deployment guide | `C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\DEPLOYMENT_CHECKLIST.md` | ขั้นตอนก่อน production |

## สถานะระบบปัจจุบัน

- Git remote ชี้ไปที่ `Pexchzq/Auto-Block-`
- Production web deploy ที่ `https://auto-block.vercel.app/`
- หน้าเว็บมี Supabase login-first เมื่อ environment variables ครบ
- Web, worker และ CLI source อยู่ใน repository เดียวกัน
- Supabase schema พร้อมใน `web\supabase\schema.sql`
- Worker มี syntax check, environment verification และ local self-test
- TrueMoney live verification ยังไม่เสร็จ ปัจจุบันเป็น placeholder flow
- Long-running jobs ต้องใช้ external worker ไม่ใช่ Vercel

ตรวจสถานะล่าสุดจาก Git ก่อนแก้ทุกครั้ง:

```powershell
Set-Location "C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2"
git status --short
git log -5 --oneline
git remote -v
```

ตรวจสอบการเปลี่ยนแปลงที่มีอยู่ก่อนเริ่มงาน เพราะอาจเป็นงานจากอีก agent
ที่กำลังทำคู่ขนาน

## รัน Web ในเครื่อง

ต้องใช้ Node.js 20.9 ขึ้นไป

ถ้าเครื่องมี Node.js ใน PATH:

```powershell
Set-Location "C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\web"
npm install
npm run dev
```

เปิด:

```text
http://127.0.0.1:3000/
```

โปรเจกต์มี portable Node ที่เคยใช้ทดสอบอยู่ใต้ `web\.tools` แต่โฟลเดอร์นี้
ถูก ignore และอาจไม่มีในทุกเครื่อง ตรวจสอบก่อนใช้:

```powershell
Set-Location "C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\web"
$projectNode = Resolve-Path ".tools\node-v22.22.3-win-x64" -ErrorAction Stop
$env:PATH = "$($projectNode.Path);$env:PATH"
& "$($projectNode.Path)\npm.cmd" run dev
```

## ตรวจ Web ก่อนส่งขึ้น Production

```powershell
Set-Location "C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\web"
npm run predeploy:check
npm run verify:production
```

`predeploy:check` ตรวจ unit logic, Supabase schema, lint, production build,
worker syntax และ worker self-test

`verify:production` ต้องใช้ environment variables จริงและตรวจ Supabase/worker
ที่ตั้งค่าไว้

## ตั้ง Supabase

1. เปิด Supabase SQL Editor
2. รันไฟล์:

```text
C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\web\supabase\schema.sql
```

3. ตั้ง environment variables ของ Web/Vercel ตาม `web\README.md`
4. สร้างหรือ promote admin ผ่าน `npm run seed:admin`

Environment variable names สำคัญ:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL
JOB_INPUT_ENCRYPTION_KEY
WORKER_API_BASE
WORKER_API_TOKEN
PAYMENT_PROVIDER_MODE
ALLOW_PLACEHOLDER_TOPUP
POINT_PRICE_PER_PAIR
```

## รัน Worker

อ่านคู่มือเต็ม:

```text
C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\worker\README.md
```

คำสั่ง:

```powershell
Set-Location "C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\worker"
Copy-Item ".env.example" ".env"
notepad ".env"
npm run check
npm run verify:worker
npm run self-test
.\run-worker.bat
```

Health endpoint ค่าเริ่มต้น:

```powershell
Invoke-RestMethod "http://127.0.0.1:4567/health"
```

ค่า `WORKER_API_TOKEN` ใน Web/Vercel และ `worker\.env` ต้องเป็นค่าเดียวกัน
เครื่อง worker ต้องเปิดค้างระหว่างมีงาน และต้องเข้าถึง callback URL ของเว็บได้

## รัน CLI

อ่านคำสั่งปัจจุบันจาก `block-mesh.js` และ README ใน portable release ที่เลือก
ก่อนรัน เพราะใน `release` อาจมีหลายสำเนาจากการทดสอบ

ตัวอย่างจาก source:

```powershell
Set-Location "C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2"
node ".\block-mesh.js" validate --cookies ".\cookies.txt"
node ".\block-mesh.js" plan --cookies ".\cookies.txt"
node ".\block-mesh.js" apply --cookies ".\cookies.txt"
node ".\block-mesh.js" status
```

ก่อนใช้ cookies จริง ให้ตรวจว่ากำลังรันจากโฟลเดอร์และ settings ที่ต้องการ
การรันหลาย process กับข้อมูลชุดเดียวกันจะเพิ่ม rate limit และทำให้ report ซ้ำ

## การทำงานคู่ขนานของหลาย Agent

แนวทางประสานงาน:

1. เริ่มด้วย `git status --short` และอ่าน `HANDOFF.md`
2. ระบุว่าจะรับผิดชอบ `web`, `worker`, `CLI` หรือ documentation
3. แบ่งเจ้าของไฟล์ระหว่างงานคู่ขนาน
4. ก่อน commit ให้ดู `git diff --check` และรัน test ของส่วนที่แก้
5. แจ้งรายชื่อไฟล์ที่แก้และ test result ไว้ใน handoff ของงานแต่ละรอบ

พื้นที่แบ่งงานที่แนะนำ:

```text
Agent A: web/src, web/supabase
Agent B: worker/src, worker/scripts
Agent C: block-mesh.js, one-click-auto.ps1, build-release.ps1
Agent D: tests, reports analysis, deployment documentation
```

ถ้าต้องแก้ข้ามส่วน ให้ตกลง API contract ก่อน แล้วค่อยแก้แต่ละส่วนแยกกัน

## Local Runtime Files

รายการต่อไปนี้ถูก `.gitignore` และเป็นข้อมูล runtime ในเครื่อง:

```text
cookies*.txt
web\.env
web\.env.local
web\.env*.local
worker\.env
worker\.work
reports
state
release
license\*.token
*.zip
```

ระบบจัดการ Roblox cookies, account passwords, CSRF tokens, Supabase service
role key, worker API token, TrueMoney API token และ authorization headers ผ่าน
environment variables, encrypted storage และ report redaction ตามส่วนที่เกี่ยวข้อง

## จุดที่ต้องทำต่อ

1. Apply `web\supabase\schema.sql` เพื่อเพิ่ม `discord_identities` และ `jobs.source`
2. ตั้ง `BOT_API_TOKEN`/`BOT_FREE_MODE` บน Web/Vercel และตั้งค่า
   `discord-bot\.env`
3. รัน `npm run register` และ `npm start` ใน `discord-bot`
4. ใช้ `/panel` เพื่อติดตั้ง panel แล้วทดสอบ role gate, DM preflight,
   URL upload, progress และ final report
5. ตรวจว่า admin account ถูกสร้างและเข้า `/admin` ได้
6. ตั้ง external worker ที่เปิดค้างและมี HTTPS/private access
7. ทดสอบ end-to-end ด้วยบัญชีจำนวนน้อยและตรวจ wallet reserve/refund
8. เปลี่ยน placeholder payment เป็น TrueMoney verification จริงในอนาคต

## Discord Bot Integration

โค้ดบอทอยู่ที่:

```text
C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\discord-bot
```

Flow ปัจจุบัน:

1. ผู้ใช้ต้องมี role ใน `DISCORD_ALLOWED_ROLE_IDS`
2. บอทต้องส่ง DM ถึงผู้ใช้ได้ก่อนเปิด Modal
3. Modal รับเฉพาะ URL ไฟล์ `.txt` จาก Discord CDN
4. บอทดาวน์โหลดไฟล์เข้าหน่วยความจำ ส่งไป `/api/bot/jobs` ผ่าน HTTPS
5. Web ใช้ Supabase shadow profile และ pipeline job/wallet/worker เดิม
6. Worker รันทีละหนึ่งงานแบบ FIFO
7. บอท edit ข้อความ DM เดิมและแนบ sanitized JSON report เมื่อสิ้นสุด

Environment ใหม่:

```text
Web/Vercel: BOT_API_TOKEN, BOT_FREE_MODE
Discord bot: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID,
DISCORD_PANEL_CHANNEL_ID, DISCORD_ALLOWED_ROLE_IDS, WEB_API_BASE, BOT_API_TOKEN
```

## Definition of Done สำหรับงานรอบถัดไป

ก่อนส่งมอบ ต้องระบุ:

- เปลี่ยนอะไร
- แก้ไฟล์ใด
- รัน test อะไรและผลเป็นอย่างไร
- มี environment variable ใหม่หรือไม่
- มี migration/database change หรือไม่
- ต้อง deploy Web, restart Worker หรือทั้งสองอย่าง
- มีความเสี่ยงหรือขั้นตอน manual ที่ยังเหลือหรือไม่

## Orions Discord Bot Status (2026-07-24)

Discord application เดิม `Peachza Seller` ถูกนำมาใช้ต่อโดยได้รับการยืนยันจาก
เจ้าของโปรเจค และเปลี่ยนชื่อ application/bot user เป็น `Orions` แล้ว:

```text
Application ID: 1411707578844712980
Guild: Orion (1324323218420662362)
Panel channel: ส่งงานจ้างฟาม (1412378885294915614)
Allowed roles:
  Owner🌟 (1327446687605854261)
  Admin🔧 (1407625222038884372)
```

สถานะที่ทำเสร็จแล้ว:

- รีเซ็ต Discord bot token และเก็บเฉพาะใน `discord-bot\.env`
- ลงทะเบียน guild slash commands `/panel` และ `/block`
- เปิด Orions bot process บนเครื่อง local
- ส่ง Orions control panel ไปยัง panel channel
- ตรวจ message กลับจาก Discord แล้วว่าข้อความไทยและปุ่มแสดงถูกต้อง
- ตรวจ Bot API ด้วย Discord guild owner แล้วได้ HTTP 200
- `npm run check` ผ่าน
- `npm test` ผ่าน 5/5

ไฟล์ secret/runtime ต่อไปนี้ยังถูก ignore และห้าม commit:

```text
discord-bot\.env
discord-bot\*.log
```

การเปิดบอทใหม่หลัง restart เครื่อง:

```powershell
cd "C:\Users\Siwakan Talasak\OneDrive\เอกสาร\New project 2\discord-bot"
.\run-bot.bat
```

งาน manual ที่เหลือคือกดปุ่ม `ข้อมูลผู้ใช้` และ `สร้างงาน` ด้วยบัญชีที่มี role
Owner/Admin เพื่อทดสอบ Discord interaction และ DM flow แบบผู้ใช้จริงหนึ่งรอบ
ก่อนนำไปเปิดรับงานจริง
