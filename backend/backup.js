// ⭐️ Refactor — เดิมพึ่ง `mysqldump`/`gzip`/`mysql` เป็นโปรแกรมภายนอก (ใช้ shell exec) ซึ่งพังทันทีบน
// เครื่อง Windows dev ที่ไม่ได้ติดตั้ง MySQL client tools ไว้ใน PATH (ดู error "mysqldump not recognized").
// เขียนใหม่ทั้งหมดให้เป็น pure Node + SQL ผ่าน pool ตัวเดียวกับที่แอปใช้อยู่แล้ว — ไม่พึ่งโปรแกรมภายนอกเลย
// (gzip ใช้ Node's built-in zlib แทน shell `gzip`) ทำให้ backup/restore ทำงานได้เหมือนกันทุก OS
// ไม่ว่าจะรันตรงบนเครื่อง หรือใน Docker

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TZ_BANGKOK = 'Asia/Bangkok';

// Get today's date in Bangkok timezone (for filename)
function getBackupDateBangkok() {
  const now = new Date();
  const bangkokDate = new Date(now.toLocaleString('en-US', { timeZone: TZ_BANGKOK }));
  const year = bangkokDate.getFullYear();
  const month = String(bangkokDate.getMonth() + 1).padStart(2, '0');
  const day = String(bangkokDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ⭐️ Dump ทุกตารางในฐานข้อมูลปัจจุบันเป็น SQL text เดียว (DROP + CREATE + INSERT ต่อตาราง)
// ใช้ connection เดียวตลอดการ dump (ไม่ใช่ pool.query แยกครั้ง) เพื่อให้ REPEATABLE READ snapshot
// สอดคล้องกันทุกตาราง แม้มีการเขียนข้อมูลระหว่าง dump อยู่ก็ตาม
async function dumpDatabaseToSql(pool) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('START TRANSACTION');

    const [dbRows] = await conn.query('SELECT DATABASE() as db');
    const dbName = dbRows[0].db;
    const tableKey = `Tables_in_${dbName}`;

    const [tables] = await conn.query('SHOW TABLES');
    const tableNames = tables.map(t => t[tableKey]);

    let sql = `-- DMTC Mart backup — ${new Date().toISOString()} (database: ${dbName})\n`;
    sql += `SET FOREIGN_KEY_CHECKS=0;\n`;
    sql += `SET NAMES utf8mb4;\n\n`;

    for (const table of tableNames) {
      const [createRows] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
      const createSql = createRows[0]['Create Table'];
      sql += `DROP TABLE IF EXISTS \`${table}\`;\n${createSql};\n\n`;

      const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
      if (rows.length > 0) {
        const columns = Object.keys(rows[0]);
        const colList = columns.map(c => `\`${c}\``).join(', ');
        const CHUNK = 200; // แบ่งเป็นก้อนกัน 1 statement ยาวเกินไปสำหรับตารางที่มีข้อมูลเยอะ
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const values = chunk
            .map(row => '(' + columns.map(c => pool.escape(row[c])).join(', ') + ')')
            .join(',\n  ');
          sql += `INSERT INTO \`${table}\` (${colList}) VALUES\n  ${values};\n`;
        }
        sql += '\n';
      }
    }

    sql += `SET FOREIGN_KEY_CHECKS=1;\n`;
    await conn.query('COMMIT');
    return sql;
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch (_) { /* connection may already be dead */ }
    throw err;
  } finally {
    conn.release();
  }
}

// ⭐️ Restore จาก SQL text ที่ dumpDatabaseToSql สร้างเอง — รูปแบบควบคุมได้ทั้งหมด (ทุก statement จบ
// ด้วย ";\n" บรรทัดเดียว ไม่มี newline ดิบแทรกกลาง statement เพราะ pool.escape() แปลง \n ในข้อมูลเป็น
// อักขระ \\n literal ไปแล้วตอน dump) จึง split ด้วย ";\n" ได้อย่างปลอดภัย โดยไม่ต้องพึ่ง SQL parser ภายนอก
async function restoreDatabaseFromSql(pool, sql) {
  const statements = sql
    .split(';\n')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  const conn = await pool.getConnection();
  try {
    for (const stmt of statements) {
      await conn.query(stmt);
    }
  } finally {
    conn.release();
  }
}

// สร้าง backup ใหม่ (ข้ามถ้าวันนี้ backup สำเร็จไปแล้ว) — บันทึกสถานะลงตาราง backups เสมอ
async function createBackup(db, backupDir = './backups') {
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupDate = getBackupDateBangkok();
    const filename = `coop-backup-${backupDate}.sql`;
    const filepath = path.join(backupDir, filename);
    const gzipPath = `${filepath}.gz`;

    const [existingBackup] = await db.query(
      'SELECT id FROM backups WHERE backup_date = ? AND status = ?',
      [backupDate, 'SUCCESS']
    );
    if (existingBackup.length > 0) {
      console.log(`✅ Backup already exists for ${backupDate}`);
      return null; // ข้าม ไม่ทำซ้ำ
    }

    const [insertResult] = await db.query(
      'INSERT INTO backups (filename, backup_date, status) VALUES (?, ?, ?)',
      [`${filename}.gz`, backupDate, 'PENDING']
    );
    const backupId = insertResult.insertId;

    const sql = await dumpDatabaseToSql(db);
    const gzipped = zlib.gzipSync(Buffer.from(sql, 'utf8'));
    fs.writeFileSync(gzipPath, gzipped);

    const fileSizeMb = (gzipped.length / (1024 * 1024)).toFixed(2);

    await db.query(
      'UPDATE backups SET status = ?, file_size_mb = ?, backup_path = ? WHERE id = ?',
      ['SUCCESS', fileSizeMb, gzipPath, backupId]
    );

    console.log(`✅ Backup created: ${gzipPath} (${fileSizeMb} MB)`);
    cleanOldBackups(backupDir, 30);

    return { id: backupId, filename: `${filename}.gz`, size: fileSizeMb, path: gzipPath };
  } catch (err) {
    console.error('❌ Backup failed:', err);

    const backupDate = getBackupDateBangkok();
    try {
      await db.query(
        'INSERT INTO backups (filename, backup_date, status, notes) VALUES (?, ?, ?, ?)',
        [`coop-backup-${backupDate}.sql.gz`, backupDate, 'FAILED', err.message]
      );
    } catch (logErr) {
      console.error('⚠️ บันทึกสถานะ backup ที่ล้มเหลวไม่สำเร็จ:', logErr.message);
    }

    throw err;
  }
}

// ลบไฟล์ backup เก่าเกิน keepDays วัน
function cleanOldBackups(backupDir, keepDays) {
  try {
    if (!fs.existsSync(backupDir)) return;

    const now = Date.now();
    const files = fs.readdirSync(backupDir);

    files.forEach(file => {
      const filepath = path.join(backupDir, file);
      const stat = fs.statSync(filepath);
      const ageDays = (now - stat.mtime.getTime()) / (1000 * 60 * 60 * 24);

      if (ageDays > keepDays && file.startsWith('coop-backup-')) {
        fs.unlinkSync(filepath);
        console.log(`🗑️  Deleted old backup: ${file}`);
      }
    });
  } catch (err) {
    console.error('❌ Clean old backups failed:', err);
  }
}

// Restore ฐานข้อมูลจากไฟล์ backup (.sql หรือ .sql.gz)
async function restoreBackup(db, backupPath) {
  try {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    let sql;
    if (backupPath.endsWith('.gz')) {
      sql = zlib.gunzipSync(fs.readFileSync(backupPath)).toString('utf8');
    } else {
      sql = fs.readFileSync(backupPath, 'utf8');
    }

    await restoreDatabaseFromSql(db, sql);

    console.log(`✅ Restore completed from: ${backupPath}`);
    return true;
  } catch (err) {
    console.error('❌ Restore failed:', err);
    throw err;
  }
}

module.exports = { createBackup, restoreBackup, getBackupDateBangkok, cleanOldBackups };
