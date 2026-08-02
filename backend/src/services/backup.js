// ⭐️ Refactor — เดิมพึ่ง `mysqldump`/`gzip`/`mysql` เป็นโปรแกรมภายนอก (ใช้ shell exec) ซึ่งพังทันทีบน
// เครื่อง Windows dev ที่ไม่ได้ติดตั้ง MySQL client tools ไว้ใน PATH (ดู error "mysqldump not recognized").
// เขียนใหม่ทั้งหมดให้เป็น pure Node + SQL ผ่าน pool ตัวเดียวกับที่แอปใช้อยู่แล้ว — ไม่พึ่งโปรแกรมภายนอกเลย
// (gzip ใช้ Node's built-in zlib แทน shell `gzip`) ทำให้ backup/restore ทำงานได้เหมือนกันทุก OS
// ไม่ว่าจะรันตรงบนเครื่อง หรือใน Docker

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { saveRawFile, fetchRawFile, CLOUDINARY_ENABLED } = require('../../cloudinary-config'); // ⭐️ Update — offsite copy so backups survive Render's ephemeral disk (cloudinary-config.js not moved yet)

const TZ_BANGKOK = 'Asia/Bangkok';

// Get today's date in Bangkok timezone — ยังใช้กับคอลัมน์ backup_date และเช็ค "วันนี้ backup ไปหรือยัง"
function getBackupDateBangkok() {
  const now = new Date();
  const bangkokDate = new Date(now.toLocaleString('en-US', { timeZone: TZ_BANGKOK }));
  const year = bangkokDate.getFullYear();
  const month = String(bangkokDate.getMonth() + 1).padStart(2, '0');
  const day = String(bangkokDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 🐛 FIX — ชื่อไฟล์ต้องมีเวลาด้วย ไม่ใช่แค่วันที่
// เดิมชื่อไฟล์เป็น `coop-backup-<วันที่>.sql.gz` ล้วนๆ แต่คอลัมน์ backups.filename เป็น UNIQUE
// พอวันเดียวกันมีการสร้าง backup รอบสอง (เช่น cron ตี 2 ล้มเหลวคาสถานะ FAILED ไว้ แล้ว admin
// กดปุ่ม "สร้าง backup" เอง) INSERT รอบใหม่จะชนชื่อไฟล์เดิม → ER_DUP_ENTRY (1062) → endpoint
// ตอบ 500 (ตรงกับที่เจอจริงบน production: POST /api/admin/backups/create 500)
// หมายเหตุ: การ์ด "วันนี้มี backup สถานะ SUCCESS แล้วให้ข้าม" ด้านล่างกันได้เฉพาะเคส SUCCESS
// เท่านั้น แถวที่ค้างสถานะ PENDING/FAILED ไม่ถูกกัน จึงหลุดมาชนกันตรง INSERT
// ⭐️ ละเอียดถึงระดับมิลลิวินาที ไม่ใช่แค่วินาที — ยืนยันด้วยเทสต์แล้วว่าจำเป็น: ถ้าใช้แค่ HHmmss
// การสร้าง backup สองครั้งภายในวินาทีเดียวกัน (เช่น admin กดปุ่มรัวสองที หรือ request ซ้อนกัน)
// ยังได้ชื่อไฟล์เดิมเป๊ะ → ชน UNIQUE key → 500 เหมือนเดิม
// หมายเหตุ: toLocaleString ไม่มีมิลลิวินาที จึงต้องอ่าน getMilliseconds() จาก now ตัวเดิม
// (ค่ามิลลิวินาทีในวินาทีนั้นเท่ากันทุก timezone อยู่แล้ว)
function getBackupTimestampBangkok() {
  const now = new Date();
  const bangkok = new Date(now.toLocaleString('en-US', { timeZone: TZ_BANGKOK }));
  const p = (n) => String(n).padStart(2, '0');
  const date = `${bangkok.getFullYear()}-${p(bangkok.getMonth() + 1)}-${p(bangkok.getDate())}`;
  const time = `${p(bangkok.getHours())}${p(bangkok.getMinutes())}${p(bangkok.getSeconds())}`;
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${date}_${time}_${ms}`;
}

// 🐛 FIX — pool.escape() ใช้กับค่าที่ mysql2 คืนมาจากคอลัมน์ JSON ตรงๆ ไม่ได้
// mysql2 parse คอลัมน์ JSON (เช่น shifts.opening_cash_breakdown / closing_cash_breakdown)
// ให้เป็น JS object/array แล้ว พอส่งเข้า pool.escape() ต่อ จะได้ผลผิดสองแบบ:
//   object  ->  '[object Object]'   (coerce เป็น string ทิ้งข้อมูลจริงหมด) ตอน restore MySQL
//               ปฏิเสธเพราะไม่ใช่ JSON ที่ถูกต้อง = ER_INVALID_JSON_TEXT (errno 3140)
//   array   ->  1, 2, 3             (แตกเป็นหลายค่าคั่นด้วยจุลภาค) ทำให้จำนวนคอลัมน์ใน INSERT
//               เพี้ยนทั้ง statement — พังเงียบกว่าเคสแรกอีก
// แก้โดย stringify เองก่อนแล้วค่อย escape "ในฐานะ string" ซึ่ง escape quote/backslash ให้ถูกต้อง
// (ปลอดภัยกว่าไล่แทน ' เอง) — Date กับ Buffer ต้องปล่อยให้ pool.escape จัดการตามเดิม
function escapeSqlValue(pool, val) {
  if (val === null || val === undefined) return 'NULL';
  if (val instanceof Date || Buffer.isBuffer(val)) return pool.escape(val);
  if (typeof val === 'object') return pool.escape(JSON.stringify(val));
  return pool.escape(val);
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
            .map(row => '(' + columns.map(c => escapeSqlValue(pool, row[c])).join(', ') + ')')
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
  // ⭐️ Bug fix — strip full-line comments BEFORE splitting on ';\n', not after. The dump's leading
  // "-- DMTC Mart backup..." line has no trailing ';\n', so it used to glue onto the very next
  // statement (SET FOREIGN_KEY_CHECKS=0). That merged chunk starts with '--', so the old
  // post-split filter threw the WHOLE thing away — meaning FOREIGN_KEY_CHECKS was never actually
  // set to 0, and restore failed on the first DROP TABLE referenced by another table's FK (i.e.
  // any restore of this schema, every time — not just missing-file cases).
  const sqlWithoutComments = sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');

  // 🐛 FIX — กู้ไฟล์ backup เก่าที่ถูกสร้างตอนยังมีบั๊ก escape คอลัมน์ JSON (ดู escapeSqlValue)
  // ไฟล์พวกนั้นเก็บค่าไว้เป็น '[object Object]' ซึ่งไม่ใช่ JSON ที่ถูกต้อง พอ restore เข้าคอลัมน์
  // JSON จริง MySQL จะปฏิเสธทั้ง statement ด้วย ER_INVALID_JSON_TEXT (3140) แล้ว restore ล้มทั้งงาน
  // แทนค่าเสียเหล่านั้นด้วย '{}' (JSON ว่าง ที่ valid) เพื่อให้ restore เดินต่อจนจบได้
  // ข้อมูลใน field นั้นกู้กลับไม่ได้อยู่แล้ว (บั๊กเดิมทำลายตั้งแต่ตอน dump) แต่แถวที่เหลือรอด
  // ไฟล์ backup ที่สร้างหลังแก้บั๊กจะไม่มีสตริงนี้ บรรทัดนี้จึงไม่แตะอะไรเลย
  const sqlSanitized = sqlWithoutComments.split("'[object Object]'").join("'{}'");

  const statements = sqlSanitized
    .split(';\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);

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
  // ⭐️ คิดชื่อไฟล์/วันที่ครั้งเดียวไว้นอก try เพื่อให้ catch ใช้ค่าเดียวกันได้ และให้แถว PENDING
  // กับไฟล์จริงใช้ timestamp เดียวกันเสมอ
  const backupDate = getBackupDateBangkok();
  const filename = `coop-backup-${getBackupTimestampBangkok()}.sql`;
  // ⭐️ ต้องรู้ใน catch ว่าแถว PENDING ถูก INSERT ไปแล้วหรือยัง จะได้เลือกว่า UPDATE หรือ INSERT
  let backupId = null;

  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

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
    backupId = insertResult.insertId;

    const sql = await dumpDatabaseToSql(db);
    const gzipped = zlib.gzipSync(Buffer.from(sql, 'utf8'));
    fs.writeFileSync(gzipPath, gzipped);

    const fileSizeMb = (gzipped.length / (1024 * 1024)).toFixed(2);

    // ⭐️ Update — อัปโหลดสำเนาขึ้น Cloudinary ด้วย (raw) กัน Render ephemeral disk ลบไฟล์ทิ้งตอน
    // redeploy/restart ก่อนใครจะได้ restore จากมัน (ดู server.js restore endpoint ที่เคยเจอเคสนี้
    // จริง — backup_path หายแต่แถวในตารางยังบอก SUCCESS อยู่) ถ้าอัปโหลดพลาด ไม่ทำให้ backup ทั้งงาน
    // ล้ม — ไฟล์บนดิสก์ยังใช้ restore ได้ตามปกติจนกว่าจะถึง redeploy ครั้งถัดไป
    let cloudPublicId = null, cloudUrl = null;
    if (CLOUDINARY_ENABLED) {
      try {
        const uploaded = await saveRawFile(gzipped, 'backups', filename.replace(/\.sql$/, ''));
        if (uploaded) { cloudPublicId = uploaded.publicId; cloudUrl = uploaded.url; }
      } catch (cloudErr) {
        console.error('⚠️ อัปโหลด backup ขึ้น Cloudinary ไม่สำเร็จ (ไฟล์บนดิสก์ยังใช้ได้ปกติ):', cloudErr.message);
      }
    }

    await db.query(
      'UPDATE backups SET status = ?, file_size_mb = ?, backup_path = ?, cloud_public_id = ?, cloud_url = ? WHERE id = ?',
      ['SUCCESS', fileSizeMb, gzipPath, cloudPublicId, cloudUrl, backupId]
    );

    console.log(`✅ Backup created: ${gzipPath} (${fileSizeMb} MB)${cloudPublicId ? ' + Cloudinary offsite copy' : ''}`);
    cleanOldBackups(backupDir, 30);

    return { id: backupId, filename: `${filename}.gz`, size: fileSizeMb, path: gzipPath, cloudBacked: !!cloudPublicId };
  } catch (err) {
    console.error('❌ Backup failed:', err);

    // 🐛 FIX — เดิม catch ยิง INSERT แถว FAILED ใหม่เสมอ ด้วยชื่อไฟล์แบบวันที่ล้วน ซึ่งชนกับแถวเดิม
    // ของวันนั้นได้อีกดอก (เจอจริง: "บันทึกสถานะ backup ที่ล้มเหลวไม่สำเร็จ: Duplicate entry")
    // = ตัว error handler เองก็พัง เลยไม่มีร่องรอยความล้มเหลวเหลือไว้ใน DB เลย
    // ถ้าแถว PENDING ถูกสร้างไปแล้ว ให้อัปเดตแถวนั้นเป็น FAILED แทนการสร้างแถวใหม่ — ได้ทั้งไม่ชนชื่อ
    // และไม่ทิ้งแถว PENDING ค้างไว้ (แถว PENDING ค้างจะหลอกให้ครั้งถัดไปเข้าใจผิดตอนไล่ดูสถานะ)
    try {
      if (backupId) {
        await db.query(
          'UPDATE backups SET status = ?, notes = ? WHERE id = ?',
          ['FAILED', err.message, backupId]
        );
      } else {
        // พังก่อนจะได้สร้างแถว (เช่น mkdir ไม่ผ่าน / SELECT ล้ม) — บันทึกไว้เป็นแถวใหม่
        // ชื่อไฟล์มี timestamp แล้วจึงไม่ชนกับ backup อื่นของวันเดียวกัน
        await db.query(
          'INSERT INTO backups (filename, backup_date, status, notes) VALUES (?, ?, ?, ?)',
          [`${filename}.gz`, backupDate, 'FAILED', err.message]
        );
      }
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

// ⭐️ Update — เวอร์ชัน "ฉลาด" ของ restoreBackup: ใช้ไฟล์บนดิสก์ก่อนถ้ายังอยู่ (เร็วกว่า ไม่ต้องพึ่ง
// เครือข่าย) ถ้าไฟล์บนดิสก์หายไปแล้ว (Render redeploy/restart ล้าง ephemeral disk) แต่แถวนี้มีสำเนา
// Cloudinary ผูกไว้ ก็ดึงจากคลาวด์มาแทน แล้วเขียนกลับลงดิสก์ด้วย (self-heal local cache กัน
// ต้องดึงจากคลาวด์ซ้ำถ้ามีคน restore แถวเดียวกันอีกรอบ) โยน error โค้ด BACKUP_FILE_MISSING ออกไป
// เฉพาะตอนที่ไม่มีทั้งไฟล์บนดิสก์และสำเนาบนคลาวด์เลยจริงๆ ให้ caller (server.js) แยก 410 ได้เหมือนเดิม
async function restoreBackupRow(db, backupRow, backupDir = './backups') {
  if (fs.existsSync(backupRow.backup_path)) {
    await restoreBackup(db, backupRow.backup_path);
    return { source: 'local', path: backupRow.backup_path };
  }

  if (!backupRow.cloud_public_id) {
    throw Object.assign(new Error(`Backup file not found: ${backupRow.backup_path}`), { code: 'BACKUP_FILE_MISSING' });
  }

  console.log(`[restore] ไม่พบไฟล์บนดิสก์ (${backupRow.backup_path}) — ดึงจาก Cloudinary แทน (public_id=${backupRow.cloud_public_id})`);
  const buffer = await fetchRawFile(backupRow.cloud_public_id);

  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(backupRow.backup_path, buffer); // self-heal local cache สำหรับรอบถัดไป

  await restoreBackup(db, backupRow.backup_path);
  return { source: 'cloud', path: backupRow.backup_path };
}

module.exports = { createBackup, restoreBackup, restoreBackupRow, getBackupDateBangkok, cleanOldBackups };
