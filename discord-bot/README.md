# BlockMesh Discord Bot

บอท Discord เป็นทางเข้ารับงานอีกช่องทางของระบบ BlockMesh เดิม งานยังถูกเก็บใน
Supabase และส่งไป external worker ตัวเดียวกับหน้าเว็บ

## การทำงาน

1. ผู้ดูแลใช้ `/panel` เพื่อติดตั้ง control panel ในห้องที่กำหนด
2. ผู้ใช้ที่มี role ที่อนุญาตกด `สร้างงาน`
3. บอททดสอบว่าส่ง DM ถึงผู้ใช้ได้ แล้วเปิด Modal
4. ผู้ใช้วางลิงก์ไฟล์ `.txt` จาก Discord CDN
5. บอทดาวน์โหลดไฟล์เข้าหน่วยความจำ ส่งข้อมูลไป Web API ผ่าน HTTPS แล้วทิ้งข้อมูล
6. worker รับงานตามคิวทีละหนึ่งงาน
7. บอทแก้ไขข้อความ DM เดิมเพื่อแสดง progress และแนบ JSON report เมื่อเสร็จ

รองรับเฉพาะลิงก์ `https://cdn.discordapp.com/attachments/...` และ
`https://media.discordapp.net/attachments/...` ขนาดไม่เกิน 2 MB โดยไม่ตาม redirect
ไป host อื่น

## 1. สร้าง Discord application

1. เปิด Discord Developer Portal แล้วสร้าง application และ bot
2. คัดลอก Bot Token และ Application ID
3. เปิด OAuth2 URL Generator
4. เลือก scopes `bot` และ `applications.commands`
5. ให้สิทธิ์ `Send Messages`, `Embed Links`, `Attach Files`,
   `Read Message History` และ `Use Application Commands`
6. เชิญ bot เข้า server
7. สร้าง role สำหรับผู้มีสิทธิ์ใช้งาน แล้วคัดลอก Role ID

## 2. ตั้งค่า Web/Vercel

เพิ่ม environment variables ใน web deployment:

```env
BOT_API_TOKEN=สร้าง-random-secret-อย่างน้อย-32-ตัวอักษร
BOT_FREE_MODE=true
```

`BOT_API_TOKEN` ต้องไม่ซ้ำกับ `WORKER_API_TOKEN`

รัน SQL ล่าสุดจาก `web/supabase/schema.sql` ใน Supabase SQL Editor เพื่อเพิ่ม
`discord_identities` และ `jobs.source`

## 3. ตั้งค่าบอท

```powershell
Copy-Item .env.example .env
notepad .env
npm install
npm run verify:env
npm run register
npm start
```

ค่าที่ต้องใส่ใน `discord-bot/.env`:

```env
DISCORD_BOT_TOKEN=Bot Token
DISCORD_CLIENT_ID=Application ID
DISCORD_GUILD_ID=Server ID
DISCORD_PANEL_CHANNEL_ID=Channel ID
DISCORD_ALLOWED_ROLE_IDS=Role ID หนึ่งตัวหรือหลายตัวคั่นด้วย comma
WEB_API_BASE=https://โดเมนเว็บจริง
BOT_API_TOKEN=ค่าเดียวกับบน Vercel
```

หลัง `npm run register` คำสั่งแบบ guild จะปรากฏเกือบทันที จากนั้นรัน
`npm start` และใช้ `/panel` ใน Discord

## คำสั่ง

- `/panel` ติดตั้ง control panel ต้องมีสิทธิ์ Manage Server
- `/block submit` เปิดฟอร์มสร้างงาน
- `/block status job_id:<id>` ดูสถานะงานของตัวเอง
- `/block wallet` ดูข้อมูลผู้ใช้และงานล่าสุด

## การรันระยะยาว

รันบอทบนเครื่องหรือ VPS ที่เปิดตลอดเวลา เช่น PM2:

```powershell
npm install -g pm2
pm2 start src/index.mjs --name blockmesh-discord
pm2 save
```

ห้าม commit `.env`, bot token, API token หรือไฟล์บัญชีเข้า Git
