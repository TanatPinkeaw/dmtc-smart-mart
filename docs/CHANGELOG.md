# CHANGELOG

บันทึกการเปลี่ยนแปลงที่กระทบการ deploy/การใช้งาน — อัปเดตทุกครั้งที่มี release

---

## [2026-08-17] — Backend: อพยพ response 4xx เขียนเองครบ 162 จุดเข้า utils/http (badRequest/unauthorized/forbidden/notFound/conflict/gone) — เหลือ raw 4xx 0 จุด

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Restart backend เท่านั้น** — JSON ตอบกลับเหมือนเดิมเป๊ะ ({ error } + field พิเศษ spread ไว้ key เดิม) ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรัน migration

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **utils/http.js** (backend) | เพิ่ม helper 4 ตัว: `unauthorized` (401) · `forbidden` (403) · `conflict` (409) · `gone` (410) — คู่กับ `badRequest`/`notFound`/`serverError` เดิม; `sendError` ปรับให้ object details **spread ไว้ที่ top-level** (key เดิมคงอยู่ — เช่น `{ code: 'MUST_CHANGE_PASSWORD' }` / `{ detail }` / `{ requirements }` / `{ issues }` / `{ conflicted_products }`) ส่วน primitive ยังเป็น `{ error, details }` — frontend ที่อ่าน `data.code === 'MUST_CHANGE_PASSWORD'` (api.ts) ทำงานต่อ |
| **server.js + 7 controllers** (backend) | อพยพ `res.status(4xx).json({ error: ... })` เขียนเอง **162 จุด** → helper: badRequest 93 · unauthorized 16 · forbidden 15 · notFound 32 · conflict 5 · gone 1 — รวม single-line 140 (สคริปต์ regex) + multi-line/field พิเศษ/ค่า non-literal 22 (มือ) — JSON `{ error }` เดิมเป๊ะทุกจุด |
| **เทส contract** (backend) | serverGuardRails **49 → 59 เช็ค** — section I ใหม่ 10 เช็ค: helper 4 ตัวต้องมีใน http.js · badRequest/notFound ถูกใช้จริง (ไม่ใช่ของตาย) · server.js + controllers 7 ไฟล์ **ห้ามเหลือ raw `res.status(4xx).json`** · webhook `res.status(401).end()` ต้องอยู่ (LINE protocol) · แก้เช็ค G ให้ตรง sendError ใหม่ · preorderPolicy เทส 403 อัปเดตรับ `forbidden(res` |

### 🧪 เทส
- backend: **test:unit 12/12 ชุดผ่าน** (serverGuardRails 59 เช็ค) + `node --check` ทุกไฟล์ + probe ยืนยัน JSON shape

**ข้อยกเว้นที่ตั้งใจไม่แตะ:** `src/middleware/guards.js` ยังเขียน `res.status(403)`/`res.status(400)` เอง — เป็น**ตำแหน่งนิยามกลาง**ของ middleware (contract section F ล็อกไว้แล้ว ไม่ใช่ที่ copy ซ้ำ) · `lineWebhookController` `res.status(401).end()` — LINE webhook ต้องตอบ raw status · response สำเร็จ (`res.json({ success: true, ... })`) — shape ต่างกันตาม endpoint (message+affected / csrfToken / path+dims / backup) ไม่ใช่ pattern คู่ที่รวมได้

---

## [2026-08-17] — UI: สแกน segmented control/checkbox/toggle รอบสุดท้าย — สร้าง ui/SegmentedControl (box + pill) + อพยพปุ่มวิธีจ่าย QR/เงินสด ×2 + pill ช่วงเวลา/มุมมอง ×2 — ล็อก contract

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **SegmentedControl** (frontend) | component กลางใหม่ `ui/SegmentedControl` — ปุ่มกลุ่มเลือก (radio-like) เลือกได้ 1 ตัว: variant `box` (ปุ่ม border-2 2 ช่อง — วิธีจ่ายเงิน) / `pill` (ปุ่มกลมเล็กในถาด bg-brand-bg — ช่วงเวลา/มุมมอง); สี selected เฉพาะ option ต่างกันได้ผ่าน `selectedClassName` (QR น้ำเงิน); semantic `role="radiogroup"/"radio"` + `aria-checked` + `ariaLabel` |
| **pos + preorder CartPanel** (frontend) | ปุ่มวิธีจ่าย QR/เงินสด (copy กัน 2 ไฟล์ ~12 บรรทัด) → `<SegmentedControl variant="box">` — CASH = แบรนด์ / QR = น้ำเงิน (selectedClassName) หน้าตาเดิมเป๊ะ; side-effect ตอนเปลี่ยนวิธี (pos เคลียร์/เติมช่องเงินรับมา) ไปไว้ใน onChange |
| **Dashboard + Summary** (frontend) | ปุ่ม pill ช่วงเวลา Peak Hours + มุมมองกำไร (container เดียวกันเป๊ะ) → `<SegmentedControl variant="pill">` — normalize เล็กน้อย: Dashboard text-[10px]→text-xs (12px เท่ากับ Summary — ตรงกับหัวการ์ด), Summary px-3→px-2.5; Dashboard ยัง disabled ตอนโหลด + Summary ยัง `print:hidden` |
| **เทส contract** (frontend) | section ใหม่ `SEGMENTED_ADOPTED` 3 เช็ค (4 ไฟล์: pos/preorder CartPanel + Dashboard/Summary): ต้อง import ui/SegmentedControl + ห้ามเขียนเอง (selected QR ใน ternary `? 'border-blue-600 bg-blue-50` / container pill `bg-brand-bg ... rounded-full p-0.5` / ปุ่ม `<button ... border-2`) + เทสล็อก component มี variant box/pill + radiogroup/radio |

### 🧪 เทส
- frontend: **158 เทสผ่าน** (141 + 17 component — contract section ใหม่ 3 เช็ค) + `typecheck` + `build` ผ่าน

**ผลสแกน checkbox/radio/toggle — ไม่มีอะไรต้องอพยพเพิ่ม:** สวิตช์เปิดปิด (`role="switch"`/`peer-checked`) **ไม่มีในแอปเลย**; checkbox มีแค่ 2 จุดใน Settings (native `accent-brand` — มาตรฐาน browser พอใช้ได้ ไม่ต้องมี component); ปุ่มกลุ่มเลือกที่เหลือเป็น exception ตั้งใจ — **แถบหมวดสินค้า ProductGrid ×2** (ชิปใหญ่ในแถวเลื่อน + icon — anatomy ต่างจาก box/pill และ 2 ไฟล์ใช้สไตล์เดียวกันอยู่แล้ว) + **แท็บออเดอร์ OrderManagement** (ปุ่มสูง px-3 py-2 — tab bar คนละ pattern)

---

## [2026-08-17] — UI: สแกน NON-ADOPTED ด้านตาราง/badge/skeleton — ตาราง+badge สะอาดอยู่แล้ว (ล็อกทั่วแอป) + อพยพ skeleton ของ Home เข้า Skeleton กลาง

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Home skeleton** (frontend) | skeleton เขียนเอง 3 จุด → primitive กลาง: ตั๋วรับของ (การ์ด 2 เส้น) → `<SkeletonCard>` · การ์ดโปรโมชัน (กล่อง w-64 h-24) → `<SkeletonListRow height="h-24">` · การ์ดสินค้าขายดี (กล่องรูป + 2 เส้น) → เปลือกการ์ดคงไว้ (โครงเฉพาะ) + กล่องใน → `<SkeletonLine>` (ภาพ/ชื่อ/ราคา) |
| **Skeleton** (frontend) | `SkeletonLine` เพิ่ม prop `className` (ต่อท้ายได้ — กันเขียนกล่อง bg-brand-border/40 เองในหน้า) |
| **เทส contract** (frontend) | `SKELETON_ADOPTED` +Home (9 ไฟล์) + เทสล็อก SkeletonLine ต้องมี className — contract **49 ตัว** |

### 🧪 เทส
- frontend: **155 เทสผ่าน** (138 + 17 component — contract 49 ตัว) + `typecheck` + `build` ผ่าน

**ผลสแกนตาราง/badge — สะอาดอยู่แล้ว ไม่ต้องอพยพ:** ตาราง — BackupManagement/Summary ใช้ thead มาตรฐาน (กฎ global ครอบ ALL_UI อยู่แล้ว), ตารางใน POS.tsx เป็น HTML string สำหรับพิมพ์ใบแจ้ง (class= ไม่ใช่ React); badge — ที่เหลือเป็น **role/source pill** (Summary บทบาท ADMIN/purple-100, Attendance แหล่งที่มา SHIFT/LIFF, Home badge บนตั๋ว/เมนู) — StatusBadge กลางเป็น map สถานะ **ออเดอร์** โดยเฉพาะ (คนละโดเมน — ข้ามแบบตั้งใจตามที่บันทึกไว้รอบก่อน); skeleton อื่น — `animate-pulse` ของ OfflineBanner (เอฟเฟกต์กะพริบขาดเน็ต), AuthImage (placeholder รูป), health dot Dashboard (สถานะ) — เป็น effect/สถานะ ไม่ใช่ loading skeleton

---

## [2026-08-17] — UI: อพยพโมดัล member ที่เหลือ 3 ตัว (MyOrders/OrderDetail/UploadSlip) เข้า ui/Modal + ช่องกรองวันที่เข้า filterCls — MODAL_ADOPTED ครบ 9 ตัว

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **MyOrdersModal** (frontend) | shell เขียนเอง (fixed inset-0 + หัว gradient) → `<Modal title widthClassName="sm:max-w-3xl">` — ปุ่ม "ลองใหม่" ของ EmptyState error → `<Button variant="secondary">`; ประวัติ/โหลด/ว่าง เหมือนเดิม |
| **OrderDetailModal** (frontend) | shell → `<Modal>` — หัว 2 บรรทัด (ออเดอร์ #id + เวลา) คงไว้ผ่าน slot `title` (ReactNode) — สลิป/สถานะ/ปุ่มยกเลิกเหมือนเดิม |
| **UploadSlipModal** (frontend) | shell → `<Modal title={\`ส่งสลิปใหม่ — ออเดอร์ #id\`}>` — ต่างเล็กน้อย: ปุ่มปิด X ไม่มี disabled ระหว่างอัปโหลด (Modal กลางไม่มี prop นี้ — อัปโหลดเร็ว พอยอมรับได้) |
| **Modal** (frontend) | title h3 เพิ่ม `font-display` (Prompt) — หัวโมดัลทั้งหมด (staff + member) เป็นฟอนต์หัวข้อภาษาเดียวกับทั้งแอป |
| **filterCls** (frontend) | เพิ่ม `filterCls` ใน `ui/fieldStyles` (พื้นขาว + เงา — ช่องกรองวันที่/ค้นหา ต่างจาก inputCls ฟอร์ม brand-bg) — อพยพช่อง month ของ Summary + ช่วงวันที่ของ AccountingSummary (เดิม copy string ซ้ำกันเป๊ะ 2 ไฟล์) |
| **เทส contract** (frontend) | `MODAL_ADOPTED` +3 (MyOrders/OrderDetail/UploadSlip — รวม 9 ตัว ห้าม shell fixed inset-0 เขียนเอง); เทสใหม่: Modal title ต้องมี font-display; section ใหม่: Summary/AccountingSummary ต้อง import filterCls + ห้ามเขียนช่องกรองวันที่เอง — contract **47 ตัว** |

### 🧪 เทส
- frontend: **154 เทสผ่าน** (137 + 17 component — contract 47 ตัว) + `typecheck` + `build` ผ่าน

**ผลสแกน NON-ADOPTED — ที่ตั้งใจไม่แตะ:** หัวกล่องพับ/กางได้ `Section.tsx` (การ์ดหัวข้อ w-full rounded-3xl — ไม่ใช่โมดัล), lightbox `PhotoLightbox`/preview ใบเสร็จ ReceiptPage (ตัวแสดงภาพเต็มจอ — คนละ pattern), แผงด้านข้าง CartPanel ×2 (workspace panel ไม่ใช่ modal), FAB, input เฉพาะบริบท (แก้ราคาในตาราง POS `px-2 py-1` / ช่องค้นหา / file input hidden — ไม่ใช่ช่องฟอร์มมาตรฐาน)

---

## [2026-08-17] — UI: สแกนปุ่ม NON-ADOPTED ครบ — อพยพ 5 จุด (AccountingSummary/MemberGroupsPanel + ปุ่ม bg-brand ทึบใน ADOPTED ที่กฎเดิมจับไม่ถึง) + กฎ flat-brand ใหม่

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **AccountingSummary** (frontend) | ปุ่ม "Export Excel" (outline เขียนเอง — สแกน NON-ADOPTED เจอ) → `<Button variant="secondary">` — +เข้า `BUTTON_ADOPTED` |
| **MemberGroupsPanel** (frontend) | ปุ่ม "เพิ่มกฎ" (bg-brand ทึบ flat เขียนเอง) → `<Button>` primary — +เข้า `BUTTON_ADOPTED` |
| **ปุ่ม bg-brand ทึบในไฟล์ ADOPTED** (frontend) | กฎเดิมจับแค่ gradient/สีทึบ 50/outline — **สี custom bg-brand (flat) หลุดได้**: pos CartPanel "ค้นหา"/"ใช้โค้ด" (loading spinner จาก `loading` prop แทนข้อความ '...'), Settings "ค้นหา" → `<Button>` primary ครบ |
| **เทส contract** (frontend) | กฎใหม่: ไล่ทุก `<button>` ใน BUTTON_ADOPTED ว่ามี `bg-brand` + `text-white` (flat primary เขียนเอง) — **ยกเว้น FAB ลอย (fixed)** เช่น ปุ่ม "รายการรับของ" มือถือของ Inventory — BUTTON_ADOPTED 27 ไฟล์ — contract **44 ตัว** |

### 🧪 เทส
- frontend: **151 เทสผ่าน** (134 + 17 component — contract 44 ตัว) + `typecheck` + `build` ผ่าน

**ผลสแกน NON-ADOPTED — ที่ตั้งใจไม่แตะ:** FAB กลม POS/PreOrder (gradient — exception เดิม), หัวกล่องพับเก็บ/กางได้ `Section.tsx` (การ์ดหัวข้อ w-full rounded-3xl — ไม่ใช่ปุ่ม action), ปุ่มลอยมือถือ "รายการรับของ" Inventory (fixed — กฎใหม่ยกเว้นให้)

---

## [2026-08-17] — UI: ปุ่ม outline ขาว (bg-white border) เข้า Button ครบ — secondary (แบรนด์) + variant ใหม่ outline-danger (แดง quiet) + ล็อก contract (commit `41fa1a8`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Button** (frontend) | เพิ่ม variant `outline-danger` (bg-white border-red-200 text-red-600 hover:bg-red-50 — อันตรายแบบ quiet ไม่ทึบ); `secondary` (แบรนด์ outline) ที่มีอยู่แล้ว = ตัว outline กลาง |
| **Settings** (frontend) | ปุ่ม X "ปฏิเสธคำขอรีเซ็ตรหัส" (แดง outline เขียนเอง) → `<Button variant="outline-danger">`; ปุ่ม export Excel (เขียว) + CSV (แบรนด์) → `<Button variant="secondary">` ทั้งคู่ — คู่ปุ่ม export หน้าตาเดียวกัน (Excel สูญเสียสีเขียว — standardize ตั้งใจ) |
| **pos CartPanel** (frontend) | ปุ่มเงินลัด ฿10/20/50/100/500 (outline เขียนเอง 5 จุด) → `<Button variant="secondary" size="sm">` — คู่กับ "พอดี" (success) ที่ย้ายรอบก่อน |
| **preorder CartPanel** (frontend) | ปุ่ม "สลับไปใช้บัญชีสมาชิก" (outline เขียนเอง) → `<Button variant="secondary" size="sm" className="w-full">` |
| **เทส contract** (frontend) | กฎปุ่มใหม่: ไล่ className ทุก `<button>` ใน BUTTON_ADOPTED ว่ามี `bg-white border` (outline เขียนเอง) — probe ยืนยันจับ className เก่าทั้ง 4 แบบ + ไม่โดน input (`<input>` ไม่ใช่ button) / border-2 / ไอคอนปุ่ม; เทสล็อก `outline-danger` ต้องมีใน Button — contract **43 ตัว** |

### 🧪 เทส
- frontend: **150 เทสผ่าน** (133 + 17 component — contract 43 ตัว) + `typecheck` + `build` ผ่าน

---

## [2026-08-17] — test(ui): กฎปุ่ม contract จับปุ่มสีทึบ (bg-{สี}-50 + border) ใน BUTTON_ADOPTED — ปิดช่องโหว่ที่กฎ gradient มองไม่เห็น + อพยพปุ่ม "พอดี" (pos CartPanel) ที่โดนกฎใหม่ (commit `41fa1a8`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **เทส contract** (frontend) | กฎปุ่มใหม่: ไล่ className ของทุก `<button>` ใน `BUTTON_ADOPTED` (25 ไฟล์) ว่ามี `bg-{สี}-50` ตามด้วย `border` (สีพื้นอ่อน + ขอบ = signature ปุ่มสีทึบเขียนเอง) — กฎเดิมจับแค่ gradient ไล่พบปุ่มหลุดจริง 3 จุด (OrderManagement "ดูสลิป" ×2 — แก้รอบก่อน — + pos CartPanel "พอดี") — **ไม่จับเท็จบวก**: toggle วิธีจ่าย QR (`bg-blue-50 text-blue-700` ไม่มี border ตามหลัง), ไอคอนปุ่ม (`hover:bg-*-50`), ปุ่ม outline ขาว (`bg-white border`) |
| **pos CartPanel** (frontend) | ปุ่ม "พอดี" (จ่ายพอดีไม่ปัดขึ้น — เดิม bg-emerald-50 เขียนเอง) → `<Button variant="success" size="sm" className="flex-1 min-w-[40px]">` — โทนเขียวเท่าเดิม (ไล่มาทาง hover เดิม) รูปทรงปุ่มมาตรฐาน |

### 🧪 เทส
- frontend: **148 เทสผ่าน** (131 + 17 component — contract 41 ตัว) + `typecheck` + `build` ผ่าน — probe ยืนยัน: กฎใหม่จับ className เก่าของปุ่มทั้ง 2 ไฟล์ได้จริง + ไม่จับ QR toggle/icon hover

---

## [2026-08-17] — UI: InlineAlert เพิ่ม tone info (น้ำเงิน) — อพยพกล่องวิธีใช้ปิดกะ (CloseShiftModal) + ปุ่ม "ดูสลิป" สีทึบที่หลุดจากรอบปุ่ม 2 จุด (OrderManagement) (commit `41fa1a8`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **InlineAlert** (frontend) | เพิ่ม `tone="info"` (น้ำเงิน — `bg-blue-50 border-blue-200 text-blue-700`) สำหรับข้อมูล/วิธีใช้ |
| **CloseShiftModal** (frontend) | กล่อง "📋 วิธีนับเงินปิดกะ" (bg-blue-50 เขียนเอง) → `<InlineAlert tone="info" size="sm">` — เนื้อหา/รายการวิธีใช้คงเดิม |
| **OrderManagement** (frontend) | ปุ่มสีทึบเขียนเอง 2 จุดที่กฎ gradient มองไม่เห็น (ไม่มี gradient — พ้นกฎเดิม): "ดูสลิป & ตรวจสอบ" (ฟ้า) → `<Button variant="info">` · "ดูสลิปเดิม & รับสลิปใหม่" (แดง) → `<Button variant="danger">` — ครอบครัวเดียวกับปุ่มในโมดัลรายละเอียดที่ใช้ variant เดิมอยู่แล้ว (สีเปลี่ยนจากฟ้าอ่อนเป็น gradient ฟ้าเข้ม/แดงเข้ม — ตามมาตรฐานปุ่ม) |
| **เทส contract** (frontend) | `uiConsistencyContract` — `INLINE_ALERT_ADOPTED` +CloseShiftModal (5 ไฟล์) + เทสล็อก `tone="info"` ต้องมีใน InlineAlert — contract **40 ตัว** |

### 🧪 เทส
- frontend: **147 เทสผ่าน** (130 + 17 component — contract 40 ตัว) + `typecheck` + `build` ผ่าน

**ที่ตั้งใจไม่แตะ (ข้อยกเว้น — เป็นพื้นผิว/ข้อมูล ไม่ใช่ alert):** แผง QR payment ของ CartPanel ×2 (bg-blue-50 + QR code + ปุ่มอัปโหลดสลิป — เป็นพื้นที่ชำระเงินที่ต้องจัด layout เอง ไม่ใช่กล่องแจ้งเตือน), กล่อง "เงินที่นำมา" ใน PendingShiftClosesWidget + แถว shift ใน DetailModal (bg-blue-50 — เป็นบล็อกข้อมูลตัวเลข), แผงฟอร์มสีฟ้าใน Settings (ตั้งเจ้าของผลงาน/BOGO), badge แหล่งที่มา (Attendance/Settings "จอง"/Summary role) + PENDING_VERIFY ใน StatusBadge + สีพนักงาน Schedules (เป็น status pill — map สีกลางอยู่แล้ว), แถบความแข็งแรงรหัสผ่าน (สีระดับ)

---

## [2026-08-17] — UI: แถบ amber ใต้หัวโมดัล ChangePasswordModal เข้า InlineAlert variant strip — ปิด exception ที่เคยบันทึกไว้ในรอบก่อน (commit `50a0a61`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **InlineAlert** (frontend) | เพิ่ม `variant` `'box' | 'strip'` — strip = `border-b` เต็มความกว้าง ไม่มน (px-5 py-2 text-xs) สำหรับแถบใต้หัวโมดัล |
| **ChangePasswordModal** (frontend) | แถบเตือน "บัญชีนี้ใช้รหัสผ่านชั่วคราวอยู่..." (เดิม `<p>` เขียน `bg-amber-50 border-b` เอง) → `<InlineAlert tone="warning" variant="strip">` — รูปทรงเดิม (เต็มความกว้าง ไม่มน) สีอักษร/ขอบ normalize เข้ามาตรฐาน warning (amber-700/200 แทน 600/100) — **ปิด exception ที่บันทึกไว้ใน entry ก่อนหน้า** |
| **เทส contract** (frontend) | `uiConsistencyContract` — `INLINE_ALERT_ADOPTED` +ChangePasswordModal (4 ไฟล์) + กฎใหม่ห้าม `bg-amber-50 border-b` เขียนเอง (จับ strip) + เทสล็อก `variant="strip"` ต้องมีใน InlineAlert — contract **39 ตัว** |

### 🧪 เทส
- frontend: **146 เทสผ่าน** (129 + 17 component — contract 39 ตัว) + `typecheck` + `build` ผ่าน

**ที่ตั้งใจไม่แตะ (เหลือ — คนละ anatomy):** กล่องแดง/เหลืองที่แสดงข้อมูลโดเมน (เหตุผลปฏิเสธสลิป / จำนวนเงินส่วนต่างกะ / โซนอันตราย Settings / แบนเนอร์สลิปถูกปฏิเสธที่แถบบน Layout — เป็นเนื้อหาข้อมูล ไม่ใช่ alert)

---

## [2026-08-17] — UI: กล่องแจ้งเตือนเล็กในฟอร์ม/หน้า (error/warning) รวมเข้า InlineAlert กลาง — Login/Register/Dashboard ไม่เขียน bg-red-50/amber-50 เองอีก (commit `50a0a61`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **InlineAlert** (frontend — ไฟล์ใหม่) | สร้าง `components/ui/InlineAlert.tsx` — กล่องแจ้งเตือนเล็กที่อยู่กับฟอร์ม/เนื้อหา (ต่างจาก EmptyState = กล่องใหญ่กลางหน้าสำหรับ "ไม่มีข้อมูล"): tone `error` (แดง) / `warning` (เหลือง) + ขนาด `sm` (แถบเล็ก rounded-xl) / `md` (กล่องฟอร์ม rounded-2xl) + `className` ต่อท้ายได้ |
| **Login** (frontend) | กล่อง error ข้อความตอน submit (bg-red-50 เขียนเอง) → `<InlineAlert tone="error">`; กล่อง rate limit + countdown (amber) → `<InlineAlert tone="warning" className="text-center">` — หน้าตาเดิมเป๊ะ |
| **Register** (frontend) | ข้อความ error ในฟอร์มสมัคร (เดิม `<p>` แดงลอย) → `<InlineAlert tone="error" size="sm">` — เล็กขึ้นเป็นกล่องตามมาตรฐานเดียวกับ Login |
| **Dashboard** (frontend) | แบนเนอร์เตือน "บางข้อมูลโหลดไม่สำเร็จ" (amber เขียนเอง) → `<InlineAlert tone="warning" size="sm" className="max-w-7xl mx-auto mb-4">` — หน้าตา/ตำแหน่งเดิมเป๊ะ |
| **เทส contract** (frontend) | `uiConsistencyContract` +**section ใหม่ (2 เช็ค)**: `INLINE_ALERT_ADOPTED` 3 ไฟล์ (Login/Register/Dashboard) ต้อง import `ui/InlineAlert` + **ห้าม `bg-red-50 border` / `bg-amber-50 border` เขียนเอง** — กันใครเขียนกล่อง alert เองกลับมา |

### 🧪 เทส
- frontend: **145 เทสผ่าน** (128 + 17 component — contract 37 ตัว) + `typecheck` + `build` ผ่าน

**ที่ตั้งใจไม่แตะ (ข้อยกเว้น — คนละ anatomy):** แถบ amber ใต้หัวโมดัล ChangePasswordModal (px-5 border-b เต็มความกว้าง ไม่ใช่กล่องมน), กล่องแดง/เหลืองที่แสดงข้อมูลโดเมน (เหตุผลปฏิเสธสลิป / จำนวนเงินส่วนต่างกะ / โซนอันตราย Settings — เป็นเนื้อหาข้อมูล ไม่ใช่ alert)

---

## [2026-08-17] — UI: fetch error path ทุกหน้าโชว์ผ่าน EmptyState tone="error" — อพยพกล่อง error เขียนเอง (Register) + แก้ 4 หน้าที่กลืน error แล้วโชว์ "ไม่มีข้อมูล" หลอก (Notifications/VendorSales/Inventory/Schedules) (commit `d4c6ba0`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Register** (frontend) | การ์ด error เขียนเอง ("เกิดข้อผิดพลาด" แดง + ข้อความเทา) → `<EmptyState tone="error">` — หน้าตามาตรฐานเดียวกับ RewardModal/MyOrdersModal |
| **Notifications** (frontend) | เดิม fetch พัง → `catch` กลืน แล้วโชว์ "ไม่มีการแจ้งเตือน" หลอกผู้ใช้ → เพิ่ม error state + `<EmptyState tone="error">` + ปุ่ม "ลองใหม่" (fetchNotifications) — เงื่อนไขโชว์เฉพาะ error && ยังไม่มีข้อมูล (มีข้อมูลเก่า = โชว์ต่อ) |
| **VendorSales** (frontend) | เดิม fetch พัง → โชว์ "ยังไม่มีสินค้าฝากขาย" → error state + `<EmptyState tone="error">` + ปุ่ม "ลองใหม่" (fetchData) — error มาก่อน empty state |
| **Inventory** (frontend) | เดิมดึงสินค้าพัง → แผงซ้ายว่างเปล่าเงียบๆ → error state ในแผงสินค้า + `<EmptyState compact tone="error">` + ปุ่ม "ลองใหม่" (fetchProducts) — socket refetch สำเร็จก็หายเอง |
| **Schedules** (frontend) | เดิม fetch กะ/พนักงาน/วันหยุดพัง → ปฏิทินว่าง → error state แทนตารางปฏิทิน (เดือนเปลี่ยนยังได้ — ปุ่มนำทางอยู่) + `<EmptyState tone="error">` + ปุ่ม "ลองใหม่" (fetchAll) |
| **เทส contract** (frontend) | `uiConsistencyContract` +**section ใหม่ (2 เช็ค)**: `FETCH_ERROR_ADOPTED` 7 ไฟล์ (RewardModal/MyOrdersModal/Register/Notifications/VendorSales/Inventory/Schedules) ต้องมี `<EmptyState tone="error">` จริง + ไฟล์ที่ fetch เองต้องมี error state (`setError` ใน catch — ห้ามกลืน error แล้วโชว์ว่าง); `EMPTY_ADOPTED` +Register/Schedules (รวม 18 ไฟล์) |

### 🧪 เทส
- frontend: **143 เทสผ่าน** (126 + 17 component — contract 35 ตัว) + `typecheck` + `build` ผ่าน

**ที่ตั้งใจไม่แตะ (ข้อยกเว้น — คนละบริบท ไม่ใช่ data-fetch error state):** กล่อง error ในฟอร์ม Login/Register (ข้อความตอน submit — ต้องเล็กอยู่ในฟอร์ม ไม่ใช่ EmptyState กลาง), แบนเนอร์เตือน Dashboard "บางข้อมูลโหลดไม่สำเร็จ" (amber warning ใต้แถบหัว — ไม่ใช่ error state), `ErrorBoundary` (React crash ทั้งหน้า), `PhotoLightbox`/`AuthImage` fallback (รูปโหลดไม่ขึ้นในตัวแสดงภาพ), `Swal.fire` toast error (แจ้งเตือนชั่วคราวคนละ pattern)

---

## [2026-08-17] — refactor(backend): รวม error response ซ้ำ 146 จุดเข้า sendError/serverError + SQL ซ้ำ 14 จุดเข้า queries.js — helper กลางที่เดียว (commit `4002fdb`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Restart backend เท่านั้น** — ไม่มี SQL/env/logic เปลี่ยน เป็น refactor โค้ดล้วน (error JSON/ข้อความ/สถานะเดิมเป๊ะ ไม่กระทบ client)

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **utils/http.js** (backend — ไฟล์ใหม่) | helper กลาง: `sendError(res, status, msg, details)` · `serverError(res)` (500 ข้อความกลาง) · `badRequest` · `notFound` — แทน `res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ...' })` ที่ copy ซ้ำกันเป๊ะ **146 จุด** (server.js 96 + 7 controllers 50) — error JSON ที่ส่งกลับเหมือนเดิมเป๊ะ |
| **utils/queries.js** (backend — ไฟล์ใหม่) | query ที่ copy string ซ้ำหลายจุด → helper เดียว **14 call site**: `getOrderItems` (6) · `getUserFullName` (3) · `getUserRole` (3) · `lockUserPoints` (2 — FOR UPDATE ต้องเรียกใน transaction) — กันแก้คอลัมน์ทีละจุดแล้วที่อื่นเพี้ยน |
| **เทส contract** (backend) | `serverGuardRails` +**section G (6 เช็ค)**: ห้าม `res.status(500).json` เขียนเองทั่ว src/ + server.js (ต้องผ่าน `serverError`); +**section H (9 เช็ค)**: query ที่รวมแล้วต้องเรียกผ่าน queries.js — **49 เช็คผ่าน** |

### 🧪 เทส
- backend: `npm run test:unit` — **12/12 ชุดผ่าน** (serverGuardRails 49 เช็ค) + `node --check` syntax ผ่านทุกไฟล์ที่แก้

---

## [2026-08-17] — refactor(backend): รวม requireRole/validateRequest เข้า middleware/guards.js ที่เดียว — ลบ copy ซ้ำ 4 จุด (commit `95a853c`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Restart backend เท่านั้น** — ไม่มี SQL/env/logic เปลี่ยน เป็น refactor โค้ดล้วน (พฤติกรรม/ข้อความ error เดิมเป๊ะ — guards.js ถูกยกมาจาก server.js ตัวต่อตัว)

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **guards.js** (backend) | `requireRole` + `validateRequest` รวมไว้ที่ `src/middleware/guards.js` เป็นที่เดียวของแอป — **server.js** (เดิมนิยามเอง 2 ตัว ใช้ 84 จุด) + **adminRoutes/reportRoutes/memberRoutes** (เดิม copy `requireRole` กันเองคนละไฟล์ เพราะของ server.js เรียกข้ามไฟล์ไม่ได้) + **memberRoutes** copy `validateBody` → ทั้งหมด import จาก guards.js; ลบ local definition ทิ้ง |
| **เทส contract** (backend) | `serverGuardRails` +**section F (9 เช็ค)**: server.js/routes ต้องไม่นิยาม guards ซ้ำ (ไล่ทั่ว src/), router ทุกไฟล์ที่ใช้ต้อง import จาก middleware/guards, พฤติกรรมล็อก (403 ข้อความมาตรฐาน / 400 Validation failed + details / sanitize req.body) — 34 เช็คผ่าน |

### 🧪 เทส
- backend: `npm run test:unit` — **12/12 ชุดผ่าน** (serverGuardRails 34 เช็ค + undefinedIdentifiers ไล่ identifier ใหม่ครบ)

---

## [2026-08-17] — UI: empty state เข้า EmptyState กลางใน 3 หน้าที่เหลือ (Dashboard/Attendance/Settings) + label ของ Settings เข้า FieldLabel (commit `c89746c`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Dashboard** (frontend) | empty state เขียนเอง 6 จุดในแผงรายละเอียด (ยังไม่มียอดขาย/ยังไม่มีข้อมูลพนักงาน/ฝากขาย/ออเดอร์ค้าง/สินค้าค้างสต๊อก/ตารางเวลา) → `<EmptyState compact>` (ไอคอนตามหัวแผง) |
| **Attendance** (frontend) | "ไม่พบข้อมูล" มือถือ → `<EmptyState compact>`; แถวว่างตาราง desktop ลด `text-sm` ให้ตรง precedent ของ OrderManagement (`text-center text-gray-400`) |
| **Settings** (frontend) | empty state 4 จุด (ประวัติขายมือถือ / โปรโมชั่น / คำขอรีเซ็ตรหัสผ่าน + ทีหลัง) → `<EmptyState compact>`; **label ฟอร์มทั้งหมด** — `Input` component ท้องถิ่น (ใช้ทุกแท็บ ~20 จุด) + label น้ำเงิน BOGO ×2 → `FieldLabel` กลาง (BOGO คงสีน้ำเงินผ่าน `!text-blue-800 !font-bold`) |
| **เทส contract** (frontend) | `uiConsistencyContract` — `EMPTY_ADOPTED` +3 หน้า (Dashboard/AttendanceManagement/Settings — รวม 16 ไฟล์ห้าม empty state เขียนเอง), `LABEL_ADOPTED` +Settings (13 ไฟล์) |

### 🧪 เทส
- frontend: **141 เทสผ่าน** (124 + 17 component — contract 33 ตัว) + `typecheck` + `build` ผ่าน

**ที่ตั้งใจไม่แตะ (ข้อยกเว้น):** badge สถานะ = ป้าย **role** (Home/Profile badge "พนักงาน", Settings ROLE_BADGE) + ป้าย เปิด/ปิดใช้งานของสินค้า — StatusBadge กลางเป็น map สถานะ **ออเดอร์** โดยเฉพาะ ไม่ใช่ role/สถานะเปิดปิด (คนละโดเมน); แถวว่างใน `<td>` ของตารางยังเป็นข้อความตาม precedent (EmptyState ใส่ในตารางไม่ได้)

---

## [2026-08-17] — UI: ล็อก FAB กลมให้เป็นมาตรฐานเดียว (contract กัน FAB หน้าใหม่เพี้ยน) (commit `13e59a2`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **FAB 3 จุด** (frontend) | จัดลำดับ class ของ PreOrder/MobileBottomNav ให้ตรงกับ POS (เรียง core เดียวกัน — CSS ไม่สนใจลำดับ class = ไม่มีผลภาพ) |
| **เทส contract** (frontend) | `uiConsistencyContract` — กฎ whole-app เข้มขึ้น: `<button>` gradient เหลือได้เฉพาะ **FAB กลมมาตรฐานเดียว** (`FAB_CORE` = w-14 h-14 + `bg-gradient-to-br from-brand to-brand-dark` + text-white + rounded-full + shadow-lg + flex center — ตรงเป๊ะทั้งสี/ขนาด/ลำดับ) + เทสใหม่ยืนยัน **FAB ครบ 3 จุด** (POS/PreOrder/MobileBottomNav) ว่ามี signature อยู่จริง — กันใครแก้ FAB เป็นสี/ขนาดอื่นหรือเพิ่ม FAB ใหม่เพี้ยน |

### 🧪 เทส
- frontend: **141 เทสผ่าน** (124 + 17 component — contract 33 ตัว) + `typecheck` + `build` ผ่าน

---

## [2026-08-17] — UI: ปุ่มชำระเงินสีตามวิธีจ่ายเข้า Button (payment-cash/payment-qr) + สแกนทั้งแอปกำจัด <button> gradient เหลือ (commit `7500f15`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Button** (frontend) | เพิ่ม variant `payment-cash` (ชมพูแบรนด์ — เงินสด) + `payment-qr` (น้ำเงิน — QR) สำหรับปุ่มชำระเงิน + `reward` (amber — แลกของรางวัล) |
| **ปุ่มชำระเงิน** (frontend) | checkout POS + PreOrder (เดิม `<button>` สลับสีตามวิธีจ่าย + disabled เป็นเทา) → `<Button variant={QR ? payment-qr : payment-cash}>` — สี/ข้อความ/loading เดิม, disabled เป็นมาตรฐาน opacity-fade ของ Button |
| **สแกนทั้งแอป** (frontend) | เทส whole-app ไล่ทุก `<button>` ว่ามี `bg-gradient-to-br` — ไล่พบปุ่มที่หลุดจากกฎเก่าอีก **8 จุด** อพยพครบ: pos CartPanel "แลกของรางวัล" (amber), ChangePasswordModal submit, PendingShiftClosesWidget อนุมัติ/ปฏิเสธ, Layout "ส่งสลิปใหม่", MyOrdersModal "ส่งสลิปใหม่", Schedules บันทึกกะ — เหลือ `<button>` gradient ในแอปแค่ **FAB กลม 3 จุด** (POS/PreOrder/MobileBottomNav — w-14 h-14 rounded-full) ที่เป็น exception โดยตั้งใจ |
| **เทส contract** (frontend) | `uiConsistencyContract` — Button ต้องมี payment-cash/payment-qr/reward (ล็อกสีไม่ให้เพี้ยน); +7 ไฟล์ใน `BUTTON_ADOPTED` (CartPanel ×2/ChangePasswordModal/PendingShiftClosesWidget/Layout/MyOrdersModal/Schedules — รวม 25 ไฟล์ห้าม gradient button เขียนเอง); กฎใหม่ทั้งแอป: `<button>` gradient เหลือได้เฉพาะ FAB กลม (w-14 h-14 + rounded-full) |

### 🧪 เทส
- frontend: **140 เทสผ่าน** (123 + 17 component — contract 32 ตัว) + `typecheck` + `build` ผ่าน

---

## [2026-08-17] — UI: ปุ่มสีตามสถานะรวมเข้า Button (variant warning/success/purple/orange/info) + loading state เข้า Skeleton + contract เข้มขึ้น (commit `137ecc0`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Button** (frontend) | เพิ่ม variant สีตามสถานะ: `warning` (เหลือง — ขอสลิปใหม่/รับงาน), `success` (เขียว — พร้อมรับ), `purple` (ม่วง — คืนเงิน/ปิดบิล), `orange` (ส้ม — ยืนยันเงินสด), `info` (น้ำเงิน — ตรวจสลิป) — ปุ่มสถานะทั้งหมดออกจาก `<button>` เขียนเอง |
| **OrderManagement** (frontend) | ปุ่ม gradient เขียนเอง 9 จุด (รับงาน/ยืนยันสลิป/ขอสลิปใหม่/คืนเงิน/ยกเลิก/ตรวจสลิปใหม่/ยืนยันเงินสด/พร้อมรับ/ปิดบิล) → `<Button>` variant เดียวกัน — สี/ความหมายเดิม (บางปุ่มโค้งมน sm แทน rounded-xl เล็กน้อย) |
| **ปุ่มอันตรายอื่นๆ** (frontend) | Settings "ยกเลิกบิล (Void)", Home "ส่งสลิปด่วน", OrderDetailModal "ยกเลิกออเดอร์" (spinner เข้า `loading` ของ Button), ForgotPassword submit (disabled/enabled class เขียนเอง → `disabled` + `loading` ในตัว), CloseShiftModal (จากรอบก่อน) → `<Button variant="danger">`/primary |
| **Loading state** (frontend) | ข้อความ "กำลังโหลด..." (py-10 text-gray-400) ใน RewardModal/LoyaltySettingsPanel/MemberGroupsPanel → `SkeletonLine` กลาง; RewardModal ยังอพยพ error → `<EmptyState tone="error">` + ว่าง → `<EmptyState>` (เดิมเขียน py-12 flex-col เอง) |
| **เทส contract** (frontend) | `uiConsistencyContract` — กฎปุ่ม gradient **เข้มขึ้น**: ไล่ทุก `<button>` ดู 400 ตัวอักษรถัดไปว่ามี `bg-gradient-to-br` (จับ tag หลายบรรทัด + gradient สีอื่นที่ไม่ใช่แบรนด์ — ไล่พบอีก 3 จุดที่หลุด: Home/ForgotPassword/OrderDetailModal) + `SKELETON_ADOPTED` +3 ไฟล์ + `EMPTY_ADOPTED` +RewardModal; `pageHeaderContract` — icon ต้อง required (`icon: LucideIcon` ห้าม `icon?`) + ทุก `<PageHeader>` ต้องส่ง icon |

### 🧪 เทส
- frontend: **138 เทสผ่าน** (121 + 17 component — contract 30 ตัว) + `typecheck` + `build` ผ่าน

---

## [2026-08-17] — UI: อพยพแถบหัว POS/PreOrder/Notifications เข้า PageHeader + ปุ่ม CloseShift/Notifications เข้า Button — แถบหัวหน้าเขียนเองหมดทั้งแอป (commit `137ecc0`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **PageHeader** (frontend) | เพิ่ม slot `titleClassName` (คลาสต่อท้าย title — หน้า member ใช้ `font-display` Prompt คงเดิม) — anatomy/layout ไม่เปลี่ยน |
| **POS** (frontend) | แถบหัวที่เขียนเอง (ต้นฉบับที่เอามาทำ PageHeader) → `<PageHeader icon={ShoppingCart} title="POS ขายสินค้า">` — ชื่อพนักงานฝั่งขวาย้ายเข้า slot `actions` หน้าตา/เงื่อนไขโชว์เหมือนเดิมเป๊ะ |
| **PreOrder** (frontend) | แถบหัว → `<PageHeader>` + `className="awning-edge"` (ชายคาหยักคงเดิม) + `titleClassName="font-display"` + ปุ่ม "ประวัติของฉัน" ผ่าน `actions` |
| **Notifications** (frontend) | แถบหัว sticky + ชายคาหยัก + ตัวนับ "ยังไม่อ่าน"/ปุ่ม "อ่านทั้งหมด" → `<PageHeader>` (sticky/awning ผ่าน `className`, ปุ่มผ่าน `actions`) |
| **ปุ่ม** (frontend) | CloseShiftModal "ยืนยันการปิดกะ" (แดง gradient เขียนเอง) → `<Button variant="danger">`; Notifications "ส่งสลิปใหม่" → `<Button variant="danger" size="sm">` |
| **เทส contract** (frontend) | `pageHeaderContract` +POS/PreOrder/Notifications ใน `HEADER_ADOPTED` (**15 หน้า**) + กฎใหม่ทั้ง src: **ห้ามแถบหัวหน้าเขียนเอง (`bg-gradient-to-r from-brand` + `px-4 py-3.5`) นอก PageHeader** — header แผง/การ์ด py-3 ยังได้ (CartPanel/Inventory receive panel); `uiConsistencyContract` +Notifications ใน `BUTTON_ADOPTED` |

### 🧪 เทส
- frontend: **136 เทสผ่าน** (119 + 17 component — contract 28 ตัว) + `typecheck` + `build` ผ่าน

**ที่ตั้งใจไม่แตะ (ข้อยกเว้น — เป็นองค์ประกอบเฉพาะ ไม่ใช่แถบหัวหน้า):** header แผง CartPanel ×2 / Inventory receive panel (py-3), drawer MobileMenuDrawer (py-4), การ์ด Register member card / PendingShiftClosesWidget, แบนเนอร์โปร pos/ProductGrid + PromoPopularRow, hero Home (awing ใหญ่ ไม่ใช่แถบ), FAB กลม (POS/PreOrder/Inventory/MobileBottomNav), ปุ่มสถานะสีของ OrderManagement (เหลือง/ม่วง/เขียว — สีสื่อสถานะเหมือนปุ่ม checkout ตามวิธีจ่าย), ปุ่ม export เขียว/เทาของ Settings

---

## [2026-08-17] — UI: อพยพ Inventory (หน้าคลังสุดท้าย) เข้า PageHeader + EmptyState — ครบทุกหน้า staff (commit `137ecc0`)

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **Inventory** (frontend) | แถบหัวที่เขียนเอง (gradient + icon box + title) → `<PageHeader icon={Boxes}>` เต็มความกว้าง; ช่องค้นหาที่ย้ายจากแถบ gradient ออกมาเป็นกล่องขาวใต้แถบหัว (แบบเดียวกับ OrderManagement); แผงรับของฝั่งขวายังเป็น 2 แผง workspace เดิม (header แผง `py-3` คงไว้ — เป็น panel header ไม่ใช่หน้า) |
| **Inventory — empty state** (frontend) | กล่อง "ยังไม่มีรายการ" ในแผงรับของ → `<EmptyState compact>` (เลือกสินค้าจากด้านซ้าย / เพื่อนำเข้าคลัง) |
| **Inventory — พื้นหลัง** (frontend) | `bg-gray-50` → `bg-brand-bg` (ครอบครัวเดียวกับทั้งแอป) |
| **เทส contract** (frontend) | `pageHeaderContract` +Inventory ใน `HEADER_ADOPTED` (12 หน้า); `uiConsistencyContract` +Inventory ใน `EMPTY_ADOPTED` (อยู่ใน `BUTTON_ADOPTED`/`LABEL_ADOPTED` อยู่แล้ว) |

### 🧪 เทส
- frontend: **135 เทสผ่าน** (118 + 17 component — contract 27 ตัว ครอบ 12 หน้า) + `typecheck` + `build` ผ่าน

---

## [2026-08-17] — UI: อพยพหน้า staff ที่เหลือ (Shift/Summary/ReceiptPage) เข้า PageHeader + primitives กลางครบทุกหน้า

### 🔴 สิ่งที่ต้องทำตอน deploy

- **Rebuild frontend เท่านั้น** — visual 100% ไม่มี SQL/env/logic เปลี่ยน ไม่ต้องรันอะไรเอง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **PageHeader** (frontend) | เพิ่ม print override ในตัว (แถบ/icon box/icon/title → ขาว+เทาเมื่อพิมพ์, ปุ่มย้อนกลับ `print:hidden`) — งานพิมพ์ได้แถบไม่กินหมึก ไม่มีผลบนหน้าจอ |
| **Summary** (frontend) | แถบหัวที่เขียนเอง → `<PageHeader>` (print output คงเดิมเป๊ะผ่าน print override ในตัว); empty state เขียนเอง 3 จุด → `<EmptyState compact>` (การ์ดสรุปรายได้/กำไร + ตารางค่าจ้างมือถือ) — แถวว่างในตาราง desktop ยังเป็น `<td>` ตามเดิม (EmptyState ใส่ในตารางไม่ได้) |
| **ReceiptPage** (frontend) | เพิ่มแถบหัว `<PageHeader>` (หน้าใบเสร็จ + หน้า fallback "ไม่พบข้อมูลใบเสร็จ") — `print:hidden` กันแถบไปโผล่ในใบเสร็จที่พิมพ์ |
| **Shift** (frontend) | แถบ brand strip ในกล่องการ์ด → `<PageHeader>` (ชื่อพนักงานเป็น `subtitle`, ปุ่มกลับหน้า Home/สลับบัญชี เป็น `actions`, `shadow-none` กันเงาโผล่ในกล่อง) + ปุ่ม CTA 3 จุด (ลงชื่อเข้า/ออกงาน, เริ่มขาย) → `<Button>` (loading spinner ในตัว) |
| **เทส contract** (frontend) | `pageHeaderContract` +Shift/Summary/ReceiptPage ใน `HEADER_ADOPTED` (11 หน้า); `uiConsistencyContract` +Summary ใน `EMPTY_ADOPTED`/`SKELETON_ADOPTED` +Shift ใน `BUTTON_ADOPTED` |

### 🧪 เทส
- frontend: **135 เทสผ่าน** (118 + 17 component — contract 27 ตัว ครอบ 11 หน้า) + `typecheck` + `build` ผ่าน

---

## [2026-08-17] — security: เคลียร์ vuln ทั้ง 2 ฝั่งเป็น 0 (backend 6→0, frontend 5→0) + รวม Dashboard/OrderManagement เข้า PageHeader/EmptyState (commit `fca6723`)

### 🔴 สิ่งที่ต้องทำตอน deploy

1. **Restart backend + rebuild frontend** — เป็น dependency bump + UI เท่านั้น ไม่มี SQL/env ใหม่ ไม่ต้องรันอะไรเอง
2. **backend deps**: `sharp` 0.33.5 → **0.35.3** (โค้ดใช้แค่ `.metadata()` — API มั่นคง ไม่กระทบ; Node 24 รองรับ) + เพิ่ม `overrides.uuid=^11.1.1` (exceljs ยัง 4.4.0 — ใช้ `uuid.v4` ที่ advisory นี้ไม่กระทบ) + `npm audit fix` ไล่ brace-expansion/ip-address/socket.io-parser → **`npm audit` = 0 vulnerabilities**
3. **frontend deps**: `react-router-dom` 7.18.1 → **7.18.2** (patch — ไม่ใช่ major bump ที่เคยเลื่อนไว้), nanoid/socket.io-parser/brace-expansion audit fix → **0 vulnerabilities**
4. **UI (visual เท่านั้น — ข้อมูล/ลอจิก/ปุ่มไม่แตะ)**: แถบหัว Dashboard + OrderManagement เปลี่ยนเป็น `PageHeader` ตัวกลาง (หน้าเดียวกันทั้งแอป) — health dot/ปุ่มกลับ POS/ชื่อพนักงานของ Dashboard คงเดิม ผ่าน slot ใหม่ `afterTitle`/`actions`; กล่อง "ไม่มีข้อมูล" ของ OrderManagement 4 จุด (รอดำเนินการ/รอสลิป/รอสลิปใหม่/เสร็จแล้ว) ใช้ `EmptyState` กลาง

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **PageHeader** (frontend) | เพิ่ม slot `afterTitle` (เนื้อหาต่อท้าย title ในแถวเดียวกัน — สำหรับ health dot ของ Dashboard) — `subtitle` ยังอยู่ใต้ title เหมือนเดิม |
| **Dashboard** (frontend) | เดิมเขียน anatomy แถบหัวเอง (gradient + icon box + title + health dot + ปุ่มกลับ POS + ชื่อ) → `<PageHeader>` ตัวเดียว: health dot ผ่าน `afterTitle`, ปุ่มกลับ POS + ชื่อ ผ่าน `actions` — หน้าตา/เงื่อนไขโชว์เหมือนเดิมเป๊ะ |
| **OrderManagement** (frontend) | แถบหัว → `<PageHeader>`; empty state เขียนเอง 4 จุด → `<EmptyState>` กลาง (ไอคอนในกล่อง brand-bg แทน CheckCircle ลอย — มาตรฐานเดียวกับทั้งแอป) |
| **deps** (backend) | sharp 0.35.3 + `overrides.uuid=^11.1.1` + audit fix → 0 vuln |
| **deps** (frontend) | react-router-dom 7.18.2 + nanoid/socket.io-parser/brace-expansion patch → 0 vuln |
| **เทส contract** (frontend) | `pageHeaderContract` +8 หน้า (Dashboard/OrderManagement/BackupManagement/AccountingSummary/AttendanceManagement/Schedules/Settings/VendorSales ต้อง import PageHeader + ห้ามแถบ gradient เขียนเอง); `uiConsistencyContract` +OrderManagement ใน `EMPTY_ADOPTED` |

### 🧪 เทส
- backend: `npm run test:unit` — **12/12 ชุดผ่าน** หลัง bump sharp/uuid (รวม exceljs export ตรวจด้วย)
- frontend: **135 เทสผ่าน** (118 + 17 component) + `typecheck` + `build` ผ่าน

---

## [2026-08-17] — perf(backend): แก้ N+1 ใน GET /api/orders + cron pickup reminder + เพิ่ม index orders/sales/audit_logs (commit `f140e5e`)

### 🔴 สิ่งที่ต้องทำตอน deploy

1. **Restart backend เท่านั้น** — index ถูกเพิ่มอัตโนมัติตอน boot (db.js initDB รัน ALTER TABLE ADD INDEX แบบ idempotent — ปลอดภัยรันซ้ำ, ER_DUP_KEYNAME ข้ามเอง) ไม่ต้องรัน SQL เอง
2. **N+1 — GET /api/orders**: เดิมยิง query ทีละออเดอร์ในลูป (ออเดอร์ N ใบ = N query ทุก 5 วิ ที่ OrderManagement poll) → ตอนนี้ดึง items ทั้งหมดครั้งเดียว `IN (...)` + group ใน JS — 1 query เสมอ. พฤติกรรม API เหมือนเดิม (`order.items` เปลี่ยนจาก undefined → `[]` ตอนไม่มีสินค้า — frontend ใช้ `items?.` หมด ปลอดภัย)
3. **N+1 — cron pickup reminder**: เดิม UPDATE ทีละออเดอร์ → batch `IN (...)` ครั้งเดียว
4. **Index ใหม่ 4 ตัว** (ช่วย pending-count, รายงาน, log viewer, cron): `orders (status, created_at)` · `orders (ready_at)` · `sales (status, created_at)` · `audit_logs (user_id, action, created_at)` — schema.sql อัปเดตให้ตรงแล้ว (doc + CI fresh-install)

### 🧪 เทส
- `serverGuardRails` ขยายเป็น **24 เช็ค** (+D N+1 batch, +E index ใน db.js+schema.sql) — probe จับ fail จริง (คืน N+1 → แดง 1 ตัว → คืนเขียว) — runner **12/12 ชุดผ่าน**

---

## [2026-08-17] — fix(backend+frontend): ล่าบัค 4 จุด — แยกลิมิต sync-offline, clamp page/limit audit-logs, โชว์ "—" แทน 0 ปลอม, ลบ dead socket (commit `61e50dd`)

### 🔴 สิ่งที่ต้องทำตอน deploy

1. **Restart backend เท่านั้น** (server.js เปลี่ยน 2 จุด + ลบ dead socket) + rebuild frontend (Home/Dashboard โชว์ "—" แทน 0 ปลอม)
2. **MEDIUM — บิลออฟไลน์หลุดจากลิมิต**: เดิม `/api/sales/sync-offline` ใช้ `checkoutLimiter` ตัวเดียวกับ `/checkout` (30 ครั้ง/นาที prod) — คิวออฟไลน์ replay บิลค้าง >30 ใบหลังเน็ตกลับโดน 429 → queueProcessor retry 3 ครั้งแล้วตัดทิ้งถาวร = บิลหลุดจริง. ตอนนี้แยก `syncOfflineLimiter` (300/นาที prod + `skipFailedRequests`) — ยังกัน DoS อยู่
3. **LOW — `GET /api/audit-logs?page=abc` เคย 500** (offset = NaN เข้า mysql2) + `?limit=100000000` query ยักษ์ — clamp แล้ว (page ≥ 1, limit 1–200)
4. **NIT — Home/Dashboard** เดิม `.catch(() => {})` กลืน error: การ์ดสรุปยอดหายเงียบ/โชว์ "0 ใกล้หมด" หลอก — ตอนนี้โชว์ "—" สำหรับค่าที่โหลดไม่ได้ (Home) + แบนเนอร์ "บางข้อมูลโหลดไม่สำเร็จ" (Dashboard)
5. **NIT — dead code**: `socket.on('request_shift_report')` ถูกลบ (ไม่มีฝั่งไหน listen) — เทส order-realtime ปรับ anchor marker ตาม

### 🧪 เทสใหม่/แก้
- `tests/serverGuardRails.test.js` ใหม่ — ล็อก: sync-offline ใช้ limiter แยก + skipFailedRequests + max > checkout · audit-logs clamp page/limit · ไม่มี dead socket (12 เช็ค, probe จับ fail จริงแล้ว) — ต่อเข้า runner = **12/12 ชุดผ่าน**
- `tests/orderRealtime.test.js` — end marker เปลี่ยนเป็น `socket.on('disconnect'` (comment เดิมถูกลบไปพร้อม dead code)

---

## [2026-08-17] — test(backend): เทส contract ใหม่ undefinedIdentifiers — ไล่ identifier ที่ไม่ได้ประกาศ/ชื่อไม่ตรงทุก call site (server.js + controllers 7 ไฟล์) (commit `439b681`)

### 🔴 สิ่งที่ต้องทำตอน deploy

1. **ไม่ต้องทำอะไร** — เป็นเทสฝั่ง dev เท่านั้น (รันใน `run-all-tests.js`) ไม่กระทบ runtime/DB/env
2. เทสนี้จะจับบัคแบบ `usePhoneForPoints` ReferenceError (commit `6f30e5e`) กลับมาใหม่โดยอัตโนมัติ — ไล่ทั้ง object shorthand `{ a }` และ mapping `{ key: b }` ว่าตัวแปรต้องประกาศจริงในไฟล์นั้น

---

## [2026-08-17] — feat(frontend): รวมการ์ดสินค้า/รูป/ราคาเป็น ProductCard/ProductImage/ProductPrice กลาง (POS + preorder + Home) (commit `bd3e785`)

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Rebuild frontend อย่างเดียวพอ** — ไม่แตะ backend ไม่มี SQL/env ใหม่ ไม่ต้อง restart backend
2. **การ์ดสินค้าหน้าตาเปลี่ยนนิดหน่อย** (ตั้งใจรวมเป็นภาษาเดียว): การ์ดกริด POS + หน้าจอง + แถวโปร/ยอดนิยม + การ์ดยอดขายดีบน Home ใช้คอมโพเนนต์กลางตัวเดียว — โค้งมน 3xl เท่ากัน, ราคา font-display + tabular + ขีดฆ่า, กล่องรูปมี placeholder ตอนไม่มีรูป — logic/ราคาที่คิดจริง/ปุ่มทุกปุ่มไม่แตะ
3. เปลือกการ์ดบางกล่อง (RewardModal ของรางวัล / กลุ่มสมาชิกใน Settings ×2 / กล่องบน Home) ปรับ 2xl → 3xl ให้ตรงมาตรฐาน — ไม่กระทบการใช้งาน

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **ProductCard กลาง** (frontend) | สร้าง `components/ui/ProductCard.tsx` — เดิม POS กับหน้าจองเขียนการ์ดซ้ำ ~150 บรรทัด; รวมเป็นตัวเดียว (แถบ brand บน + รูป + ชื่อ + badge สถานะ + ราคา + chip ส่วนลด/สต๊อก + ปุ่มเพิ่ม + ช่องแก้ราคา POS ผ่าน prop `priceOverrideInput`) |
| **ProductImage/ProductPrice** (frontend) | `ui/ProductImage.tsx` (กล่องรูป + placeholder PackagePlus) + `ui/ProductPrice.tsx` (font-display + tabular + ขีดฆ่า + tone สีตามสถานะ) — อพยพ PromoPopularRow (PriceLine เดิม) + Home การ์ดยอดขายดี |
| **เทส contract** (frontend) | `uiConsistencyContract.test.ts` +4 กฎ: ProductGrid ×2 ต้อง import ProductCard, Home/PromoPopularRow ต้องใช้ ProductImage/ProductPrice, ห้าม `<img w-full h-full object-cover>` เขียนเอง (ยกเว้น avatar Home), ห้ามราคาเขียนเองใน Home — ทดสอบด้วย probe จริงแล้วจับ fail (1 ตัว) |

**Rollback:** revert แล้ว rebuild frontend — ไม่มีผลต่อ data

---

## [2026-08-17] — fix(backend): POST /api/orders 500 ทุกใบ — usePhoneForPoints ReferenceError (commit `6f30e5e`)

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Restart backend อย่างเดียวพอ** — ไม่มี SQL/env ใหม่ ไม่ต้อง rebuild frontend
2. บัคนี้กำลัง active อยู่ (ทุกออเดอร์ — เงินสด/QR — ตก 500) — ควร deploy ทันที

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **server.js** (backend) | `resolveOrderPoints()` ส่ง `usePhoneForPoints` (camelCase) ที่ไม่เคยประกาศ — destructure รับ `use_phone_for_points` (snake_case จาก client) → ReferenceError → 500 ทุกออเดอร์ ตั้งแต่ commit `354dbb3`; แก้โดย mapping `usePhoneForPoints: use_phone_for_points` |
| **preorderPolicy.test.js** (backend) | +1 เทส กฎใหม่: ไล่ identifier bare ใน `resolveOrderPoints({...})` ต้องอยู่ใน `const { ... } = req.body` ของ handler เดียวกัน (จับ pattern call site ที่พัง — เทสเดิมเช็คแค่ `pointsPolicy.usePhoneForPoints` ที่บรรทัดถูกอยู่แล้ว) — ทดสอบแล้ว: revert เป็นเวอร์ชันพัง → เทสแดง → คืน fix → เขียว |

**Rollback:** revert แล้ว restart backend — ไม่มีผลต่อ data

---

## [2026-08-17] — feat(frontend): รวมการ์ดสินค้า/รูป/ราคาเป็น ProductCard/ProductImage/ProductPrice กลาง + ขยายภาษาแบรนด์ไปหน้า member + รวม empty state เป็น EmptyState กลาง (commit `47d09cb`)

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Rebuild frontend อย่างเดียวพอ** — ไม่แตะ backend ไม่มี SQL/env ใหม่ ไม่ต้อง restart backend
2. **ภาษาเดียวกับ Home/PreOrder ไปหน้า member**: Profile/Notifications ได้ชายคาหยักใต้แถบหัว + ชื่อเป็นฟอนต์ Prompt; โมดัลประวัติออเดอร์ (MyOrders/OrderDetail/UploadSlip/CartPanel) ชื่อเป็น Prompt + ยอดรวมเลข tabular — icons/ภาพ/ลอจิกไม่แตะ
3. **Empty state ทั่วแอปเปลี่ยนหน้าตา** (เฉพาะตอน "ไม่มีข้อมูล"): รวม ~14 จุดที่เขียนเองคนละแบบเป็น `EmptyState` (ไอคอนในกล่อง brand-bg + title + hint) — ข้อความ/ความหมายเดิมทุกจุด

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Rebuild frontend อย่างเดียวพอ** — ไม่แตะ backend ไม่มี SQL/env ใหม่ ไม่ต้อง restart backend
2. **ภาษาเดียวกับ Home/PreOrder ไปหน้า member**: Profile/Notifications ได้ชายคาหยักใต้แถบหัว + ชื่อเป็นฟอนต์ Prompt; โมดัลประวัติออเดอร์ (MyOrders/OrderDetail/UploadSlip/CartPanel) ชื่อเป็น Prompt + ยอดรวมเลข tabular — icons/ภาพ/ลอจิกไม่แตะ
3. **Empty state ทั่วแอปเปลี่ยนหน้าตา** (เฉพาะตอน "ไม่มีข้อมูล"): รวม ~14 จุดที่เขียนเองคนละแบบเป็น `EmptyState` (ไอคอนในกล่อง brand-bg + title + hint) — ข้อความ/ความหมายเดิมทุกจุด

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **ภาษาแบรนด์หน้า member** (frontend) | Profile/Notifications: ชายคาหยัก (`.awning-edge`) ใต้แถบหัว + ชื่อ `font-display`; Profile ชื่อจริงเป็น `font-display text-ink`; MyOrdersModal/OrderDetailModal/UploadSlipModal/CartPanel: ชื่อหัวข้อ `font-display` + ยอดรวม `tabular-nums` |
| **EmptyState กลาง** (frontend) | สร้าง `components/ui/EmptyState.tsx` (icon + title + hint + action + compact/tone) — อพยพ 14 จุด: MyOrdersModal (โหลด/error/ว่าง), ProductGrid, Notifications, VendorSales, CartPanel, AccountingSummary ×3, DetailModal ×4, StatCards, AdminDashboardHero ×3 |
| **เทส contract** (frontend) | `uiConsistencyContract.test.ts` +2 กฎ: ไฟล์ที่อพยพแล้วต้อง import `EmptyState` + ห้ามเขียน empty state เอง (py-16 flex-col / text-gray-400 py- / p-6 text-center) — ทดสอบด้วย probe จริงแล้วจับ fail (1 ตัว) |

**Rollback:** revert แล้ว rebuild frontend — ไม่มีผลต่อ data

---

## [2026-08-17] — feat(frontend): ขยายภาษาเดียวกัน (ชายคา/SectionTitle/Prompt) ไปหน้า PreOrder (commit `8d3dceb`)

### 🔴 สิ่งที่ต้องทำตอน deploy (เช็คทีละข้อ)

1. **Rebuild frontend อย่างเดียวพอ** — ไม่แตะ backend ไม่มี SQL/env ใหม่ ไม่ต้อง restart backend
2. **หน้า /pre-order เปลี่ยนหน้าตา** (ข้อมูล/ลอจิก/ปุ่มทุกปุ่มไม่เปลี่ยน): หัวหน้าเป็นชายคาหยักเหมือน Home, หัวข้อ "สินค้ามีโปร/สินค้ายอดนิยม" เป็น `SectionTitle`, ราคาเป็นเลข tabular — icons/ภาพสินค้า/ปุ่มเพิ่มลงตะกร้าเดิมทั้งหมด

### เปลี่ยนหลักใน commit นี้

| ส่วน | อะไร |
|---|---|
| **หัวหน้า PreOrder** (frontend) | เพิ่มชายคาหยัก (`.awning-edge` — signature เดียวกับ Home) + ชื่อเป็น `font-display` (Prompt) — icon box `w-8`/title `text-lg` เดิมเป๊ะ (contract ยังล็อก); เผื่อ `pt-5` กันครุยทับช่องค้นหา |
| **หัวข้อส่วน** (frontend) | `PromoPopularRow` — "🏷️ สินค้ามีโปร" (แท่ง amber) + "🔥 สินค้ายอดนิยม" เปลี่ยนเป็น `SectionTitle` (เดียวกับ Home) แทน h3 เขียนเองคนละแบบ |
| **ราคาสินค้า** (frontend) | `ProductGrid` — ราคาเป็น `font-display` + `tabular-nums` เลขเรียงตรง (เดียวกับ Home/POS) |

**Rollback:** revert แล้ว rebuild frontend — ไม่มีผลต่อ data

---

## [2026-08-17] — feat(frontend): รวม primitive UI ที่เหลือ (badge สถานะ / field label / skeleton / ตาราง) (commit `e967ffc`)

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
