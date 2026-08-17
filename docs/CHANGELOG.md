# CHANGELOG

บันทึกการเปลี่ยนแปลงที่กระทบการ deploy/การใช้งาน — อัปเดตทุกครั้งที่มี release

---

## [2026-08-17] — feat(frontend): รวม primitive UI ที่เหลือ (badge สถานะ / field label / skeleton / ตาราง) (ยังไม่ push)

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Rebuild frontend อย่างเดียวพอ** — ไม่แตะ backend ไม่มี SQL/env ใหม่ ไม่ต้อง restart backend
2. **หน้าตาเปลี่ยนเล็กน้อย** (ข้อมูล/ลอจิกไม่เปลี่ยน): ป้ายสถานะออเดอร์สี/ขนาดรวมเป็นแบบเดียว — **SLIP_REJECTED เปลี่ยนจากแดงเป็นเหลือง** (semantic "ต้องส่งสลิปใหม่" เหมือน WAITING_CASH — เดิม member view แดง vs staff view เหลือง); label ฟอร์มรวม 2 ขนาด, skeleton loading ใช้ component กลาง, หัวตาราง OrderManagement/Attendance รวมเป็นมาตรฐานเดียว

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Badge สถานะ** (frontend) | สร้าง `components/ui/StatusBadge.tsx` (map สีกลางเดียว + 3 ขนาด sm/md/lg + ไอคอนตามสถานะ) — อพยพ 3 จุดที่ copy-paste สีต่างกัน (OrderManagement / MyOrdersModal / OrderDetailModal); กันใครแก้สีเฉพาะจุดแล้วเพี้ยน |
| **Label ฟอร์ม** (frontend) | สร้าง `components/ui/FieldLabel.tsx` (size xs/sm + `required`) — อพยพ ~24 จุด 12 ไฟล์ (เดิม ~6 แบบ: text-xs gray-500/600/bold + text-sm gray-700) |
| **Skeleton** (frontend) | เพิ่ม `SkeletonListRow` ใน `ui/Skeleton` + อพยพ 5 จุดที่ hand-roll เอง (Attendance ×2 / Backup / Dashboard / VendorSales — rounded ต่างกัน lg/xl/2xl/3xl); structure skeleton เฉพาะบริบท (Home/Notifications/PreOrder) คงไว้ |
| **ตาราง** (frontend) | thead OrderManagement (`text-sm`/`p-4`) + Attendance (`bg-brand-bg`/`px-4 py-2.5`) → มาตรฐาน `bg-gray-50 text-gray-600 text-xs p-3` — 7 ตารางทั้งแอปเป็นแบบเดียวกัน |
| **เทส contract** (frontend) | `uiConsistencyContract.test.ts` +6 กฎ: thead ต้องตรงมาตรฐานเป๊ะ + ห้าม `th p-4` / badge 3 ไฟล์ต้องใช้ `StatusBadge` + ห้าม ternary สีเขียนเอง / label 12 ไฟล์ต้องใช้ `FieldLabel` / skeleton 4 ไฟล์ต้องใช้ `ui/Skeleton` — ทดสอบด้วยไฟล์ปลอมแล้วจับ fail จริง (thead 3 กฎแดง) |

**Rollback:** revert แล้ว rebuild frontend — ไม่มีผลต่อ data

---

## [2026-08-17] — feat(frontend): ดีไซน์หน้า Home ใหม่ (DNA แบรนด์: ชายคา + ตั๋วรับของ + ฟอนต์ Prompt) (commit `42de03f`)

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Rebuild frontend อย่างเดียวพอ** — ไม่แตะ backend ไม่มี SQL/env ใหม่ ไม่ต้อง restart backend
2. **หน้า Home เปลี่ยนหน้าตา** (ข้อมูล/ลอจิก/ปุ่มทุกปุ่มไม่เปลี่ยน): หัวหน้าเป็นชายคาหยัก, ชื่อเป็นฟอนต์ Prompt, การ์ดออเดอร์ค้างเป็น "🎫 ตั๋วรับของ #id" (แถบหัว + เส้นประตัด), หัวข้อ 3 ส่วนรวมเป็น `SectionTitle`, ราคาเป็นเลข tabular
3. **ฟอนต์หัวข้อใหม่ (Prompt 700)** — โหลดจาก Google Fonts (preconnect + `display=swap`) ใช้กับหัวข้อ/ชื่อ/ตัวเลขเท่านั้น; **ออฟไลน์หรือเน็ตติ๊ด = fallback ฟอนต์ระบบอัตโนมัติ** ไม่กระทบการใช้งาน
4. **Icon/ภาพสินค้า/อวตาร = เดิมทั้งหมด** — รอบนี้ไม่แตะไอคอน lucide หรือรูปภาพ (เป็น design ที่ตั้งใจ)

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **หัวหน้า Home** | ชายคาหยักใต้แถบหัว (`.awning-edge` — `radial-gradient` CSS ล้วน ยื่น 12px) + ชื่อ/คำทักทายเป็น `font-display` (Prompt) |
| **การ์ดออเดอร์ค้าง** | เป็น "🎫 ตั๋วรับของ #id": แถบหัวชมพูอ่อน + สถานะ, เส้นประตัด (`border-dashed brand-mid`), ยอดรวมตัวใหญ่ font-display — ปุ่ม "ส่งสลิปด่วน/ดูรายละเอียด" เดิมเป๊ะ |
| **หัวข้อส่วน** | สร้าง `components/ui/SectionTitle.tsx` (แท่ง brand + Prompt + slot ขวา "ดูทั้งหมด") — 3 ส่วนใน Home (โปรโมชัน/สินค้าขายดี/เมนู) เดิมเขียนคนละแบบ รวมเป็นเสียงเดียว |
| **ฟอนต์/สี** (frontend) | tailwind เพิ่ม `fontFamily.display` (Prompt 700) + สี `ink` (`#3A2230` ม่วงพลัมอุ่น) สำหรับหัวข้อ; ราคาเป็น `tabular-nums` (เลขเรียงตรง) |
| **ขอบเขต** | ยังไม่แตะหน้า PreOrder — รออนุมัติจาก Home ก่อน (รอบถัดไปค่อยขยาย) |

**Rollback:** revert แล้ว rebuild frontend — ไม่มีผลต่อ data

---

## [2026-08-17] — feat(frontend): รวม UI เป็นระบบเดียว (PageHeader + primitive + ปุ่ม/โมดัล) (commit `8abe0bd`)

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Rebuild frontend อย่างเดียวพอ** — commit นี้ไม่แตะ backend ไม่มี SQL/env ใหม่ ไม่ต้อง restart backend
2. **UX เปลี่ยนเล็กน้อย** (ไม่กระทบข้อมูล): แถบหัวหน้าทุกหน้าเป็นแบบเดียวกัน, พื้นหลังชมพูอ่อนทั้งแอป, ปุ่ม/โมดัลใช้คอมโพเนนต์กลาง — ถ้าสังเกตหน้าตาเปลี่ยนจากเดิม = ถูกต้องตามที่รวมมาตรฐาน

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Header ทุกหน้า** (frontend) | สร้าง `components/layout/PageHeader.tsx` (แถบ gradient flush: icon w-8 + title text-lg) — 9 หน้าที่เคยเป็น "การ์ดมน rounded-3xl" แปลงเป็นแถบเดียวกับ POS/PreOrder; Dashboard/Summary คง health dot/ปุ่มกลับ/print override |
| **พื้นหลังหน้า** (frontend) | ทุกหน้า + Layout shell เป็น `bg-brand-bg` (เดิมปน gray-50 กับ brand-bg — หน้าไม่เป็นครอบครัวเดียวกัน) |
| **ช่องกรอก** (frontend) | สร้าง `components/ui/fieldStyles.ts` (inputCls กลาง) — 3 ไฟล์ที่นิยามซ้ำกันเอง (padding เพี้ยน) import แทน |
| **ตาราง** (frontend) | thead รวมเป็น `bg-gray-50 text-gray-600 text-xs` (เดิมปน brand-bg/text-sm) |
| **ปุ่ม** (frontend) | อพยพปุ่ม gradient ~25 จุด (16 ไฟล์) → `ui/Button` (variant primary/secondary/danger/ghost + ขนาด sm/md/lg) — คงไว้: FAB กลม (POS/PreOrder/MobileBottomNav), โลโก้ login, การ์ด hero, ปุ่มเช็คเอาต์ตสีตามวิธีจ่าย |
| **โมดัล** (frontend) | อัปเกรด `ui/Modal` (หัว gradient แบรนด์ + `hideClose`/`backdropClosable` รองรับ forceChange) — อพยพ 6 โมดัล (Settings CustomModal / Attendance edit / Reward / Detail / CloseShift / ChangePassword) |
| **เทส** (frontend) | เพิ่ม source contract: `pageHeaderContract.test.ts` (แถบหัวห้ามกลับ 2 แบบ) + `uiConsistencyContract.test.ts` (พื้นหลัง/thead/inputCls/ปุ่ม gradient/โมดัล shell ต้องใช้ component กลาง) |

**Rollback:** revert แล้ว rebuild frontend — ไม่มีผลต่อ data

---

## [2026-08-17] — feat(frontend): รวมแถบล่างเป็น MobileBottomNav ตัวเดียวทุกหน้า (commit `133b7f2`)

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Rebuild frontend อย่างเดียวพอ** — commit นี้ไม่แตะ backend ไม่มี SQL/env ใหม่ ไม่ต้อง restart backend
2. **UX เปลี่ยนของสมาชิก**: หน้า /pre-order แถบล่างเปลี่ยนจาก 2 ปุ่ม (ร้านค้า/บัตรสมาชิก) เป็นแถบมาตรฐาน 5 ปุ่ม (เมนู/แจ้งเตือน/หน้าแรก/จอง/โปรไฟล์) — เข้าบัตรสมาชิกได้ทาง **เมนู → บัตรสมาชิก** หรือ sidebar

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Bottom nav** (frontend) | ลบ `MemberBottomNav` (แถบ 2 ปุ่มเฉพาะ member) — ทุกหน้ารวมเป็น `MobileBottomNav` ตัวเดียว (แถบลอย + FAB กลาง); หน้า /register การ์ด "เป็นสมาชิกอยู่แล้ว" ใช้แถบเดียวกัน + drawer ครบ |
| **เมนูสมาชิก** (frontend) | เพิ่ม "บัตรสมาชิก" (`/register`) ใน `MEMBER_ITEMS` → ปรากฏใน sidebar + mobile drawer กันเข้าบัตรไม่ได้หลังรวมแถบ |

**Rollback:** revert commit นี้แล้ว rebuild frontend — ไม่มีผลต่อ data

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

---

## [2026-08-16] — feat: staff สั่งจองสินค้าได้ + นโยบายแต้ม MEMBER-only + realtime สลิป (commit `354dbb3`)

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Restart backend + rebuild/deploy frontend — ไม่มี SQL มือ, ไม่มี env ใหม่**
   - เปลี่ยนเฉพาะโค้ด (server.js + หน้าเว็บ) — ไม่มี migration/ALTER เพิ่ม, ไม่ได้อ่าน `process.env` ตัวใหม่
2. **นโยบายแต้มเปลี่ยน: เฉพาะ MEMBER เท่านั้น**
   - staff (CASHIER/MANAGER/ADMIN) **สั่งจองสินค้าได้** (ผ่าน LINE/เว็บ เหมือนสมาชิก — ดูออเดอร์/ส่งสลิป/ยกเลิกของตัวเองได้ครบ) **แต่ไม่มีสิทธิ์สะสม/แลกแต้มสมาชิก** ทุกช่องทาง: พรีออเดอร์ (ตอบ 403 ถ้าขอแลกแต้ม), บิลขาย POS (เลือกบัญชี staff เป็น "สมาชิก" → ตอบ 400 ถ้าขอแลกแต้ม/ของรางวัล + ไม่ได้แต้มสะสม), เครดิตแต้มตอนรับของ (COMPLETED) เช็ค role เจ้าของอีกชั้น
   - UI แสดงชัด: หน้า Home/Profile มี badge "💼 บัญชีพนักงาน", หน้าสั่งจอง/หน้าขายซ่อนส่วนแต้ม + หมายเหตุ "ไม่มีสิทธิ์แต้ม" + ปุ่ม "สลับไปใช้บัญชีสมาชิก" (logout → login ด้วยบัญชี MEMBER แยก ถ้ามี)
3. **หน้า Home มีเมนูครบตาม role** — เพิ่มการ์ด จัดการออเดอร์/สรุปข้อมูล/สรุปบัญชี/เข้า-ออกงาน/ตั้งค่า/สำรอง&กู้คืน/แจ้งเตือน/บัญชีของฉัน/ยอดฝากขาย + การ์ดสั่งจองเปิดให้ทุก role (ตรงกับ sidebar เดิม)

### เปลี่ยนหลักในรอบนี้

| ส่วน | อะไร |
|---|---|
| **staff สั่งจอง** (backend) | `POST /orders` + `POST /orders/:id/upload-slip` + `GET /orders/pending-count` เพิ่ม MANAGER; `GET /orders?mine=1` ครอบออเดอร์ตัวเอง (staff ที่สั่งจองดูประวัติตัวเอง ไม่ปนกับ view จัดการออเดอร์) |
| **staff สั่งจอง** (frontend) | `/pre-order` เปิดให้ทุก role ที่ล็อกอิน (เดิม MEMBER-only); การ์ดสั่งจองใน Home โชว์ทุก role |
| **นโยบายแต้ม** (backend) | `utils/preorderPolicy.js` (ของจริงที่ route ใช้): staff = ไม่แลก/ไม่สะสมแต้ม; checkout ใช้ `resolveSaleMemberPoints` + ตอบ 400 (client error ไม่กลายเป็น 500) |
| **UI แจ้งสถานะ** (frontend) | badge "พนักงาน" (Home/Profile/POS), หมายเหตุไม่มีสิทธิ์แต้ม, ปุ่มสลับไปบัญชีสมาชิก, badge ออเดอร์รอตรวจใน Home |
| **แถบเตือนสลิป** (backend) | upload-slip ตอน resubmit (SLIP_REJECTED → PENDING_VERIFY) ยิง `order_update_user_` กลับเจ้าของ + `order_status_changed` หลัง commit — แถบเตือน/รายการออเดอร์/badge รีเฟรช realtime ทุกเครื่อง (ครอบ staff ด้วย); เดิมยิงแค่ event ฝั่งพนักงาน = แถบค้างจน refresh |
| **โมดัลออเดอร์** (frontend) | MyOrdersModal/OrderDetailModal: ซ่อนปุ่มยกเลิกตายบน SLIP_REJECTED (backend ไม่อนุญาต user-side cancel — เดิมกดแล้ว 500); แถบเตือนสลิปของ staff ดึง `?mine=1` เห็นเฉพาะออเดอร์ตัวเอง (กันรั่วออเดอร์ลูกค้าทั้งระบบ) |
| **เทส** | backend +34 (`preorderPolicy.test.js`: policy matrix + จำลองฟลว mocked conn + source contract `lookupMember`; `orderRealtime.test.js`: ล็อก socket join/event สลิป realtime) = 10 ชุด; frontend +21 เทส (component tsx 17 ตัว + source contract Layout/PreOrder 4 ตัว) |

### เทส/เครื่องมือ dev

- **frontend:** เพิ่ม devDependency **`tsx`** (รันเทส .tsx) — `npm test` = 91 ตัวเดิม + 17 เทส component (`test-components.cjs` — ใช้ `--experimental-test-module-mocks` สำหรับ mock api/swal ในเทสโมดัล); `npm run build` เดิมไม่เปลี่ยน
- **backend:** `npm run test:unit` = 10 ชุด (เพิ่ม `preorder-policy` + `order-realtime`) · เทสสคริปต์เดิมไม่เปลี่ยน

### Rollback (ถ้าจำเป็น)

- Revert โค้ดรอบนี้ = staff กลับไปสั่งจองไม่ได้ (หน้า /pre-order กลับเป็น MEMBER-only) และแต้มกลับให้ staff ได้เหมือนเดิม — ไม่มีข้อมูล/คอลัมน์ใหม่ต้องจัดการ ปลอดภัย
