# แผนงานต่อ — เขียนไว้บอกตัวเองวันพรุ่งนี้

อัปเดตล่าสุด: 2026-07-26 (หลัง merge PR #29 เข้า main แล้ว, commit ล่าสุด `326bc59`)

## แผนงาน 5 เฟส (ตกลงกันแล้ว 2026-07-26)

1. **Quick Wins & Cleanup** — ✅ เสร็จแล้ว (ลบ `test:api`, `npm audit fix` ส่วนไม่ breaking, build ผ่าน)
2. **Production Verification** — ✅ เสร็จแล้ว (2026-07-26, Render live บน commit `326bc59`, deploy 19:36 น. เขียว)
3. **Foundational Safety Net** — ✅ เสร็จแล้ว (2026-07-26): CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml): frontend build + backend smoke test บน MySQL service container), smoke test ([`backend/tests/smokeTest.js`](../backend/tests/smokeTest.js): login → checkout ถูกบล็อกตอนไม่มีกะเปิด → เปิดกะ → checkout ผ่าน → ปิดกะ — รันจริงกับ DB จริงแล้วผ่านหมด), schema.sql รวม ([`backend/schema.sql`](../backend/schema.sql): ดึงจาก dev DB ที่รัน initDB() ครบแล้วจริง ไม่ได้ก็อปจากโค้ดมือ, verify แล้วว่าโหลดเข้า DB เปล่าได้สะอาด)
   - ระหว่างทางเจอของแถม 3 อย่าง แก้ไปด้วย: (1) ลบ endpoint `/api/init-db` ที่ตายแล้วใน server.js — schema เก่ามาก ขาดคอลัมน์ที่โค้ดปัจจุบันใช้จริง (เช่น `must_change_password`) ไม่มีใน docs ไหนอ้างถึงเลย ใช้แค่ `/api/create-admin` เท่านั้นตาม docs/DEPLOY.md; (2) local dev DB มีตาราง `members` ค้างอยู่จาก endpoint เก่านั้น ไม่ใช่ schema จริง ลบทิ้งได้ (0 แถว); (3) db.js มี ALTER TABLE `products.is_expired` ที่ fail เงียบๆ ทุก boot มาตลอด (MySQL ห้ามใช้ CURDATE() ใน generated column) ลบทิ้งแล้ว ไม่กระทบฟีเจอร์จริงเพราะ expiry_status คำนวณแยกด้วย SQL CASE ที่อื่นอยู่แล้ว; แถมแก้ audit_logs index-ALTER ที่ log warning ผิดทุก boot ด้วย (เช็ค error code ผิดตัว)
4. **Feature Completion** — ✅ เสร็จแล้ว (2026-07-26): 4A (backup email) โค้ด wire จริง + verify แล้ว (ยัง"ส่งไม่ได้จริง"จนกว่าจะมี SMTP creds — ดูหัวข้อ 3, ไม่ได้บล็อก phase นี้เพราะเป็น scope นอกเหนือที่ตกลงไว้); 4B (Cloudinary) ตั้งค่าจริงแล้ว + อัปโหลดรูปทดสอบจริงสำเร็จ (ดูหัวข้อ 2)
5. **Security Hardening / Breaking Changes** — ยังไม่เริ่ม (rotate secrets, DB_SSL_CA, react-router/sharp major bump, exceljs transitive vulns — ดูหัวข้อ "เพิ่มเติมหลัง Phase 4" ด้านล่าง กับหัวข้อ 5)

### เพิ่มเติมหลัง Phase 4: Executive Summary Export (2026-07-26)
เพิ่มฟีเจอร์ export รายงานสรุปผู้บริหาร ตามที่ผู้ใช้ระบุสเปคมา — ไม่ใช่ 1 ใน 5 เฟสเดิม แต่ทำต่อจาก Phase 4 เลย:
- Backend: [`backend/reports-export.js`](../backend/reports-export.js) (query รวม sales+orders items ครั้งเดียว, aggregate KPI/top-10/category ใน JS), endpoint ใหม่ `GET /api/reports/executive-export` (`startDate`/`endDate`/`format=excel|csv`) ใน server.js, เพิ่ม `exceljs` เป็น dependency
- Excel 2 ชีท: Executive Summary (KPI, Top 10, หมวดหมู่, คลังสินค้า, format ✓ ฿, gridlines, header สี, auto-fit width) + Transaction Details (รายการเต็ม) — CSV = fallback เฉพาะ Transaction Details
- Frontend: ปุ่ม "Export Excel"/"Export CSV" ใน `Settings.tsx` แท็บ "ประวัติขาย" ใช้ช่วงวันที่เดียวกับตัวกรองที่มีอยู่แล้ว
- ทดสอบแล้วจริง: เรียก endpoint ตรงผ่าน HTTP (ไม่ mock) ได้ไฟล์ .xlsx ใช้ exceljs อ่านย้อนกลับมาตรวจ — ตัวเลข KPI/top-products/category %/inventory ถูกต้องหมด (% รวมกัน = 100.00 พอดี); ทดสอบผ่านเบราว์เซอร์จริง login เป็น ADMIN กดปุ่มทั้งสองจริง เห็น request 200 ทั้งคู่ ไม่มี console error
- ⚠️ พบระหว่างติดตั้ง: `exceljs@4.4.0` (เวอร์ชันล่าสุดที่มี ณ วันนี้) มี transitive dependency (archiver/glob/minimatch/brace-expansion/uuid) ที่ high/moderate severity ใน `npm audit` — `npm audit fix` ธรรมดาแก้ไม่ได้ (ต้อง `--force` ซึ่งจะ**ลด**เวอร์ชัน exceljs ลงไปเป็น 3.4.0 ซึ่งแย่กว่า ไม่ใช่ทางแก้) ยังไม่มี exceljs เวอร์ชันใหม่กว่าที่แก้ปัญหานี้ ณ ตอนนี้ ความเสี่ยงจริงต่ำเพราะใช้แค่ "เขียน" ไฟล์ xlsx จากข้อมูลที่เชื่อถือได้ในระบบเอง ไม่ได้ใช้อ่าน/แตก zip จากไฟล์ที่ผู้ใช้อัปโหลด — เพิ่มเข้า watch-list เดียวกับ react-router/sharp ใน Phase 5 คอยเช็คว่ามี exceljs เวอร์ชันใหม่ที่แก้ปัญหานี้หรือยัง

## ของที่เสร็จแล้ว (อย่าทำซ้ำ)

- ระบบเข้างาน/ออกงานรวมเหลือหน้าเดียว `/shift` (เดิมกระจายหลายที่)
- Login เช็ค shift/attendance จริงตอน login แล้วค่อยตัดสินใจ session_mode (work/shop) ไม่ใช่เดาจาก role เฉยๆ
- Cashier ที่ไม่ได้เปิดกะ → เห็น POS แต่ล็อกกดไม่ได้ (การ์ดสีเทา + ไอคอนล็อก), backend เช็คด้วย (`/api/sales/checkout` ปฏิเสธถ้าไม่มี shift เปิด)
- Admin ห้ามขายของที่ POS แล้ว (`requireRole('CASHIER')` เท่านั้น, Sidebar/MobileBottomNav ซ่อนลิงก์ POS ให้ admin, route guard `RequireCashier`)
- Logout รวมเป็นจุดเดียว `performLogout()` — เรียก `/auth/logout` จริงทุกที่ (เมื่อก่อนบางหน้า `localStorage.clear()` เฉยๆ ทำให้ session ฝั่ง server ไม่ถูก revoke)
- Header ทุกหน้า (ยกเว้น Home) เป็นแบบเดียวกับ POS.tsx แล้ว
- โปรไฟล์แยกเป็นหน้าเต็ม `/profile` (ไม่ใช่ modal แล้ว)
- Backend config รวมเป็นไฟล์เดียว `backend/config.js` — ทุกไฟล์อื่น `require('./config')` ห้ามอ่าน `process.env` ตรงๆ อีก
- Backend error response + query ซ้ำรวมเป็น helper กลางแล้ว: `src/utils/http.js` (`sendError`/`serverError`/`badRequest`/`unauthorized`/`forbidden`/`notFound`/`conflict`/`gone` — แทน `res.status(500).json` ที่ copy 146 จุด + `res.status(4xx).json({ error })` ที่ copy ~162 จุด) + `src/utils/queries.js` (`getOrderItems`/`getUserFullName`/`getUserRole`/`lockUserPoints` — 14 call site) — ห้ามเขียนแบบเดิมซ้ำ (serverGuardRails section G/H/I ล็อกอยู่)
- ลบไฟล์ขยะ/รูป/`.md` ที่ไม่ใช้แล้ว, จัดเอกสารเข้า `docs/` (DEMO-DEPLOY.md, DEPLOY.md, GOOGLE_FORM_SETUP.md)
- PR #29 merge เข้า main แล้ว (`326bc59`), local main ดึงมาล่าสุดแล้ว ไม่ค้าง

## ยังค้างอยู่ — เรียงตามความสำคัญ

### 1. ยืนยันว่า Render deploy backend ใหม่แล้วจริง ⚠️ สำคัญสุด
ของทุกอย่างข้างบน (shift-gate, admin ห้ามขาย, login เช็ค has_active_work_session, config.js) จะ "ทำงานจริง" ก็ต่อเมื่อ Render redeploy backend ตัวล่าสุดแล้วเท่านั้น ถ้ายังไม่ redeploy ผู้ใช้จริงจะยังเจอบั๊กเดิม (เช่น cashier ไม่เปิดกะแต่ขายได้, admin ขายที่ POS ได้) — เช็ค Render dashboard ว่า deploy log ตรงกับ commit `326bc59` หรือใหม่กว่า

### 2. Cloudinary — ✅ ตั้งค่าจริงแล้ว + verify แล้ว (2026-07-26, Phase 4B)
`backend/.env` มีค่า `CLOUDINARY_CLOUD_NAME` (`pdcvtt2z`) / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` ครบแล้ว

ทดสอบแล้ว: อัปโหลดรูปจริงผ่าน `saveImage()` — ได้ URL จริงกลับมา (`https://res.cloudinary.com/pdcvtt2z/...`), ยิง HTTP ตรงไปที่ URL ยืนยันว่าไฟล์อยู่จริง (200, image/png) แล้วลบไฟล์ทดสอบทิ้ง (`cloudinary.uploader.destroy`) รูปเก่าที่อยู่ใน `backend/uploads/` local disk ไม่กระทบ (เสิร์ฟผ่าน `/api/media` คนละ endpoint จาก `saveImage()`)

ที่เหลือ: ต้องตั้ง 3 ค่าเดียวกันนี้ใน **Render environment variables** ด้วย (ตอนนี้ตั้งแค่ local `.env`) ไม่งั้น production ยังเขียนลง local disk เหมือนเดิม (แล้วจะหายตอน Render redeploy)

### 3. Cron ส่งอีเมล backup รายวัน — ✅ เสร็จสมบูรณ์ + ส่งจริงแล้ว (2026-07-27)
`server.js`'s backup cron เรียก `mailer.sendMail()` จริง, `ADMIN_EMAIL`/`ENABLE_BACKUP_EMAIL` ตั้งแล้ว, และตอนนี้ `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` ตั้งครบใน local `.env` แล้ว (Gmail App Password ของ `dmtcmart@gmail.com`)

ทดสอบแล้วจริง: รัน `createBackup()` + `sendMail()` จริง (ไม่รอ cron ตี 2) — `sendMail()` คืนค่า `true` (ก่อนหน้านี้คืน `false` เพราะไม่มี SMTP), log ยืนยัน "ส่งอีเมลถึง dmtcmart@gmail.com สำเร็จ" — คือ Gmail SMTP server รับอีเมลไว้ส่งจริงแล้ว (ยืนยันฝั่ง infra ครบ เหลือแค่เช็ค inbox จริงว่าอีเมลไปถึง)

ที่เหลือ: ตั้งค่า `SMTP_*` ทั้ง 5 ตัวเดียวกันนี้ใน **Render** ด้วย (ตอนนี้ตั้งแค่ local `.env`) — ดูค่าที่ท้ายไฟล์นี้ได้เลย

### 4. ลบ script ตายใน backend/package.json — ✅ เสร็จแล้ว (2026-07-26, Phase 1)
เดิม `"test:api": "node test-suite.js"` ไฟล์ `test-suite.js` ไม่มีอยู่จริง ลบ script นี้ออกจาก `backend/package.json` แล้ว

### 5. Security/hardening ที่ตั้งใจเลื่อนไว้ก่อน (ต้องตัดสินใจว่าจะทำเมื่อไหร่)
- **`DB_SSL_CA`** ยังไม่ตั้ง (`null`) — เชื่อมต่อ Aiven เข้ารหัสอยู่แล้วแต่ไม่ verify cert เป็นการตัดสินใจตั้งใจไว้ก่อนเพื่อลดความยุ่งยากตอน deploy ถ้าพร้อมแล้วค่อยกลับมาตั้ง CA จริง
- **`JWT_SECRET` / `SETUP_KEY`** — ต้องเช็คว่าเป็นค่าจริงแบบสุ่มปลอดภัยหรือยังเป็นค่า placeholder จาก dev ก่อน go-live จริงต้องหมุน (rotate) ใหม่
- **npm audit** — ✅ เคลียร์หมดแล้ว (2026-08-17): ทั้ง backend และ frontend = **0 vulnerabilities**
  - backend: `sharp` 0.33.5 → **0.35.3** (โค้ดใช้แค่ `.metadata()` — ไม่กระทบ; Node 24 รองรับ) + `overrides.uuid=^11.1.1` (exceljs ยัง 4.4.0 — ใช้ `uuid.v4` ที่ advisory นี้ไม่กระทบ) + audit fix ไล่ brace-expansion/ip-address/socket.io-parser
  - frontend: `react-router-dom` 7.18.1 → **7.18.2** (patch — ไม่ใช่ major bump ที่เคยเลื่อนไว้), nanoid/socket.io-parser/brace-expansion audit fix
  - exceljs transitive vuln (uuid) ที่เคยอยู่ใน watch-list — ปิดได้ด้วย override โดยไม่ต้องลดเวอร์ชัน exceljs

### 6. โครงสร้างพื้นฐานที่ขาด — ✅ ปิดแล้วใน Phase 3 (2026-07-26)
เดิมพบว่าไม่มี automated test / ไม่มี CI / ไม่มี schema รวมที่เดียว — ทั้งหมดแก้ใน Phase 3 แล้ว (ดูหัวข้อ Phase 3 ด้านบน) ยังไม่มี `migrations/` โฟลเดอร์แบบมี version history เต็มรูปแบบ (schema.sql เป็น snapshot ปัจจุบัน ไม่ใช่ migration ทีละขั้น) — พอสำหรับตอนนี้ ถ้าโปรเจกต์โตขึ้นมากค่อยพิจารณา migration tool จริงจัง (เช่น Knex/Flyway) ทีหลัง

รอง (สังเกตแต่ไม่ใช่บล็อกเกอร์): `DB_SSL` connection pool `connectionLimit: 10` ([backend/db.js:33](../backend/db.js:33)) ค่อนข้างบางสำหรับเป้าหมาย 100 คนพร้อมกัน — ยังไม่เคย load-test จริง

## เช็คลิสต์เร็วๆ พรุ่งนี้เปิดมาให้ทำ
1. เข้า Render dashboard เช็คว่า deploy ล่าสุดตรง commit `326bc59`+ หรือยัง
2. เอาค่า Cloudinary 3 ตัวมาใส่ `.env` + Render, ทดสอบอัปโหลดรูป 1 รูป
3. เขียนโค้ดส่งอีเมล backup จริงใน server.js (ใช้ mailer.js ที่มีอยู่)
4. ลบ `test:api` script ที่ตายแล้วใน package.json
5. ถามผู้ใช้ว่าพร้อม rotate JWT_SECRET/SETUP_KEY เป็นค่า production จริงหรือยัง ก่อนเปิดใช้งานจริงกับนักเรียน/ครู 100 คน
