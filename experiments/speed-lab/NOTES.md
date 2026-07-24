# Speed Lab — หา throughput สูงสุด + จัดการ rate limit

โฟลเดอร์ทดลองแยก (isolated) ของ AI agent — ไม่ยุ่งกับ production ที่ root
reports/state/run-events จะถูกสร้างในโฟลเดอร์นี้เอง

## สมมติฐานหลัก (จากข้อมูลผู้ใช้)
- ผู้ใช้เคยรันหลายโฟลเดอร์/หลาย process พร้อมกันจาก **IP เดียว** ได้เร็วมาก
- เมื่อเจอ 429 มัน **กระจายเฉพาะบางบัญชี ไม่ใช่ทุกบัญชีพร้อมกัน**
- => rate limit ผูกกับ **บัญชี/คุกกี้ (per-account)** ไม่ใช่ per-IP
- => `GLOBAL_BLOCK_SLOT_CHAIN` (global gate) บีบทั้งระบบเป็นคิวเดียว = ผิดเป้า
  ควรปล่อยแต่ละ lane (source) วิ่งขนานเต็มสปีดของตัวเอง

## ตัวแปรที่คุมได้ (ผ่าน flag ไม่ต้องแก้โค้ด)
- `--global-block-delay 0 --global-block-delay-floor 0` = ปิด global gate
- `--account-concurrency N` (clamp 1..20)
- `--source-max-per-window N` (clamp 1..120) = โควตาต่อบัญชีต่อ 60s
- `--per-account-delay-min/max` = ระยะห่างต่อบัญชี
- `--target-cooldown` = กันยิงเป้าเดิมถี่เกิน

## แผนทดลอง (escalate ทีละขั้น)
| รอบ | global gate | conc | src/win | เป้าหมายวัด |
|---|---|---|---|---|
| E0 baseline | 470ms | 8 | 24 | ยืนยันเลขเดิม |
| E1 | ปิด (0) | 12 | 40 | ต่อบัญชีเร็วขึ้นแค่ไหนก่อนเจอ 429 |
| E2 | ปิด (0) | 20 | 60 | ดันขนานเต็มที่ |
| E3 | ปิด (0) | 20 | จูนตาม knee | หาจุด per-account ที่ 429 เริ่ม |

## เมตริกที่ดู (analyze.mjs)
- pairs/min รวม + ต่อนาที (เส้นแบนไหม)
- 429% รวม
- **การกระจาย 429 ต่อ source** = ยืนยัน per-account (กระจุกไม่กี่บัญชี) vs per-IP (กระจายเกือบทุกบัญชี)

## คำสั่งรัน (ตัวอย่าง)
```
node block-mesh.js apply --cookies cookies.txt --mode balanced \
  --allow-unverified-blocklist --skip-block-list-check \
  --global-block-delay 0 --global-block-delay-floor 0 \
  --account-concurrency 12 --source-max-per-window 40
node analyze.mjs
```

## บันทึกผล

### E1 (gate OFF, conc 12, src-max 40, penalty เดิม 20s) — 26 lanes, 650 pairs
- overall 93/min (ไม่เร็วขึ้น! gate-on ได้ ~115)
- 429 = 6.6%, กระจาย 25/26 sources **แต่ 20/32 เกิดในนาที 0 (burst)**
- avgLat ไต่ 1000→2362ms = lane cooldown 20s ต่อ 429 ฉุดหนัก
- **สรุป:** ปิด gate เฉยๆ ทำให้ burst ตอนเปิด → 429 หลายบัญชีพร้อมกัน แล้วโทษ 20s ฉุดยับ
  ตัวจำกัดจริง = **spacing/burst** ไม่ใช่ gate เอง

### สมมติฐานปรับใหม่
Roblox เบรกเมื่อ request **กระชั้นชิด** (ต่อบัญชี และ/หรือ ช่วงเวลาสั้น) การรันหลาย
process ที่ผู้ใช้เคยทำเร็วได้ เพราะแต่ละ process spaced ในตัว = แต่ละบัญชีถูกยิงห่างสม่ำเสมอ
=> ทางถูก: **ขนานหลาย lane + ยิงแต่ละบัญชีห่างพอ (ไม่ burst) + โทษ 429 เบา**

### E2 (gate OFF, conc 20, per-acct 1500-2500ms smooth, src-max 30, penalty 4s) — 26 lanes
- นาที 0: burst 118 req / 36×429 (bucket ดูดหมด) → นาที 1-8 นิ่งที่ ~80/min, 429 ต่ำ
- **สรุป:** 1 process มี burst allowance ~80-100 req แล้ว sustained ~80/min ไม่ว่าจูนยังไง

### E3 (DECISIVE: 2 process ขนาน คนละ 13 บัญชี, gate 470ms, จาก IP เดียว)
- 13 วิแรก: A 119 + B 125 = 244/min, 0 429  ← **หลอกตา (burst bucket ยังเต็ม)**
- ผลจบจริง: A 53/min 429=12.8% | B 55/min 429=12.8% | **รวม ~108/min = เท่า 1 process**
- ทั้ง A,B โดน 429 พร้อมกัน 13/13 sources → **bucket แชร์กันระดับ IP/global**

## ✅ ข้อสรุปสุดท้าย (ยืนยันด้วยข้อมูล)
- **มี shared IP/global limit จริง ~110-150/min** (burst ~80-100 req แล้ว refill ~110/min)
- **ไม่ใช่ per-account** (แต่ละบัญชี ~4/min ก็โดน 429)
- **หลาย process บน IP เดียว = ไม่ scale** (แชร์ bucket เดียว)
- **จะทะลุเพดาน → ต้องหลาย IP (proxy) เท่านั้น**
- ของฟรีบน 1 IP: โทษ 429 เดิม (20s lane cooldown) รุนแรงเกิน → collapse ต่ำกว่าเพดาน
  ควร pace เนียนที่ ~130/min + backoff เบา = ยืนใกล้เพดานนิ่งกว่า (E4)

### E4 (gate 450ms คงที่, conc 8, backoff เบา 3s, 26 บัญชี)
- 77/min · 429 = 2.9% (ต่ำสุดทุกรอบ) แต่ช้าเพราะ 26 lane เติม gate 450ms ไม่เต็ม

### ตารางสรุปทุกรอบ
| รอบ | config | บัญชี | ผล /min | 429% |
|---|---|---|---|---|
| prod | balanced 470→380 | 42 | **115** | 1.5% fail |
| E1 | gate off, conc12 | 26 | 85 | 5.4% |
| E2 | gate off smooth conc20 | 26 | 80 | steady low |
| E3 | 2×parallel gate470 | 13+13 | 108 รวม | 12.8% |
| E4 | gate450 backoff เบา | 26 | 77 | 2.9% |

## บทเรียนสุดท้าย
1. เพดาน 1 IP ≈ **115-130/min** (shared bucket) — แตะแล้วในโหมด balanced ปัจจุบัน
2. **throughput ขึ้นกับจำนวน lane ที่เติม gate ได้เต็ม** → บัญชียิ่งเยอะยิ่งเข้าใกล้เพดาน (42 บัญชี > 26)
3. หลาย process/IP เดียว ไม่ช่วย · **proxy หลาย IP = ทางเดียวทะลุ**
4. => สร้าง **proxy support** ใน production block-mesh.js แล้ว (`--proxies proxies.txt`)
   แต่ละบัญชี egress คนละ IP → แต่ละ IP มี bucket ~115/min ของตัวเอง = N เท่า
