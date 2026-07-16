#!/bin/bash
# ============================================
# สคริปต์ restore ฐานข้อมูล POS สหกรณ์ จากไฟล์ backup
# ใช้กับ MySQL ที่รันใน Docker (container ตาม docker-compose.yml เดิม)
# ============================================
#
# วิธีใช้:
#   ./restore.sh backups/backup_2026-07-15T02-00-00.sql
#
# หรือระบุ container/db/password เองผ่าน env:
#   DB_CONTAINER=pos_mysql DB_NAME=pos_coop DB_ROOT_PASSWORD=rootpassword ./restore.sh <ไฟล์.sql>

set -e

BACKUP_FILE="$1"
DB_CONTAINER="${DB_CONTAINER:-pos_mysql}"
DB_NAME="${DB_NAME:-pos_coop}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-rootpassword}"

if [ -z "$BACKUP_FILE" ]; then
  echo "❌ กรุณาระบุไฟล์ backup ที่จะ restore"
  echo "   ตัวอย่าง: ./restore.sh backups/backup_2026-07-15T02-00-00.sql"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ ไม่พบไฟล์: $BACKUP_FILE"
  exit 1
fi

echo "⚠️  กำลังจะเขียนทับข้อมูลทั้งหมดในฐานข้อมูล '$DB_NAME' ด้วยไฟล์ '$BACKUP_FILE'"
read -p "พิมพ์ 'yes' เพื่อยืนยัน: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "ยกเลิกการ restore"
  exit 0
fi

echo "🔄 กำลัง restore..."
cat "$BACKUP_FILE" | docker exec -i "$DB_CONTAINER" mysql -u root -p"$DB_ROOT_PASSWORD" --default-character-set=utf8mb4 "$DB_NAME"
echo "✅ Restore สำเร็จ ข้อมูลกลับมาเหมือนตอน backup แล้ว"
