// config/tenantRegistry.js — Master database สำหรับเก็บข้อมูล tenants ทั้งหมด
// เชื่อมต่อ database หลัก (master) เพื่อดึงรายชื่อ tenants + database names

const mysql = require('mysql2/promise');
// ⭐️ Use config module (single source of truth) instead of reading process.env directly
const config = require('./config');

// ⭐️ SSL support for cloud databases (e.g. Aiven) — same pattern as config/db.js
let sslOption;
if (config.DB_SSL) {
  if (config.DB_SSL_CA) {
    const ca = config.DB_SSL_CA.includes('BEGIN CERTIFICATE')
      ? config.DB_SSL_CA
      : Buffer.from(config.DB_SSL_CA, 'base64').toString('utf8');
    sslOption = { ca, rejectUnauthorized: true };
  } else {
    sslOption = { rejectUnauthorized: false };
  }
}

// Master database config (เก็บข้อมูล tenants ทั้งหมด)
const MASTER_DB_CONFIG = {
  host: config.DB_HOST || 'localhost',
  user: config.DB_USER || 'root',
  password: config.DB_PASSWORD || '',
  database: process.env.MASTER_DB || 'pos_master',
  port: config.DB_PORT || 3306,
  charset: 'utf8mb4',
  timezone: '+07:00',
  waitForConnections: true,
  connectionLimit: 10, // ⭐️ เพิ่มจาก 5 → 10 สำหรับ master pool ( tenant registry operations)
  ...(sslOption ? { ssl: sslOption } : {})
};

let masterPool = null;

// Return the existing pool from db.js (reuses warm connections to Aiven)
// All master queries MUST use pos_master.tablename (fully-qualified) since this pool connects to defaultdb
function getMasterPool() {
  if (!masterPool) {
    masterPool = require("./db");
  }
  return masterPool;
}

// Initialize master database (สร้าง table tenants ถ้ายังไม่มี)
async function initMasterDB() {
  // Use existing pool (from config/db.js) for everything — no new connections needed
  var existingPool = require("./db");
  var dbName = MASTER_DB_CONFIG.database;
  console.log("[initMasterDB] Creating master DB:", dbName);

  // 1. Create master database via existing pool
  await existingPool.query("CREATE DATABASE IF NOT EXISTS `" + dbName + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  console.log("[initMasterDB] Database created/exists:", dbName);

  // 2. Create tenants table via existing pool using fully-qualified name
  await existingPool.query("CREATE TABLE IF NOT EXISTS `" + dbName + "`.tenants (" +
    "id INT AUTO_INCREMENT PRIMARY KEY, " +
    "shop_name VARCHAR(255) NOT NULL, " +
    "db_name VARCHAR(100) NOT NULL UNIQUE, " +
    "admin_username VARCHAR(50) NOT NULL, " +
    "plan ENUM('free','basic','pro','enterprise') DEFAULT 'free', " +
    "max_users INT DEFAULT 5, " +
    "max_products INT DEFAULT 500, " +
    "is_active TINYINT(1) DEFAULT 1, " +
    "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, " +
    "last_login TIMESTAMP NULL, " +
    "deleted_at TIMESTAMP NULL" +
  ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  console.log("[initMasterDB] Tenants table created/exists");

  // 3. Reset masterPool so it picks up the newly-created database on next use
  if (masterPool) { try { await masterPool.end(); } catch (_) {} masterPool = null; }
  console.log("[initMasterDB] Master pool reset");
}

// Get tenant by database name
async function getTenantByDbName(dbName) {
  const pool = getMasterPool();
  const [rows] = await pool.query('SELECT * FROM `pos_master`.tenants WHERE db_name = ?', [dbName]);
  return rows[0] || null;
}

// ⭐️ Soft delete support — เติมคอลัมน์ deleted_at ให้ฐานข้อมูลเก่าอัตโนมัติครั้งแรกที่ query
//    (initMasterDB ไม่ได้ถูกเรียกตอน boot จึงต้อง migrate แบบ lazy + cache ผลไว้ระดับ process)
let deletedAtMigration = null;
async function ensureDeletedAtColumn() {
  if (!deletedAtMigration) {
    deletedAtMigration = getMasterPool().query('ALTER TABLE `pos_master`.tenants ADD COLUMN deleted_at TIMESTAMP NULL')
      .then(() => console.log('✅ tenants.deleted_at ready'))
      .catch((err) => {
        if (err && err.code === 'ER_DUP_FIELDNAME') return; // มีคอลัมน์อยู่แล้ว — ปกติ
        deletedAtMigration = null; // DB ยังไม่พร้อม/พังอื่นๆ — ให้ลองใหม่ request ถัดไป
        throw err;
      });
  }
  return deletedAtMigration;
}

// Get all tenants (ตัดร้านที่ถูก soft delete ออก)
// ⭐️ Self-heal — ถ้า master DB/ตาราง tenants ยังไม่ถูกสร้าง (deploy ใหม่, initMasterDB ตอน boot พัง,
//    หรือ DB โดนลบ) จะลอง bootstrap รอบเดียวแล้ว query ซ้ำ กัน dashboard/login 500 กันหมดทั้งระบบ.
//    Error อื่นๆ (สิทธิ์ DDL/เน็ตล่ม) ปล่อย throw ผ่านเหมือนเดิม — ห้ามกลืน ต้องเห็นใน Render logs
let masterBootstrapAttempted = false;
async function getAllTenants() {
  try {
    return await _queryTenants();
  } catch (err) {
    if (masterBootstrapAttempted) throw err;
    masterBootstrapAttempted = true; // ต่อ process ลองได้แค่ครั้งเดียว กัน recursion ไม่จำกัด
    console.error(`[TENANT_REGISTRY] getAllTenants failed (${err.code || 'NO_CODE'}: ${err.message}) — trying one-shot master DB bootstrap...`);
    try { await initMasterDB(); } catch (bootErr) {
      // bootstrap ไม่สำเร็จ (เช่น user ไม่มีสิทธิ์ CREATE DATABASE) — log ไว้แล้วให้ query ด้านล่าง throw ซ้ำเอง
      console.error(`[TENANT_REGISTRY] bootstrap also failed (${bootErr.code || 'NO_CODE'}: ${bootErr.message})`);
    }
    // Reset pool so getMasterPool() creates a fresh one pointing to the now-existing DB
    if (masterPool) { try { await masterPool.end(); } catch (_) {} masterPool = null; }
    return await _queryTenants();
  }
}

// query จริงแยกเป็น helper เพื่อให้ self-heal ยิงซ้ำได้ (ensureDeletedAtColumn + SELECT)
async function _queryTenants() {
  await ensureDeletedAtColumn();
  const pool = getMasterPool();
  const [rows] = await pool.query('SELECT * FROM `pos_master`.tenants WHERE deleted_at IS NULL ORDER BY created_at DESC');
  return rows;
}

// Add new tenant
async function addTenant(shopName, dbName, adminUsername, plan = 'free') {
  const pool = getMasterPool();
  const [result] = await pool.query(
    'INSERT INTO `pos_master`.tenants (shop_name, db_name, admin_username, plan) VALUES (?, ?, ?, ?)',
    [shopName, dbName, adminUsername, plan]
  );
  return result.insertId;
}

// ⭐️ Soft delete tenant — ซ่อนจากรายการ + ปิดใช้งานทันที (ข้อมูลใน tenant DB ยังอยู่ครบ
//    กู้คืนได้โดยเคลียร์ deleted_at กลับเป็น NULL)
async function softDeleteTenant(id) {
  await ensureDeletedAtColumn();
  const pool = getMasterPool();
  const [result] = await pool.query(
    'UPDATE `pos_master`.tenants SET deleted_at = NOW(), is_active = 0 WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  return result.affectedRows > 0;
}

// Update tenant last login
async function updateLastLogin(dbName) {
  const pool = getMasterPool();
  await pool.query('UPDATE `pos_master`.tenants SET last_login = NOW() WHERE db_name = ?', [dbName]);
}

// ⭐️ Get connection pool for a specific tenant (reuses existing pool via tenantDB.getOrCreatePool)
// NOTE: Direct callers should prefer tenantDB.getOrCreatePool() which maintains a pool cache.
// This function creates a NEW pool each time — use only for one-off admin operations.
async function getTenantConnection(dbName) {
  return mysql.createPool({
    host: MASTER_DB_CONFIG.host,
    user: MASTER_DB_CONFIG.user,
    password: MASTER_DB_CONFIG.password,
    database: dbName,
    port: config.DB_PORT || 3306,
    charset: 'utf8mb4',
    timezone: '+07:00',
    waitForConnections: true,
    connectionLimit: 10,
    ...(sslOption ? { ssl: sslOption } : {})
  });
}

module.exports = {
  initMasterDB,
  getTenantByDbName,
  getAllTenants,
  addTenant,
  updateLastLogin,
  softDeleteTenant,
  ensureDeletedAtColumn,
  getTenantConnection,
  getMasterPool
};
