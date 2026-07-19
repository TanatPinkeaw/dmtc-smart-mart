# คู่มือ Demo Deploy (ฟรีจริง) — DMTC Mart

เอาระบบขึ้นออนไลน์ให้อาจารย์/วิทยาลัยกดดูได้จากลิงก์ **ฟรีตลอด ไม่ต้องผูกบัตร ไม่มีวันเจอบิล**

ใช้ 3 บริการฟรี:

| ส่วน | บริการ | ฟรีแบบ |
|------|--------|--------|
| **ฐานข้อมูล MySQL** | [Aiven](https://aiven.io) | ฟรีตลอด 1GB ไม่หมดอายุ ไม่ผูกบัตร |
| **Backend (Node.js)** | [Render](https://render.com) | ฟรีตลอด (หลับหลังนิ่ง 15 นาที ตื่น ~1 นาที) |
| **Frontend (React)** | [Vercel](https://vercel.com) | ฟรี static ตลอด |

```
[ เบราว์เซอร์อาจารย์ ] → [ Vercel: หน้าเว็บ ] → (เรียก API/socket) → [ Render: Node backend ] → [ Aiven: MySQL ]
```

> **ข้อควรรู้ก่อนพรีเซนต์:** Render ฟรีจะ "หลับ" ถ้าไม่มีคนใช้ 15 นาที ครั้งแรกที่กดหลังหลับต้องรอตื่น ~1 นาที
> **ทริค:** เปิดเว็บทิ้งไว้ 1–2 นาทีก่อนเริ่มพรีเซนต์ (ปลุกให้ตื่น) แล้วจะลื่นตลอดช่วงที่มีคนใช้

---

## เตรียมก่อนเริ่ม

1. **โค้ดอยู่บน GitHub แล้ว** — repo: `TanatPinkeaw/dmtc-smart-mart` (push commit ล่าสุดให้เรียบร้อยก่อน ดูขั้น "อัปเดตโค้ด" ท้ายไฟล์)
2. **สมัคร 3 บัญชี** (ล็อกอินด้วย GitHub ได้หมด กดปุ่มเดียว):
   - Aiven → https://aiven.io
   - Render → https://render.com
   - Vercel → https://vercel.com

ลำดับที่ทำ: **A) ฐานข้อมูล → B) Backend → C) Frontend → D) เชื่อม 2 ฝั่ง → E) สร้าง admin**

---

## ขั้น A — สร้างฐานข้อมูล MySQL บน Aiven

1. เข้า https://aiven.io → **Sign up** (ล็อกอินด้วย GitHub)
2. กด **Create service** → เลือก **MySQL**
3. เลือกแพ็กเกจ **Free plan** (มีคำว่า Free / $0)
4. Cloud & region: เลือกอันที่ใกล้ไทยสุด (เช่น `google-asia-southeast1` สิงคโปร์) → **Create**
5. รอ ~2–3 นาที จนสถานะเป็น **Running** (เขียว)
6. เข้าไปที่ service → แท็บ **Overview** จะเห็น **Connection information** จดค่าพวกนี้ไว้ (จะใช้ในขั้น B):

| ช่องที่ Aiven แสดง | เอาไปใส่เป็น env |
|---------------------|------------------|
| Host | `DB_HOST` |
| Port | `DB_PORT` (Aiven ใช้พอร์ตแปลกๆ เช่น 12345) |
| User | `DB_USER` (ปกติ `avnadmin`) |
| Password | `DB_PASSWORD` (กดไอคอนตาเพื่อดู) |
| Database name | `DB_NAME` (ปกติ `defaultdb`) |

> **ไม่ต้องสร้างตารางเอง** — พอ backend รันครั้งแรก มันสร้างตารางทั้งหมดให้อัตโนมัติ
> **Aiven บังคับ SSL** — เดี๋ยวเราตั้ง `DB_SSL=true` ในขั้น B (โค้ดรองรับแล้ว)

---

## ขั้น B — เอา Backend ขึ้น Render

1. เข้า https://render.com → **Sign up** (ล็อกอินด้วย GitHub)
2. กด **New +** → **Web Service**
3. เลือก repo **dmtc-smart-mart** → **Connect** (ถ้าไม่เห็น กด Configure GitHub ให้สิทธิ์ก่อน)
4. ตั้งค่าตามนี้:

| ช่อง | ใส่ |
|------|-----|
| Name | `dmtc-mart-api` (หรืออะไรก็ได้) |
| Region | Singapore |
| Branch | `main` |
| **Root Directory** | `backend` ⚠️ สำคัญ (บอกว่า backend อยู่โฟลเดอร์ไหน) |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | **Free** |

5. เลื่อนลงไปหัวข้อ **Environment Variables** → กด **Add** ใส่ทีละตัว:

```
NODE_ENV      = production
JWT_SECRET    = <สุ่มยาวๆ เช่นจาก https://generate-secret.vercel.app/32 >
SETUP_KEY     = <สุ่มอีกอันสั้นๆ ก็ได้>
DB_HOST       = <Host จาก Aiven>
DB_PORT       = <Port จาก Aiven>
DB_USER       = avnadmin
DB_PASSWORD   = <Password จาก Aiven>
DB_NAME       = defaultdb
DB_SSL        = true
FRONTEND_URL  = https://localhost      (ค่าชั่วคราว เดี๋ยวแก้ในขั้น D)
```

> ไม่ต้องใส่ `PORT` — Render กำหนดให้เอง (โค้ดอ่านจาก `process.env.PORT` แล้ว)

6. กด **Create Web Service** → รอ build ~2–4 นาที
7. ดู **Logs** ให้เห็นข้อความประมาณ `Server running` + เชื่อม DB สำเร็จ (ไม่มี error สีแดงเรื่อง DB)
8. บนสุดจะมี **URL ของ backend** เช่น `https://dmtc-mart-api.onrender.com` → **จดไว้** (ใช้ในขั้น C)

**ทดสอบเร็วๆ:** เปิด `https://dmtc-mart-api.onrender.com/api/health` ในเบราว์เซอร์ ควรได้ JSON `{"status":"ok",...}` = backend + DB ทำงานแล้ว

---

## ขั้น C — เอา Frontend ขึ้น Vercel

1. เข้า https://vercel.com → **Sign up** (ล็อกอินด้วย GitHub)
2. กด **Add New...** → **Project** → เลือก repo **dmtc-smart-mart** → **Import**
3. ตั้งค่า:

| ช่อง | ใส่ |
|------|-----|
| Framework Preset | Vite (ปกติมันเดาให้เอง) |
| **Root Directory** | `frontend` ⚠️ สำคัญ (กด Edit แล้วเลือกโฟลเดอร์ frontend) |
| Build Command | `npm run build` (ค่า default) |
| Output Directory | `dist` (ค่า default) |

4. เปิดหัวข้อ **Environment Variables** ใส่:

```
VITE_API_URL = https://dmtc-mart-api.onrender.com     (URL backend จากขั้น B — ห้ามมี / ท้าย)
```

5. กด **Deploy** → รอ ~1–2 นาที
6. ได้ **URL ของ frontend** เช่น `https://dmtc-smart-mart.vercel.app` → **จดไว้** (ใช้ในขั้น D)

---

## ขั้น D — เชื่อม 2 ฝั่งเข้าหากัน (สำคัญ ห้ามข้าม)

ตอนนี้ backend ยังไม่รู้จัก URL ของ frontend เลยยังบล็อก (CORS) — ต้องบอกให้รู้จักกัน

1. กลับไปที่ **Render** → service `dmtc-mart-api` → แท็บ **Environment**
2. แก้ค่า `FRONTEND_URL` ให้เป็น URL Vercel จริงจากขั้น C:
   ```
   FRONTEND_URL = https://dmtc-smart-mart.vercel.app     ⚠️ ห้ามมี / ท้าย
   ```
3. **Save Changes** → Render จะ redeploy ให้เอง รอ ~2 นาที

> ถ้าตอนใช้งานเจอ error CORS หรือ socket ต่อไม่ติด = `FRONTEND_URL` (บน Render) กับ URL เว็บจริง (Vercel) ไม่ตรงกันเป๊ะ เช็คให้ตรงตัวอักษร ห้ามมี `/` ท้าย

---

## ขั้น E — สร้างบัญชี Admin คนแรก

เปิดลิงก์นี้ในเบราว์เซอร์ (แทน `<SETUP_KEY>` ด้วยค่าที่ตั้งไว้ในขั้น B):

```
https://dmtc-mart-api.onrender.com/api/create-admin?key=<SETUP_KEY>
```

จะได้บัญชี **รหัสนักศึกษา: `admin` / รหัสผ่าน: `1234`**

จากนั้นเปิดเว็บจริง `https://dmtc-smart-mart.vercel.app` → ล็อกอินด้วย `admin` / `1234` → **รีบเปลี่ยนรหัสผ่านทันที**

**เสร็จ! ระบบขึ้นออนไลน์แล้ว** 🎉 ส่งลิงก์ Vercel ให้อาจารย์กดดูได้เลย

---

## ทริคก่อนพรีเซนต์ (แก้ปัญหา Render หลับ)

Render ฟรีจะหลับหลังไม่มีคนใช้ 15 นาที ครั้งแรกที่กดต้องรอตื่น ~1 นาที

**ก่อนพรีเซนต์ 2–3 นาที** ให้ทำอันใดอันหนึ่ง:
- เปิดเว็บ Vercel ทิ้งไว้ กด refresh 1 ครั้ง รอจนโหลดข้อมูลขึ้น (แปลว่าตื่นแล้ว)
- หรือเปิด `https://dmtc-mart-api.onrender.com/api/health` รอจนได้ JSON

แล้วระหว่างพรีเซนต์มันจะลื่นตลอด (ตราบใดที่มีคนกดอยู่เรื่อยๆ ไม่ถึง 15 นาทีเงียบ)

---

## สรุป Environment Variables ทั้งหมด

**Render (backend):**

```
NODE_ENV=production
JWT_SECRET=<สุ่ม>
SETUP_KEY=<สุ่ม>
DB_HOST=<Aiven host>
DB_PORT=<Aiven port>
DB_USER=avnadmin
DB_PASSWORD=<Aiven password>
DB_NAME=defaultdb
DB_SSL=true
FRONTEND_URL=https://dmtc-smart-mart.vercel.app
```

**Vercel (frontend):**

```
VITE_API_URL=https://dmtc-mart-api.onrender.com
```

---

## ตารางแก้ปัญหา

| อาการ | สาเหตุ | วิธีแก้ |
|-------|--------|---------|
| เว็บโหลดช้ามากครั้งแรก แล้วปกติ | Render เพิ่งตื่นจากหลับ | ปกติ — ปลุกก่อนพรีเซนต์ (ดูด้านบน) |
| ล็อกอินไม่ได้ / โหลดข้อมูลไม่ขึ้น | `FRONTEND_URL` (Render) ≠ URL Vercel | เช็คให้ตรงเป๊ะ ไม่มี `/` ท้าย → Save → redeploy |
| Render log ขึ้น error เรื่อง DB | Aiven ยังไม่ Running / DB_SSL ไม่ได้ตั้ง / ค่า DB ผิด | เช็ค Aiven เป็น Running, `DB_SSL=true`, ค่า host/port/pass ตรง |
| realtime ไม่อัปเดต (ต้องรีเฟรชเอง) | socket ต่อไม่ติด (CORS) | เหมือนข้อ FRONTEND_URL ด้านบน |
| `/api/health` ไม่ขึ้น JSON | backend build/start ล้ม | ดู Logs บน Render, เช็ค Root Directory = `backend`, Start = `npm start` |
| Vercel build fail | Root Directory ผิด | ต้องตั้งเป็น `frontend` |

---

## อัปเดตโค้ด (หลังแก้อะไรในเครื่อง)

Render + Vercel **ผูกกับ GitHub อัตโนมัติ** — แค่ push โค้ดใหม่ขึ้น GitHub ทั้งสองจะ redeploy ให้เองภายในไม่กี่นาที

```powershell
cd D:\pos-coop-project
git add <ไฟล์ที่แก้>
git commit -m "ข้อความอธิบายการแก้"
git push origin main
```

---

## หมายเหตุความปลอดภัย (demo)

- Demo นี้เปิดสาธารณะบนอินเทอร์เน็ต — **อย่าใส่ข้อมูลนักเรียนจริง/ข้อมูลการเงินจริง** ใช้ข้อมูลตัวอย่างพอ
- ตอนใช้งานจริงในวิทยาลัย ให้ใช้ `DEPLOY.md` (ลงเครื่องในโรงเรียน วง LAN ปิด ปลอดภัยกว่า)
- ค่า `DB_SSL_CA` (ใน db.js) ตั้งเพิ่มได้ถ้าอยาก verify cert ของ Aiven แบบเต็ม (เอา CA cert จาก Aiven มาใส่) — demo ไม่ตั้งก็ได้ ยังเข้ารหัสอยู่
