#!/bin/bash
# ⭐️ DEPLOY — สำรองฐานข้อมูล MySQL อัตโนมัติทุกวัน (ตั้งผ่าน cron ดูใน DEPLOY.md)
# ดั๊มป์ทั้ง database เป็นไฟล์ .sql.gz เก็บไว้ 14 วันล่าสุด (เก่ากว่านั้นลบทิ้ง)
#
# วิธีตั้ง cron ให้รันทุกวันตี 1:
#   crontab -e
#   0 1 * * * /home/USER/pos-coop-project/deploy/backup-mysql.sh >> /home/USER/pos-coop-project/deploy/backup.log 2>&1

set -euo pipefail

# ---- แก้ค่าตรงนี้ให้ตรงกับเครื่องจริง ----
DB_NAME="pos_coop"
DB_USER="coop_user"
DB_PASS="เปลี่ยนเป็นรหัส DB จริง"
BACKUP_DIR="/var/backups/dmtc-mart"     # โฟลเดอร์เก็บ backup (ควรอยู่คนละไดรฟ์/USB ถ้าทำได้)
RETENTION_DAYS=14                        # เก็บกี่วัน
# ------------------------------------------

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y-%m-%d_%H-%M-%S)
OUT="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.gz"

echo "[$(date)] เริ่ม backup -> $OUT"
mysqldump --single-transaction --quick --user="$DB_USER" --password="$DB_PASS" "$DB_NAME" | gzip > "$OUT"

# ลบ backup ที่เก่ากว่ากำหนด
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" -delete

echo "[$(date)] backup สำเร็จ: $(du -h "$OUT" | cut -f1)"
