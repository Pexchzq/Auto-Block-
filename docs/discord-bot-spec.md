# Discord Bot Integration Spec

## เป้าหมาย

Discord bot เป็น UI รับงานอีกช่องทางหนึ่งของ BlockMesh และใช้ Supabase,
wallet ledger, worker queue และ report pipeline ชุดเดียวกับหน้าเว็บ

## User Flow

1. ผู้ดูแลใช้ `/panel` ติดตั้ง persistent control panel
2. ผู้ใช้ที่มี role ที่กำหนดกด `สร้างงาน`
3. Bot ส่ง DM preflight ถ้าส่งไม่ได้ให้หยุดทันที
4. Bot เปิด Modal ให้ใส่ลิงก์ไฟล์ `.txt` จาก Discord CDN
5. Bot ดาวน์โหลดไฟล์ทันทีและส่ง account text ไป Bot Web API ผ่าน HTTPS
6. Web สร้าง shadow Supabase identity และ job
7. Worker ประมวลผล FIFO ทีละหนึ่ง job
8. Bot edit ข้อความ DM เดิมทุกประมาณ 10 วินาที
9. เมื่อจบ Bot แนบ sanitized JSON report ใน DM

## Input Contract

- รับ URL ผ่าน Discord Modal ไม่รับ account text ตรงๆ
- URL ต้องใช้ HTTPS
- host ต้องเป็น `cdn.discordapp.com` หรือ `media.discordapp.net`
- path ต้องขึ้นต้น `/attachments/` และลงท้าย `.txt`
- ขนาดสูงสุด 2 MB
- timeout 15 วินาที
- ไม่ตาม redirect
- encoding ต้องเป็น UTF-8
- ห้าม log URL, account text, password, cookie, CSRF token

## Access

- บัญชีต้องเป็นสมาชิก `DISCORD_GUILD_ID`
- ต้องมี role อย่างน้อยหนึ่งตัวใน `DISCORD_ALLOWED_ROLE_IDS`
- DM ต้องเปิด
- `/panel` จำกัดด้วย Discord permission `ManageGuild`

## Bot API

- `POST /api/bot/jobs`
- `GET /api/bot/jobs?active=1`
- `GET /api/bot/jobs/:jobId`
- `GET /api/bot/jobs/:jobId/report`
- `GET /api/bot/users/:discordUserId`

ทุก route ใช้ `Authorization: Bearer BOT_API_TOKEN` ซึ่งต้องแยกจาก
`WORKER_API_TOKEN`

## Database

- `jobs.source`: `web | discord`
- `discord_identities.discord_user_id` map ไป `profiles.id`
- shadow account ใช้ synthetic email และ random password ที่ผู้ใช้ไม่ต้องรู้
- v1 ใช้ `BOT_FREE_MODE=true` เพื่อ credit wallet เฉพาะยอดที่จำเป็นสำหรับ job

## Worker Rule

worker ต้องรัน active job ได้ครั้งละหนึ่งงานเท่านั้น งานที่เหลือรอใน FIFO queue
เพราะหลาย CLI process บน public IP เดียวกันจะแย่ง rate-limit bucket

## Review Checklist

- ไม่มี secret ถูก log หรือแนบใน report
- URL allowlist และ no-redirect ทำงาน
- role gate กับ DM preflight ปฏิเสธงานจริงเมื่อไม่ผ่าน
- token ของ bot และ worker แยกกัน
- free mode เปิด/ปิดด้วย env
- bot restart แล้ว recover active job monitor ได้
- worker active concurrency เท่ากับ 1
- web flow เดิมยังใช้ shared job service ได้
