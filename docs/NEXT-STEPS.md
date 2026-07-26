# แผนงานต่อ — เขียนไว้บอกตัวเองวันพรุ่งนี้

อัปเดตล่าสุด: 2026-07-26 (หลัง merge PR #29 เข้า main แล้ว, commit ล่าสุด `326bc59`)

## แผนงาน 5 เฟส (ตกลงกันแล้ว 2026-07-26)

1. **Quick Wins & Cleanup** — ✅ เสร็จแล้ว (ลบ `test:api`, `npm audit fix` ส่วนไม่ breaking, build ผ่าน)
2. **Production Verification** — ✅ เสร็จแล้ว (2026-07-26, Render live บน commit `326bc59`, deploy 19:36 น. เขียว)
3. **Foundational Safety Net** — ✅ เสร็จแล้ว (2026-07-26): CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml): frontend build + backend smoke test บน MySQL service container), smoke test ([`backend/smoke-test.js`](../backend/smoke-test.js): login → checkout ถูกบล็อกตอนไม่มีกะเปิด → เปิดกะ → checkout ผ่าน → ปิดกะ — รันจริงกับ DB จริงแล้วผ่านหมด), schema.sql รวม ([`backend/schema.sql`](../backend/schema.sql): ดึงจาก dev DB ที่รัน initDB() ครบแล้วจริง ไม่ได้ก็อปจากโค้ดมือ, verify แล้วว่าโหลดเข้า DB เปล่าได้สะอาด)
   - ระหว่างทางเจอของแถม 3 อย่าง แก้ไปด้วย: (1) ลบ endpoint `/api/init-db` ที่ตายแล้วใน server.js — schema เก่ามาก ขาดคอลัมน์ที่โค้ดปัจจุบันใช้จริง (เช่น `must_change_password`) ไม่มีใน docs ไหนอ้างถึงเลย ใช้แค่ `/api/create-admin` เท่านั้นตาม docs/DEPLOY.md; (2) local dev DB มีตาราง `members` ค้างอยู่จาก endpoint เก่านั้น ไม่ใช่ schema จริง ลบทิ้งได้ (0 แถว); (3) db.js มี ALTER TABLE `products.is_expired` ที่ fail เงียบๆ ทุก boot มาตลอด (MySQL ห้ามใช้ CURDATE() ใน generated column) ลบทิ้งแล้ว ไม่กระทบฟีเจอร์จริงเพราะ expiry_status คำนวณแยกด้วย SQL CASE ที่อื่นอยู่แล้ว; แถมแก้ audit_logs index-ALTER ที่ log warning ผิดทุก boot ด้วย (เช็ค error code ผิดตัว)
4. **Feature Completion** — ยังไม่เริ่ม (Cloudinary keys, backup email)
5. **Security Hardening / Breaking Changes** — ยังไม่เริ่ม (rotate secrets, DB_SSL_CA, react-router/sharp major bump)

## ของที่เสร็จแล้ว (อย่าทำซ้ำ)

- ระบบเข้างาน/ออกงานรวมเหลือหน้าเดียว `/shift` (เดิมกระจายหลายที่)
- Login เช็ค shift/attendance จริงตอน login แล้วค่อยตัดสินใจ session_mode (work/shop) ไม่ใช่เดาจาก role เฉยๆ
- Cashier ที่ไม่ได้เปิดกะ → เห็น POS แต่ล็อกกดไม่ได้ (การ์ดสีเทา + ไอคอนล็อก), backend เช็คด้วย (`/api/sales/checkout` ปฏิเสธถ้าไม่มี shift เปิด)
- Admin ห้ามขายของที่ POS แล้ว (`requireRole('CASHIER')` เท่านั้น, Sidebar/MobileBottomNav ซ่อนลิงก์ POS ให้ admin, route guard `RequireCashier`)
- Logout รวมเป็นจุดเดียว `performLogout()` — เรียก `/auth/logout` จริงทุกที่ (เมื่อก่อนบางหน้า `localStorage.clear()` เฉยๆ ทำให้ session ฝั่ง server ไม่ถูก revoke)
- Header ทุกหน้า (ยกเว้น Home) เป็นแบบเดียวกับ POS.tsx แล้ว
- โปรไฟล์แยกเป็นหน้าเต็ม `/profile` (ไม่ใช่ modal แล้ว)
- Backend config รวมเป็นไฟล์เดียว `backend/config.js` — ทุกไฟล์อื่น `require('./config')` ห้ามอ่าน `process.env` ตรงๆ อีก
- ลบไฟล์ขยะ/รูป/`.md` ที่ไม่ใช้แล้ว, จัดเอกสารเข้า `docs/` (DEMO-DEPLOY.md, DEPLOY.md, GOOGLE_FORM_SETUP.md)
- PR #29 merge เข้า main แล้ว (`326bc59`), local main ดึงมาล่าสุดแล้ว ไม่ค้าง

## ยังค้างอยู่ — เรียงตามความสำคัญ

### 1. ยืนยันว่า Render deploy backend ใหม่แล้วจริง ⚠️ สำคัญสุด
ของทุกอย่างข้างบน (shift-gate, admin ห้ามขาย, login เช็ค has_active_work_session, config.js) จะ "ทำงานจริง" ก็ต่อเมื่อ Render redeploy backend ตัวล่าสุดแล้วเท่านั้น ถ้ายังไม่ redeploy ผู้ใช้จริงจะยังเจอบั๊กเดิม (เช่น cashier ไม่เปิดกะแต่ขายได้, admin ขายที่ POS ได้) — เช็ค Render dashboard ว่า deploy log ตรงกับ commit `326bc59` หรือใหม่กว่า

### 2. ยังไม่ได้ตั้งค่า Cloudinary จริง
`backend/cloudinary-config.js` เขียนโค้ด auto-detect ไว้ครบแล้ว (ถ้ามี 3 ตัวแปรครบใช้ cloud ถ้าไม่มี fallback เก็บ disk local) แต่ `.env` ยังไม่มี `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` เลยสักตัว (เช็คแล้วตอนนี้ = 0) — ผู้ใช้บอกว่าสมัครบัญชีไว้แล้วแต่ยังไม่ได้เอาค่ามาใส่ ต้อง:
1. ไปหน้า Cloudinary dashboard คัดลอก Cloud name / API Key / API Secret
2. ใส่ใน `backend/.env` (local) และใน Render environment variables (production)
3. รีสตาร์ท backend แล้วอัปโหลดรูปทดสอบ 1 รูปดูว่าไปเก็บที่ cloudinary จริง ไม่ใช่ local disk
เหตุผลที่ต้องรีบ: โฟลเดอร์ `backend/uploads/` เก็บบน disk เดียว ไม่มี backup, ถ้ารูปเข้างาน/สลิปวันละ ~100 รูป จะเต็ม storage ก่อนครบเดือนแน่ๆ (ผู้ใช้พูดเอง)

### 3. Cron ส่งอีเมล backup รายวันยังเป็นแค่ TODO stub
`backend/server.js` แถวๆ 5236-5254 ตอนนี้:
```js
if (config.ENABLE_BACKUP_EMAIL) {
  // TODO: implement email sending if needed
  console.log(`[CRON] Email would be sent to ${config.ADMIN_EMAIL}`);
}
```
แค่ log ไม่ได้ส่งจริง ทั้งที่ `backend/mailer.js` มี `sendMail()` ใช้งานได้จริงอยู่แล้ว (daily-report.js เรียกใช้อยู่) — งานคือเปลี่ยน `console.log` ให้เรียก `mailer.sendMail(...)` จริง ทั้ง branch สำเร็จและ branch ที่ backup ล้มเหลว (catch block ก็มี stub เดียวกันอีกจุด)

### 4. ลบ script ตายใน backend/package.json — ✅ เสร็จแล้ว (2026-07-26, Phase 1)
เดิม `"test:api": "node test-suite.js"` ไฟล์ `test-suite.js` ไม่มีอยู่จริง ลบ script นี้ออกจาก `backend/package.json` แล้ว

### 5. Security/hardening ที่ตั้งใจเลื่อนไว้ก่อน (ต้องตัดสินใจว่าจะทำเมื่อไหร่)
- **`DB_SSL_CA`** ยังไม่ตั้ง (`null`) — เชื่อมต่อ Aiven เข้ารหัสอยู่แล้วแต่ไม่ verify cert เป็นการตัดสินใจตั้งใจไว้ก่อนเพื่อลดความยุ่งยากตอน deploy ถ้าพร้อมแล้วค่อยกลับมาตั้ง CA จริง
- **`JWT_SECRET` / `SETUP_KEY`** — ต้องเช็คว่าเป็นค่าจริงแบบสุ่มปลอดภัยหรือยังเป็นค่า placeholder จาก dev ก่อน go-live จริงต้องหมุน (rotate) ใหม่
- **npm audit**: `postcss` / `nanoid` / `brace-expansion` (frontend) แก้แล้ว ✅ เสร็จ (2026-07-26, Phase 1, `npm audit fix` ไม่ breaking, build ผ่าน); `react-router` (frontend) กับ `sharp` (backend) ยังเหลือ เป็น high-severity แต่ fix ต้อง breaking change (`react-router-dom@7.11.0` ตาม dry-run) เลื่อนไว้ Phase 5

### 6. โครงสร้างพื้นฐานที่ขาด — ✅ ปิดแล้วใน Phase 3 (2026-07-26)
เดิมพบว่าไม่มี automated test / ไม่มี CI / ไม่มี schema รวมที่เดียว — ทั้งหมดแก้ใน Phase 3 แล้ว (ดูหัวข้อ Phase 3 ด้านบน) ยังไม่มี `migrations/` โฟลเดอร์แบบมี version history เต็มรูปแบบ (schema.sql เป็น snapshot ปัจจุบัน ไม่ใช่ migration ทีละขั้น) — พอสำหรับตอนนี้ ถ้าโปรเจกต์โตขึ้นมากค่อยพิจารณา migration tool จริงจัง (เช่น Knex/Flyway) ทีหลัง

รอง (สังเกตแต่ไม่ใช่บล็อกเกอร์): `DB_SSL` connection pool `connectionLimit: 10` ([backend/db.js:33](../backend/db.js:33)) ค่อนข้างบางสำหรับเป้าหมาย 100 คนพร้อมกัน — ยังไม่เคย load-test จริง

## เช็คลิสต์เร็วๆ พรุ่งนี้เปิดมาให้ทำ
1. เข้า Render dashboard เช็คว่า deploy ล่าสุดตรง commit `326bc59`+ หรือยัง
2. เอาค่า Cloudinary 3 ตัวมาใส่ `.env` + Render, ทดสอบอัปโหลดรูป 1 รูป
3. เขียนโค้ดส่งอีเมล backup จริงใน server.js (ใช้ mailer.js ที่มีอยู่)
4. ลบ `test:api` script ที่ตายแล้วใน package.json
5. ถามผู้ใช้ว่าพร้อม rotate JWT_SECRET/SETUP_KEY เป็นค่า production จริงหรือยัง ก่อนเปิดใช้งานจริงกับนักเรียน/ครู 100 คน
