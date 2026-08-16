# CHANGELOG

บันทึกการเปลี่ยนแปลงที่กระทบการ deploy/การใช้งาน — อัปเดตทุกครั้งที่มี release

---

## [2026-08-16] — fix: harden offline queue, timezone ranges, rewards, strict TS + CI (commit `1cf0f1b`)

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Restart backend อย่างเดียวพอ — ไม่ต้องรัน SQL มือ**
   - Commit นี้เพิ่มคอลัมน์ `idempotency_key` ให้ 3 ตาราง (categories / suppliers / promotions)
   - `db.js` จะ **ALTER TABLE ... ADD COLUMN ... UNIQUE แบบอัตโนมัติตอน startup** (idempotent + fail-soft — ทำซ้ำ/มีอยู่แล้วไม่พัง) — แค่ restart backend ก็ได้คอลัมน์ครบ
   - `schema.sql` ใช้กับ **install ใหม่** เท่านั้น (อัปเดตให้ตรงกับ db.js อยู่แล้ว — CI เทสครอบ)
2. **ไม่มี env ตัวใหม่** — commit นี้ไม่ได้อ่าน `process.env` เพิ่มจากเดิม
   - รายงานประจำวัน (cron ข้อ 3) ยังใช้ `ADMIN_EMAIL` + `SMTP_*` ที่มีใน `backend/.env.example` อยู่แล้ว — ถ้ายังไม่ได้ตั้ง จะสร้างรายงานแต่ไม่ส่งอีเมล (log เตือนไว้)
3. **cron daily report เปลี่ยนเวลา — ส่งช้าลง/เร็วขึ้น? ถูกต้องขึ้น**
   - เดิม `cron.schedule('0 6 * * *')` = **06:00 UTC = 13:00 ไทย** (ผิด ไม่ใช่เวลาที่ตั้งใจ)
   - ใหม่ `cron.schedule('0 23 * * *')` = **23:00 UTC = 06:00 ไทย** ✅ — รายงานจะส่งตอน 6 โมงเช้าไทย (ก่อนร้านเปิด) ตามเจตนา
   - cron ตัวอื่น (backup ตี 2 ไทย, auto-checkout 07:05 ไทย, revoked cleanup 02:30 ไทย) **ไม่เปลี่ยน**
   - ⚠️ ต่อจากนี้: การเขียน cron ใหม่ใน `server.js` **ต้องมี comment กำกับเวลาไทย** — เทส `test:cron` (cronTimezone.test.js) บังคับ ใครไม่เขียน comment = CI แดง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Offline queue** (frontend) | guard กัน replay ซ้อน + วนลูป (retry/drain), แจ้งเตือนผู้ใช้เมื่อ request ล้มเหลวถาวร (Swal), payload whitelist กันฟิลด์แต้ม/สมาชิกหลุดขึ้น server |
| **Timezone** (backend + frontend) | ช่วงรายงาน/สรุปยอดใช้เวลาท้องถิ่นไทย (`getYesterdayBangkok` / `localDate`) กันเที่ยงคืนเพี้ยน; ตาราง/ฟอร์มวันที่ฝั่ง client ใช้เวลาไทย |
| **Reward/แต้ม** (backend) | แลกของรางวัล + checkout มี transaction guard (ล็อก `FOR UPDATE` + rollback — กันบิลค้าง/หักแต้มซ้ำ/ของหมดสต๊อก), sync-offline มี guard เดียวกัน |
| **Idempotency** (backend) | ขยาย `idempotency_key` ไป categories/suppliers/promotions (ครบทุก mutation ที่ offline queue เก็บได้) + จัดการ `ER_DUP_ENTRY` หลัง restart (`utils/idempotency.js`) |
| **Security / ลินต์** (frontend) | เปิด **strict TS + noUnusedLocals/Parameters** ถาวร (มี `check:strict` กันปิดใน build), ล้าง `any` เหลือ 0 ทั้งโปรเจกต์, api.ts แก้ ownership (`cashier_id`) + กัน error ดิบรั่ว |
| **CI** | job ใหม่ `backend-unit-tests` รันเทส backend ทั้ง 8 ชุด (ไม่ต้องใช้ MySQL) — เดิม cron/daily/reward/sync-offline ไม่เคยถูก CI ตรวจ |

### เทส/เครื่องมือ dev (หลัง commit นี้)

- **backend:** `npm run test:unit` รัน 8 ชุดในคำสั่งเดียว (contract/price/cron/daily/member-groups/reward/sync-offline/richmenu = 123 ตัว) · `npm run test:richmenu` แยกได้ · `npm test` = smokeTest (E2E ต้อง MySQL) + test:unit
- **frontend:** `npm run typecheck` · `npm run check:strict` · `npm run build` (จะรัน check:strict ก่อนเสมอ) · เทส 87 ตัว
- **สคริปต์**: `npm run line:richmenu -- ./path/to/richmenu-2500x1686.png` (usage เดิม ไม่เปลี่ยน)

### Rollback (ถ้าจำเป็น)

- Revert commit นี้แล้ว deploy ใหม่ — `idempotency_key` columns ที่ ALTER ไปแล้ว**ไม่ต้องลบ** (NULL ได้, UNIQUE ไม่บล็อกการใช้งานปกติ) — ปล่อยไว้ได้ ไม่กระทบ
- อย่าลืม: cron กลับไปเป็น `'0 6 * * *'` (=13:00 ไทย) ตามโค้ดเก่า ถ้า revert ทั้ง commit
