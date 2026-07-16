---
description: A description of your rule
---

---
name: pos-coop-system
description: องค์ความรู้โครงสร้างโปรเจกต์ "ระบบ POS สหกรณ์" (React+Vite+TS frontend, Node/Express+Socket.io backend, MySQL). ใช้ skill นี้ทุกครั้งที่ผู้ใช้ถามเกี่ยวกับการเพิ่ม/แก้ไข/ลบฟีเจอร์ในระบบนี้ เช่น "อยากเพิ่มระบบ X", "จะแก้บั๊ก Y ตรงไหน", "ต้องแก้ไฟล์อะไรบ้างถ้าจะทำ Z", หรือถามถึงหน้า/ไฟล์ที่ชื่อ Login, Shift, POS, Dashboard, Inventory, Settings, PreOrder, OrderManagement, Layout, SocketContext, api.ts — แม้ผู้ใช้จะไม่พูดคำว่า "POS" หรือ "สหกรณ์" ตรงๆ ก็ตาม ให้ใช้ skill นี้เพื่อระบุไฟล์/จุดที่ต้องแก้อย่างเจาะจง แทนการตอบทั่วไป
---

# POS สหกรณ์ — องค์ความรู้โปรเจกต์

Skill นี้คือ "แผนที่โปรเจกต์" ให้ Claude ใช้ตอบคำถามแบบเจาะจงไฟล์/จุดที่ต้องแก้ เวลาผู้ใช้จะเพิ่มหรือแก้ฟีเจอร์ในระบบ POS สหกรณ์ ไม่ใช่คู่มือสอนเขียนโค้ดทั่วไป

## วิธีใช้ skill นี้ (ทุกครั้งที่ตอบ)

1. ระบุก่อนว่าฟีเจอร์ที่ผู้ใช้ถามเกี่ยวข้องกับ "ฝั่งไหนบ้าง": Frontend page, Backend route/controller, DB, Socket event — ส่วนใหญ่ฟีเจอร์ใหม่จะแตะครบทั้ง 4 ส่วน
2. เทียบกับ pattern ที่มีอยู่แล้ว (ดูหัวข้อด้านล่าง) แล้วชี้ไฟล์ที่ "น่าจะต้องแก้" พร้อมจุดในไฟล์ (เช่น "เพิ่ม route ใน routes/orders.js ต่อจาก POST /orders")
3. อย่าสมมติชื่อไฟล์/โฟลเดอร์ backend ที่ไม่เคยเห็น — ถ้าไม่ชัวร์ว่าไฟล์ backend ชื่ออะไร ให้ถามผู้ใช้ก่อน หรือขอให้แนบไฟล์ที่เกี่ยวข้องมาดู (โครงสร้าง backend เป็น /routes, /controllers, /models แต่ชื่อไฟล์จริงยังไม่ได้ยืนยันทั้งหมด)
4. ความละเอียดของคำตอบ: ปรับตามความซับซ้อนของงานเอง — งานเล็ก/จุดเดียวตอบสั้นบอกไฟล์+จุด, งานใหญ่/หลายไฟล์ให้ไล่เป็นลำดับขั้นทีละไฟล์ และใส่ code snippet เมื่อช่วยให้ชัดเจนขึ้นจริงๆ (ไม่ต้องเขียนเต็มไฟล์ถ้าไม่จำเป็น)

---

## Stack

| ส่วน | เทคโนโลยี |
|---|---|
| Frontend | React + Vite + TypeScript, React Router, Tailwind CSS, lucide-react, SweetAlert2 |
| Backend | Node.js + Express, **`server.js` ไฟล์เดียว** (มอโนลิธ ~2500 บรรทัด รวม 58 routes) ตั้ง Express + Socket.io ในไฟล์เดียวกัน |
| Realtime | Socket.io — client ผ่าน `SocketContext.tsx`, server emit ผ่าน `req.io.emit(...)` ในทุก route โดยตรง |
| Auth | JWT เก็บใน `localStorage` (`token`, `user`) ฝั่ง client, verify ด้วย middleware `authenticateToken` ใน `server.js` |
| DB | MySQL ผ่าน `mysql2/promise`, connection pool อยู่ที่ `db.js`, query แบบ raw SQL ตรงๆ (`pool.query(...)` หรือ `conn.query(...)`) ไม่มี ORM |
| Backend structure | **ไม่ได้แยก /routes /controllers /models จริง — ทุก route ประกาศอยู่ใน `server.js` ไฟล์เดียวด้วย `app.get/post/put/delete/patch(...)`** ส่วน `db.js` แยกออกมาเฉพาะ connection pool + auto-create schema (`initDB()`), และ `swagger.js` แยกไว้เฉพาะ config เอกสาร API |

Role มี 3 แบบจริงๆ (ไม่ใช่ 2): `MEMBER` (ค่า default ตอนสมัครใหม่), `CASHIER`, `ADMIN` — ใช้เช็คสิทธิ์ทั้งฝั่ง frontend (ซ่อนเมนู/redirect) และ backend (`requireRole(...roles)` middleware)

> ⚠️ **บทเรียนสำคัญ:** ก่อนหน้านี้เข้าใจผิดว่า backend แยก /routes /controllers /models — ของจริงคือไฟล์เดียว ห้ามอ้างอิงชื่อไฟล์แบบแยกโมดูลอีก ให้บอกเป็น **"route ไหนใน `server.js`"** พร้อมเลขบรรทัดโดยประมาณแทนเสมอ

---

## Frontend — โครงสร้างและ pattern

### ไฟล์หลัก
- `src/api.ts` — axios instance เดียวของทั้งแอป, base URL `http://localhost:3000/api`
  - interceptor request: แนบ `Authorization: Bearer <token>` จาก `localStorage.getItem('token')` อัตโนมัติ
  - interceptor response: ถ้า 401/403 → เคลียร์ `token`+`user` แล้ว redirect `/login`
  - **เพิ่ม endpoint ใหม่ = เรียก `api.get/post/put/delete('/path', ...)` ตรงในหน้าที่ใช้ ไม่มี service layer แยก**
- `src/SocketContext.tsx` — `SocketProvider` สร้าง connection เดียว (`io('http://localhost:3000')`), หน้าอื่นดึงผ่าน `useSocket()` เท่านั้น
  - **ห้ามสร้าง `io()` ใหม่ในหน้าไหนเด็ดขาด** — ถ้าฟีเจอร์ใหม่ต้องฟัง event ใหม่ ให้ `useSocket()` แล้ว `socket.on('event', cb)` ใน `useEffect` + cleanup ด้วย `socket.off('event')`
- `src/swal.ts` — `customSwal` (Swal.mixin) ธีมปุ่มชมพู/เทา ใช้แทน `Swal` ตรงๆ ทุกที่ที่มี alert/confirm
- `src/App.tsx` — route ทั้งหมด, หน้าไหนต้องมี sidebar/nav ให้อยู่ใต้ `<Route element={<Layout />}>`
- `src/components/Layout.tsx` — wrapper ทุกหน้าใน sidebar zone, ห่อด้วย `SocketProvider` (ที่นี่ที่เดียว), มี:
  - notification bell + badge (`fetchNotificationsAndBadge`, ฟัง `notification_user_${user.id}`, `new_order_received`, `order_status_changed`)
  - ปุ่มปิดกะ (CASHIER), modal โปรไฟล์/เปลี่ยนรหัสผ่าน
  - **ฟีเจอร์ badge/แจ้งเตือนใหม่ ให้เพิ่ม state + socket listener ตรงนี้ ไม่ใช่สร้างระบบแยก**

### หน้า (pages) และหน้าที่
| ไฟล์ | หน้าที่ | Role | Socket events ที่ฟัง |
|---|---|---|---|
| `Login.tsx` | เข้าสู่ระบบ, แยกเส้นทาง ADMIN→`/dashboard`, CASHIER→`/shift` | public | - |
| `Shift.tsx` | เปิดกะ (เงินทอนตั้งต้น), ADMIN ข้ามอัตโนมัติ | CASHIER | - |
| `POS.tsx` | หน้าขายหลัก, ค้นสมาชิก, checkout, ปิดกะ | CASHIER/ADMIN | `connect`, `stock_updated` |
| `Dashboard.tsx` | สรุปยอดขาย, top สินค้าขายดี | ADMIN | `dashboard_updated` |
| `Inventory.tsx` | รับสินค้าเข้าคลัง (purchase), ตะกร้ารับของ | staff | `stock_updated` |
| `Settings.tsx` | ตั้งค่าร้าน/ผู้ใช้/หมวดหมู่/ซัพพลายเออร์/โปรโมชั่น/สินค้า/ประวัติการขาย/void บิล | ADMIN | `stock_updated`, `dashboard_updated` |
| `PreOrder.tsx` | ลูกค้าสั่งจองล่วงหน้า, อัปโหลดสลิป, ยกเลิกออเดอร์ตัวเอง | public/สมาชิก | `stock_updated`, `order_update_user_${id}`, `notification_user_${id}` |
| `OrderManagement.tsx` | พนักงานตรวจสลิป/เปลี่ยนสถานะออเดอร์ | staff | `new_order_received`, `order_status_changed` |
| `Notifications.tsx` | รายการแจ้งเตือนทั้งหมด (50 ล่าสุด) | login แล้ว | - |
| `Layout.tsx` | wrapper: nav, badge, SocketProvider, ปิดกะ, โปรไฟล์ | login แล้ว | `notification_user_${id}`, `new_order_received`, `order_status_changed` |

### API endpoints ที่ใช้อยู่แล้ว (อ้างอิงตอนเพิ่ม endpoint ใหม่ให้ตั้งชื่อ/วาง pattern สอดคล้อง)
```
POST /auth/login
GET  /categories, /products, /suppliers, /promotions, /settings/store, /users, /notifications
POST /users/register, /users, /categories, /suppliers, /promotions, /products
PUT  /settings/store, /users/:id, /users/:id/profile, /users/update-role, /products/:id
DELETE /categories/:id, /products/:id, /users/:id, /suppliers/:id
GET  /users/search?q=
POST /sales/checkout
POST /sales/:id/void
GET  /sales/history, /sales/history/:id
POST /shifts/open, /shifts/close
GET  /shifts/current?cashier_id=
POST /purchases
GET  /orders?t=<timestamp>
POST /orders, /orders/upload-slip (multipart/form-data)
PUT  /orders/:id/status, /orders/:id/cancel-by-user
GET  /orders/pending-count
GET  /reports/dashboard, /reports/top-selling
```

---

## Backend — pattern จริงจาก `server.js`

- **ทุก route ประกาศตรงใน `server.js`** ด้วย `app.get/post/put/delete/patch('/api/...', [middleware], async (req, res) => { ... })` — ไม่มีชั้น controller แยก, query DB ในตัว handler เลย
- แต่ละ route มี **JSDoc `@swagger` comment กำกับก่อนเสมอ** (อ่านโดย `swagger.js` ไปสร้างหน้า `/api/docs`) — เพิ่ม route ใหม่ให้ใส่ comment แบบเดียวกันด้วย เพื่อให้ยังโผล่ใน Swagger docs
- Query DB ใช้ `pool.query(sql, params)` (single query ไม่มี transaction) หรือ `const conn = await pool.getConnection(); conn.beginTransaction()/commit()/rollback()/release()` (ทุก flow ที่แก้หลายตารางพร้อมกัน เช่น checkout, void, purchase, order status — ให้ทำตาม pattern transaction นี้เสมอ)
- `req.io` ถูกแนบเข้า request ด้วย middleware กลาง (ก่อนทุก route): `app.use((req, res, next) => { req.io = io; next(); })` — เรียก `req.io.emit('event', data)` ได้ในทุก route handler โดยตรง ไม่ต้อง import อะไรเพิ่ม
- **Route ใหม่ ให้แทรกต่อท้ายกลุ่ม route ที่หัวข้อเดียวกัน** (โค้ดแบ่งเป็นบล็อกคอมเมนต์หัวข้อใหญ่ เช่น `// === CATEGORIES ===`, ไล่ตามลำดับ: categories → products → auth/users → shifts → sales → members → reports → settings → promotions → suppliers → purchases → orders (pre-order) → notifications → bootstrap endpoints ท้ายไฟล์)
- Endpoint สำหรับ setup/seed data (`/api/init-db`, `/api/seed-data`, `/api/create-admin`, `/api/clear-data`) ป้องกันด้วย `requireSetupKey` (เช็ค query `?key=` เทียบ `process.env.SETUP_KEY`) ไม่ใช่ JWT — **อย่าแนะนำให้เปิด endpoint พวกนี้แบบไม่มี guard เด็ดขาด**

### Socket events ที่ backend emit ผ่าน `req.io` (ยืนยันจาก source จริงแล้ว — มีจุด emit ทั้งหมด 13 จุด)
| Event | Emit จาก route ไหน | Payload | ฝั่งไหนฟัง |
|---|---|---|---|
| `stock_updated` | `POST /sales/checkout`, `POST /sales/:id/void`, `POST /purchases`, `PUT /orders/:id/status` (ตอน COMPLETED) | `{ message }` | POS, Inventory, PreOrder, Settings |
| `dashboard_updated` | `POST /sales/checkout`, `POST /sales/:id/void` | `{ message }` | Dashboard, Settings |
| `new_order_received` | `POST /orders` (ลูกค้าสร้างออเดอร์ใหม่), `PUT /orders/:id/cancel-by-user` | `{ message, order_id }` | OrderManagement, Layout (badge) |
| `notification_user_${user_id}` | `PUT /orders/:id/status` (ตอน CANCELLED) | `{ message }` | PreOrder, Layout (badge/bell) — เฉพาะ user นั้น |
| `order_update_user_${user_id}` | `PUT /orders/:id/status`, `PUT /orders/:id/cancel-by-user` | `{ order_id, status }` | PreOrder — เฉพาะเจ้าของออเดอร์ |
| `order_status_changed` | `PUT /orders/:id/status`, `PUT /orders/:id/cancel-by-user` | `{ order_id, status }` | OrderManagement, Layout (badge, sync ทุกคน) |

**Pattern เพิ่ม event ใหม่:** หลัง `conn.commit()` (หรือหลัง query สำเร็จถ้าไม่ใช้ transaction) → `req.io.emit('event_name', data)` (broadcast ทั้งระบบ) หรือ `req.io.emit(\`event_name_user_${userId}\`, data)` (ยิงเฉพาะ user) — ตั้งชื่อ event ให้สอดคล้องกับ 2 แพทเทิร์นนี้ อย่าตั้งชื่อใหม่ที่ไม่เข้าพวก

---

## Auth / Role — pattern จริง

- **`authenticateToken`** (global middleware, ครอบทุก route ยกเว้น `PUBLIC_PATHS`): อ่าน `Authorization: Bearer <token>` → `jwt.verify` ด้วย `JWT_SECRET` จาก `.env` → ถ้าผ่านจะได้ `req.user = { id, role, full_name }` ใช้ต่อใน route handler ได้เลย (เช่น `req.user.id`, `req.user.role`)
- **`PUBLIC_PATHS`** (ไม่ต้องมี token): `/api/auth/login`, `/api/users/register`, `/api/docs`, `/api/init-db`, `/api/seed-data`, `/api/create-admin` — route ใหม่ที่ต้องเข้าได้โดยไม่ login ต้องเพิ่มเข้า array นี้
- **`requireRole(...roles)`** — middleware แยกต่างหาก ใส่เป็น arg ที่ 2 ของ route (เช่น `app.put('/api/products/:id', requireRole('ADMIN'), async (req,res)=>{...})`) ปัจจุบันใช้จริงกับ: `PUT /products/:id`, `PUT /orders/:id/status`, `GET /orders/pending-count` (ทั้งสองอันหลัง = `requireRole('ADMIN','CASHIER')`), `GET /clear-data` (`requireRole('ADMIN')`) — ส่วนใหญ่ยัง**ไม่ได้ใส่ requireRole ครบทุก route ที่ควรจำกัดสิทธิ์** ถ้าผู้ใช้ขอเพิ่มการป้องกัน role ให้เช็คว่า route เดิมมี `requireRole` หรือยัง
- **`requireSetupKey`** — เฉพาะ bootstrap endpoint 4 ตัว เช็ค query `?key=` เทียบ `SETUP_KEY` ใน `.env`
- Frontend เช็ค role จาก `JSON.parse(localStorage.getItem('user'))`, เทียบ `.role === 'ADMIN'` หรือ `['ADMIN','CASHIER'].includes(user.role)` (ดู `Layout.tsx`) — role จริงมี 3 ค่า: `MEMBER` (default), `CASHIER`, `ADMIN`
- Token หมดอายุ/ไม่มีสิทธิ์ → backend ตอบ 401/403 → axios interceptor ใน `api.ts` (frontend) จัดการ logout ให้อัตโนมัติ ไม่ต้องเขียนดักเองในหน้า

---

## Database — schema จริงทั้งหมด (จาก `db.js`, auto-create ทุกครั้งที่ server บูท)

Connection pool อยู่ที่ `db.js` (`mysql2/promise`, อ่าน config จาก `.env`: `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT`) — `initDB()` รัน `CREATE TABLE IF NOT EXISTS` ทุกตารางอัตโนมัติตอน import `db.js` ครั้งแรก รวมถึงมี defensive `ALTER TABLE ... ADD COLUMN` ท้ายไฟล์สำหรับคอลัมน์ที่เพิ่มทีหลัง (pattern นี้ใช้เวลาต้องเพิ่มคอลัมน์ใหม่ให้ตารางเดิมแบบ backward-compatible)

| ตาราง | คอลัมน์สำคัญ | ความสัมพันธ์ |
|---|---|---|
| `users` | `student_id`(username), `password`(hash), `full_name`, `phone_number`, `role` ENUM(MEMBER/CASHIER/ADMIN), `points`, `is_active` | — |
| `categories` | `name` | — |
| `products` | `barcode`, `name`, `category_id`, `vendor_id`(ผูก users, ระบบฝากขาย), `gp_rate`(%หัก GP), `cost`, `price`, `stock`, `image_url`, `is_active` | FK → categories, users |
| `suppliers` | `name`, `contact_info`, `address` | — |
| `promotions` | `name`, `discount_type` ENUM(PERCENT/FIXED/BOGO), `discount_value`, `start_date`, `end_date`, `is_active` | — |
| `settings` | id=1 คงที่, `store_name`, `tax_id`, `address`, `receipt_footer` | — |
| `shifts` | `cashier_id`, `opening_cash`, `expected_cash`, `actual_cash`, `difference`, `status` ENUM(OPEN/CLOSED), `opened_at`, `closed_at`, `note` | FK → users |
| `sales` | `cashier_id`, `member_id`, `promotion_id`, `payment_method` ENUM(CASH/QR/MIXED), `total_amount`, `discount_amount`, `amount_received`, `change_amount`, `status` ENUM(COMPLETED/VOIDED/HOLD), `points_redeemed`, `points_discount` | FK → users×2, promotions |
| `sale_items` | `sale_id`, `product_id`, `quantity`, `price`, `subtotal` | FK → sales(CASCADE), products |
| `purchases` | `supplier_id`, `user_id`, `total_cost`, `status` ENUM(COMPLETED/CANCELLED) | FK → suppliers, users |
| `purchase_items` | `purchase_id`, `product_id`, `quantity`, `unit_cost`, `subtotal` | FK → purchases(CASCADE), products |
| `orders` (pre-order) | `user_id`, `total_amount`, `payment_method`, `slip_image`, `earn_points`, `status`(PENDING_VERIFY/WAITING_CASH/PREPARING/READY/COMPLETED/CANCELLED), `reject_reason` | FK → users |
| `order_items` | `order_id`, `product_id`, `quantity`, `price`, `subtotal` | FK → orders(CASCADE), products |
| `notifications` | `user_id`, `message`, `is_read` | FK → users |

**ไม่มีตาราง `members` แยก** — สมาชิก/ลูกค้าคือ `users` ที่ `role='MEMBER'` (single-identity design ตามคอมเมนต์ในโค้ด) การค้นหาสมาชิกตอนขาย (`GET /users/search`) จึงค้นในตาราง `users` ตรงๆ

**เพิ่มคอลัมน์ให้ตารางเดิม** ให้ทำแบบ defensive patch ต่อท้าย `initDB()` ใน `db.js`:
```js
try {
  await connection.query(`ALTER TABLE <table> ADD COLUMN <col> <type>`);
} catch (alterErr) {
  if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(...);
}
```
(ตาม pattern ที่ใช้จริงกับ `sales.points_redeemed`, `sales.points_discount`, `orders.reject_reason`)

---

## Environment Variables (`.env`)

Backend อ่าน config ผ่าน `dotenv` (`require('dotenv').config()` ทั้งใน `server.js` และ `db.js`) — มีตัวแปรที่ใช้จริง:

| ตัวแปร | ใช้ที่ไหน | หมายเหตุ |
|---|---|---|
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` | `db.js` — สร้าง MySQL connection pool | มี fallback default ในโค้ด (`localhost`/`root`/`pos_coop`/`3306`) ถ้าไม่ตั้งค่า |
| `JWT_SECRET` | `server.js` — เซ็น/verify JWT token | **ถ้าไม่มีค่านี้ server จะ `process.exit(1)` ทันทีตอนบูท** (ดูบล็อกเช็คต้นไฟล์) |
| `SETUP_KEY` | `server.js` — คุ้มกัน bootstrap endpoints (`/init-db`, `/seed-data`, `/create-admin`, `/clear-data`) | ไม่ตั้งค่า = endpoint พวกนี้ตอบ 503 ปิดใช้งานอัตโนมัติ (ปลอดภัยโดย default) |

**ห้ามใส่ค่าจริงของตัวแปรเหล่านี้ (password, secret key) ไว้ใน SKILL.md หรือโค้ดตัวอย่างที่ตอบผู้ใช้เด็ดขาด** — พูดถึงแค่ชื่อตัวแปรและวิธีใช้เท่านั้น

---

1. **DB**: ต้องเพิ่ม/แก้ตารางไหม? (ถามชื่อคอลัมน์จริงถ้าไม่ชัวร์)
2. **Backend route**: เพิ่ม `app.get/post/put/delete/patch('/api/...', ...)` ใหม่ต่อท้ายกลุ่ม route หัวข้อเดียวกันใน `server.js` (ไม่ใช่ไฟล์แยก) ตั้งชื่อ path ตาม pattern REST ที่มีอยู่ (ดูตาราง endpoint ด้านบน), ใส่ `@swagger` comment กำกับ, ใช้ `requireRole(...)` ถ้าต้องจำกัดสิทธิ์, ใช้ transaction (`pool.getConnection()` + `beginTransaction/commit/rollback/release`) ถ้าแก้หลายตารางพร้อมกัน
3. **Socket**: ฟีเจอร์นี้ต้อง realtime ไหม → emit event ใหม่ผ่าน `req.io.emit(...)` หลัง commit สำเร็จ, ตั้งชื่อ event ตาม pattern (`xxx_updated`, `xxx_user_${id}`) หรือใช้ event เดิมที่มีอยู่แล้วถ้าเข้าเคส
4. **Frontend page**: หน้าไหนต้องแก้ (หน้าเดิม หรือสร้างหน้าใหม่ + เพิ่ม route ใน `App.tsx` + เพิ่มลิงก์ nav ใน `Layout.tsx`)
5. **Socket listener ฝั่ง client**: ถ้ามี event ใหม่ ต้อง `useSocket()` + `socket.on` + cleanup ในหน้าที่เกี่ยวข้อง (และ/หรือ `Layout.tsx` ถ้าเป็น badge/แจ้งเตือน)
6. **UI**: ใช้ Tailwind + ธีมสีชมพู (`bg-pink-*`, มุมมน `rounded-xl/2xl`) + `lucide-react` icon + `Swal` (จาก `swal.ts`) สำหรับ alert/confirm ให้ตรงธีมเดิม

ตอบโดยไล่ 6 ข้อนี้เฉพาะข้อที่เกี่ยวข้องจริงกับฟีเจอร์ที่ถาม ไม่ต้องพูดครบทุกข้อถ้าฟีเจอร์เล็ก