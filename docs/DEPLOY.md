# คู่มือ Deploy & ดูแลระบบ — DMTC Mart

คู่มือนี้เขียนสำหรับคนที่ **เพิ่งเคย deploy ครั้งแรก** และสำหรับรุ่นน้อง/ผู้ดูแลระบบต่อ อ่านจากบนลงล่างทีละขั้นได้เลย

---

## 1. ภาพรวม — ระบบมี 3 ส่วน

| ส่วน | คืออะไร | รันด้วย |
|------|---------|---------|
| **MySQL** | ที่เก็บข้อมูลทั้งหมด (สินค้า ยอดขาย สมาชิก กะ) | service MySQL บนเครื่อง |
| **Backend (Node.js)** | สมองของระบบ รับ-ส่งข้อมูล ตรวจสิทธิ์ | PM2 (พอร์ต 3000) |
| **Frontend (React)** | หน้าเว็บที่พนักงานเห็น | build เป็นไฟล์นิ่ง แล้ว nginx เสิร์ฟ |

**วิธีที่คู่มือนี้ใช้:** ลงทุกอย่างบนเครื่อง Ubuntu เครื่องเดียวในโรงเรียน เข้าใช้งานผ่าน IP ในวง LAN คนในร้านเปิดเบราว์เซอร์เข้าเว็บพร้อมกันได้ ~100 คน

```
[ เบราว์เซอร์พนักงาน ] --(LAN)--> [ nginx :443 ] --+--> ไฟล์ frontend (dist)
                                                   |
                                                   +--> /api, /socket.io --> [ Node :3000 ] --> [ MySQL ]
```

---

## 2. เตรียมเครื่อง

- **เครื่อง:** mini PC หรือคอมสเปกกลางๆ (แรม 4GB+ / SSD 128GB+ เพียงพอสำหรับ ~100 คน)
- **ระบบปฏิบัติการ:** Ubuntu Server 22.04 LTS (หรือใหม่กว่า)
- **เน็ตเวิร์ก:** ต่อ LAN โรงเรียน และ **ตั้ง IP แบบคงที่ (fixed IP)** ให้เครื่องนี้ เช่น `192.168.1.50` (ขอจากผู้ดูแลเน็ตเวิร์กโรงเรียน) — สำคัญมาก เพราะพนักงานจะเข้าเว็บผ่าน IP นี้ ถ้า IP เปลี่ยนทุกคนเข้าไม่ได้
- เปิดเครื่องทิ้งไว้ตลอดเวลาทำการ

> ตัวอย่างในคู่มือใช้ IP `192.168.1.50` และ user ลินุกซ์ชื่อ `coop` — เปลี่ยนให้ตรงกับของจริง

---

## 3. ขั้นตอน Deploy (ทำครั้งแรกครั้งเดียว)

### 3.1 ลงโปรแกรมที่จำเป็น

```bash
# อัปเดตระบบ
sudo apt update && sudo apt upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# MySQL, nginx, git, เครื่องมือ build ของ sharp
sudo apt install -y mysql-server nginx git build-essential

# PM2 (ตัวคุมให้ backend รันตลอด)
sudo npm install -g pm2
```

### 3.2 ตั้งค่า MySQL + สร้างฐานข้อมูล

```bash
# ตั้งความปลอดภัยเริ่มต้น (ตอบ y ตามคำถาม, ตั้งรหัส root)
sudo mysql_secure_installation

# เข้า MySQL แล้วสร้าง database + user ของแอป
sudo mysql
```

ใน prompt ของ MySQL พิมพ์ (เปลี่ยน `รหัสยาวสุ่มจริง` เป็นรหัสที่แข็งแรง):

```sql
CREATE DATABASE pos_coop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'coop_user'@'localhost' IDENTIFIED BY 'รหัสยาวสุ่มจริง';
GRANT ALL PRIVILEGES ON pos_coop.* TO 'coop_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> **ไม่ต้องสร้างตารางเอง** — ตอน backend รันครั้งแรก มันสร้างตารางทั้งหมดให้อัตโนมัติ (`db.js` → `initDB()`)

### 3.3 เอาโค้ดขึ้นเครื่อง

```bash
cd /home/coop
git clone <URL repo ของนาย> pos-coop-project
# หรือก็อปทั้งโฟลเดอร์ผ่าน USB/scp มาไว้ที่ /home/coop/pos-coop-project
cd pos-coop-project
```

### 3.4 ตั้งค่า Backend

```bash
cd /home/coop/pos-coop-project/backend
npm ci --omit=dev          # ลงเฉพาะ dependency ที่ใช้ตอนรันจริง
cp .env.example .env
nano .env                  # แก้ค่าตาม checklist ด้านล่าง
mkdir -p logs uploads      # โฟลเดอร์ log + ที่เก็บสลิป/รูป
```

**ค่าใน `.env` ที่ต้องแก้ (production):**

```ini
NODE_ENV=production
PORT=3000
JWT_SECRET=<สุ่มใหม่: รันคำสั่ง openssl rand -hex 32>
SETUP_KEY=<สุ่มใหม่: openssl rand -hex 16>
DB_HOST=localhost
DB_USER=coop_user
DB_PASSWORD=รหัสยาวสุ่มจริง        # ให้ตรงกับตอนสร้าง user ใน 3.2
DB_NAME=pos_coop
DB_PORT=3306
FRONTEND_URL=https://192.168.1.50   # IP/โดเมนที่พนักงานเข้า (คุม CORS + socket)
```

> คำสั่งสุ่ม secret: `openssl rand -hex 32` แล้วก็อปผลลัพธ์มาวาง

### 3.5 รัน Backend ด้วย PM2

```bash
cd /home/coop/pos-coop-project/backend
pm2 start ecosystem.config.js     # ไฟล์นี้มีให้แล้วในโฟลเดอร์ backend
pm2 save                          # จำ process ไว้
pm2 startup                       # ทำตามบรรทัดที่มันพิมพ์ออกมา (ให้รันเองตอนเปิดเครื่อง)
pm2 logs dmtc-mart-api            # ดู log ว่าขึ้น "Server running" + เชื่อม DB ได้ (Ctrl+C ออก)
```

### 3.6 สร้างบัญชี Admin คนแรก

```bash
# เรียกครั้งเดียว ใช้ SETUP_KEY ที่ตั้งไว้ใน .env — ⭐️ ส่งผ่าน header ไม่ใช่ query string แล้ว (กันหลุดไป access log)
curl -H "X-Setup-Key: <SETUP_KEY ของนาย>" "http://localhost:3000/api/create-admin"
```

จะได้บัญชี **รหัสนักศึกษา: `admin`** รหัสผ่านชั่วคราวสุ่มใหม่ทุกครั้ง — ดูใน server log (`pm2 logs dmtc-mart-api`)
> ⚠️ **ล็อกอินครั้งแรกแล้วรีบเปลี่ยนรหัสผ่านทันที** (ระบบจะบังคับเปลี่ยนก่อนใช้งานหน้าอื่นอยู่แล้ว)

### 3.7 Build Frontend

```bash
cd /home/coop/pos-coop-project/frontend
npm ci
# บอก frontend ว่า backend อยู่ที่ไหน (ต้องตรงกับ FRONTEND_URL ใน backend .env)
echo "VITE_API_URL=https://192.168.1.50" > .env.production
npm run build                     # ได้ผลลัพธ์ในโฟลเดอร์ dist/

# ย้ายไฟล์ที่ build แล้วไปให้ nginx เสิร์ฟ
sudo mkdir -p /var/www/dmtc-mart
sudo cp -r dist/* /var/www/dmtc-mart/
```

### 3.8 ตั้ง HTTPS (self-signed) + nginx

สร้างใบรับรอง self-signed (เพราะยังไม่มีโดเมน):

```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/dmtc-mart.key \
  -out /etc/nginx/ssl/dmtc-mart.crt \
  -subj "/CN=192.168.1.50"
```

ติดตั้ง nginx config (ไฟล์มีให้แล้วที่ `deploy/nginx-dmtc-mart.conf`):

```bash
sudo cp /home/coop/pos-coop-project/deploy/nginx-dmtc-mart.conf /etc/nginx/sites-available/dmtc-mart
# แก้ server_name ในไฟล์ให้เป็น IP จริง (ถ้าต้องการ)
sudo ln -s /etc/nginx/sites-available/dmtc-mart /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # เอา default page ออก
sudo nginx -t                                  # เช็คว่า config ไม่ผิด
sudo systemctl reload nginx
```

### 3.9 เปิด Firewall

```bash
sudo ufw allow 80,443/tcp     # เว็บ
sudo ufw allow OpenSSH        # กัน lock ตัวเองออกจาก SSH
sudo ufw enable
```

### 3.10 ทดสอบ

จากคอมเครื่องอื่นในวง LAN เปิดเบราว์เซอร์ไปที่ `https://192.168.1.50`
- เจอคำเตือน "ไม่ปลอดภัย" (เพราะ self-signed) → กด Advanced → Proceed (ปกติสำหรับ LAN ภายใน)
- ล็อกอินด้วย `admin` / `1234` → เปลี่ยนรหัสทันที
- ลองเพิ่มสินค้า, ขายบิล, ดูว่าสลิป/รูปขึ้น, realtime อัปเดตข้ามเครื่อง

**เสร็จแล้ว! ระบบพร้อมใช้งานจริง** 🎉

---

## 4. ตั้ง Backup อัตโนมัติ (สำคัญมาก — ข้อมูลการเงิน)

```bash
cd /home/coop/pos-coop-project/deploy
nano backup-mysql.sh          # แก้ DB_PASS + BACKUP_DIR ให้ตรงจริง
chmod +x backup-mysql.sh

# ตั้ง cron ให้ดั๊มป์ทุกวันตี 1
crontab -e
# เพิ่มบรรทัดนี้ (แก้ path ให้ตรง):
0 1 * * * /home/coop/pos-coop-project/deploy/backup-mysql.sh >> /home/coop/pos-coop-project/deploy/backup.log 2>&1
```

- Backup เก็บเป็นไฟล์ `.sql.gz` ไว้ 14 วันล่าสุด
- **เดือนละครั้ง** ควรก็อปไฟล์ backup ล่าสุดไปเก็บที่อื่น (USB / Google Drive) เผื่อเครื่องพัง
- **ทดสอบกู้ข้อมูลจริง** อย่างน้อยเดือนละครั้ง (ดูวิธีในหัวข้อ 5)

รูปสลิป/รูปเข้างานอยู่ที่ `backend/uploads/` — สำรองโฟลเดอร์นี้ด้วย (ไม่ได้อยู่ใน MySQL):
```bash
tar czf /var/backups/dmtc-mart/uploads_$(date +%F).tar.gz -C /home/coop/pos-coop-project/backend uploads
```

---

## 5. คู่มือดูแลระบบ (สำหรับผู้พัฒนา/ผู้ดูแลต่อ)

### คำสั่งที่ใช้บ่อย

```bash
pm2 status                    # ดูว่า backend รันอยู่ไหม
pm2 logs dmtc-mart-api        # ดู log สด (error/request)
pm2 restart dmtc-mart-api     # รีสตาร์ท backend
pm2 stop dmtc-mart-api        # หยุด
sudo systemctl reload nginx   # โหลด nginx config ใหม่
sudo systemctl status mysql   # เช็ค MySQL
```

### อัปเดตโค้ดเวอร์ชันใหม่

```bash
cd /home/coop/pos-coop-project
git pull                                    # ดึงโค้ดใหม่

# ถ้า backend เปลี่ยน
cd backend && npm ci --omit=dev && pm2 restart dmtc-mart-api

# ถ้า frontend เปลี่ยน
cd ../frontend && npm ci && npm run build
sudo cp -r dist/* /var/www/dmtc-mart/
```

### กู้ข้อมูลจาก Backup

```bash
# แตกไฟล์ backup แล้ว import กลับ (ระวัง: ทับข้อมูลปัจจุบัน)
gunzip < /var/backups/dmtc-mart/pos_coop_2026-07-18_01-00-00.sql.gz | \
  mysql --user=coop_user --password='รหัส' pos_coop
```

### เปลี่ยน Secret (ควรทำทุก 6 เดือน)

แก้ `JWT_SECRET` ใน `backend/.env` เป็นค่าใหม่ (`openssl rand -hex 32`) แล้ว `pm2 restart dmtc-mart-api`
> ผลข้างเคียง: ทุกคนจะถูก logout ต้องล็อกอินใหม่ (ปกติ)

### ตารางแก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุที่พบบ่อย | วิธีแก้ |
|-------|----------------|---------|
| เว็บเปิดไม่ขึ้นเลย | nginx ล่ม / config ผิด | `sudo nginx -t` แล้ว `sudo systemctl reload nginx` |
| เว็บขึ้นแต่ล็อกอิน/โหลดข้อมูลไม่ได้ | backend ล่ม | `pm2 status` → `pm2 restart dmtc-mart-api` → ดู `pm2 logs` |
| backend ขึ้นไม่ได้ตอนบูท | ต่อ MySQL ไม่ได้ / `.env` ผิด | เช็ค `sudo systemctl status mysql` + ค่าใน `.env` |
| realtime ไม่อัปเดต (ต้องรีเฟรชเอง) | socket.io ต่อไม่ติด | เช็ค config `/socket.io/` ใน nginx + `FRONTEND_URL` ตรงกับที่เข้าจริง |
| รูปสลิปไม่ขึ้น | โฟลเดอร์ `uploads` หาย/สิทธิ์ผิด | เช็ค `backend/uploads/` มีอยู่ + เจ้าของถูก |
| ล็อกอินเด้ง "พยายามบ่อยเกินไป" | rate limit (5 ครั้ง/15 นาที) | รอ 15 นาที (เป็นการป้องกันที่ตั้งใจไว้) |

### จุดสำคัญของโครงสร้างโค้ด (ให้คนใหม่เข้าใจเร็ว)

- **Backend เป็นไฟล์เดียว** `backend/server.js` (~4,300 บรรทัด, ทุก API รวมกัน) + `db.js` (สร้าง/ต่อ DB), `validators.js`, `multer-config.js` (อัปโหลดไฟล์), `mailer.js`/`daily-report.js`/`backup.js`
- **Frontend** `frontend/src/pages/*` = แต่ละหน้า, `components/Layout.tsx` = เมนู/นาวิเกชัน, `api.ts` = ตัวยิง API, `SocketContext.tsx` = realtime, `config.ts` = URL backend
- **สิทธิ์ผู้ใช้:** MEMBER / CASHIER / ADMIN — คุมที่ `requireRole(...)` ในแต่ละ route
- **ข้อมูลรูป:** สลิป/รูปเข้างานเสิร์ฟผ่าน `GET /api/media` (ต้องล็อกอิน) ไม่ได้เปิดสาธารณะ

---

## 6. เช็คลิสต์ก่อนเปิดใช้จริง (ทำแล้วติ๊ก)

- [ ] `.env` backend เป็น `NODE_ENV=production` + secret สุ่มใหม่ + รหัส DB แข็งแรง
- [ ] `frontend/.env.production` ตั้ง `VITE_API_URL` ตรงกับ IP/โดเมนจริง
- [ ] เปลี่ยนรหัส admin จาก `1234` แล้ว
- [ ] Backup cron รันได้ (ลองรัน `./backup-mysql.sh` มือดูว่ามีไฟล์ออกมา)
- [ ] ทดสอบเปิดสลิปโดยไม่ล็อกอิน → ต้องโดนปฏิเสธ (ยืนยันว่าไฟล์ไม่หลุด)
- [ ] เครื่องตั้ง fixed IP + เปิด firewall แล้ว
- [ ] จดรหัสผ่าน admin / รหัส DB / SETUP_KEY เก็บไว้ที่ปลอดภัย

---

## 7. อยากอัปเกรดทีหลัง (ไม่จำเป็นตอนนี้)

- **มีโดเมนจริง** (เช่น `coop.dmtc.ac.th`) → เปลี่ยนจาก self-signed เป็น **Let's Encrypt** (`sudo certbot --nginx`) จะไม่มีคำเตือน "ไม่ปลอดภัย" อีก
- **เปิดให้เข้าจากนอกโรงเรียน** → ต้องเปิด port forwarding + โดเมน + Let's Encrypt (ปรึกษาผู้ดูแลเน็ตเวิร์กเรื่องความปลอดภัยก่อน)
- **โหลดสูงขึ้น** → เพิ่ม `instances` ใน `ecosystem.config.js` เป็น `'max'` (คลัสเตอร์หลายคอร์)
