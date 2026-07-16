# ระบบ Backup & Restore + งานอัตโนมัติ (Cron)

## สิ่งที่ต้องติดตั้งเพิ่ม

```bash
npm install node-cron
```

`node-cron` เป็น dependency ใหม่ที่ `server.js` เรียกใช้ ต้องติดตั้งก่อนรัน ไม่งั้น server จะ error ตอน `require('node-cron')`

## Backup อัตโนมัติ

ตอน server รัน จะตั้ง cron ให้เองอัตโนมัติ 2 งาน:

| งาน | เวลา | ทำอะไร |
|-----|------|--------|
| Backup ฐานข้อมูล | ทุกวัน ตี 2 | `mysqldump` ทั้ง database เก็บเป็นไฟล์ `.sql` ในโฟลเดอร์ `backups/` |
| ตัดออกงาน/ปิดกะอัตโนมัติ | ทุกเที่ยงคืน (00:05) | ปิดกะ/attendance ที่ลืมปิดข้ามวัน |

- Backup เก่าเกิน 7 วันจะถูกลบอัตโนมัติ (ปรับที่ตัวแปร `BACKUP_KEEP_DAYS` ใน `server.js`)
- เวลาที่แสดงอิงตาม timezone ของเครื่อง — ถ้าอยากให้ตรงเวลาไทย รันด้วย `TZ=Asia/Bangkok node server.js`

## Backup ด้วยมือทันที

- เรียก API: `POST /api/backup/run` (ต้องเป็น ADMIN)
- หรือรัน mysqldump ตรงๆ:

```bash
docker exec pos_mysql mysqldump -u root -prootpassword --default-character-set=utf8mb4 pos_coop > backups/backup_manual.sql
```

## Restore กลับ (ตอนระบบล่ม/ข้อมูลพัง)

```bash
chmod +x restore.sh          # ครั้งแรกครั้งเดียว
./restore.sh backups/backup_2026-07-15T02-00-00.sql
```

สคริปต์จะถามยืนยันก่อนเขียนทับ พิมพ์ `yes` เพื่อดำเนินการ ข้อมูลจะกลับมาเหมือนตอน backup ทุกอย่าง

## ปรับค่า container/db/password (ถ้าไม่ตรงกับ docker-compose.yml เดิม)

ตั้งผ่าน environment variable ใน `.env` หรือตอนรัน:

```
DB_CONTAINER=pos_mysql
DB_NAME=pos_coop
DB_ROOT_PASSWORD=rootpassword
```

## ⚠️ ข้อควรระวังตอน deploy จริง

- โฟลเดอร์ `backups/` อยู่ในเครื่องเดียวกับ server — ถ้าเครื่องพังไฟล์ backup หายด้วย **ควร sync ไฟล์ในโฟลเดอร์นี้ออกไปเก็บนอกเครื่อง** (เช่น cloud storage, เครื่องสำรอง) เป็นระยะ
- คำสั่ง backup ใช้ `docker exec` เข้า container `pos_mysql` โดยตรง จึงต้องรัน server บนเครื่อง (host) ที่เข้าถึง docker ได้ ถ้ารัน server ใน container เองต้อง mount docker socket หรือเปลี่ยนไปใช้ `mysqldump` ผ่าน network แทน
