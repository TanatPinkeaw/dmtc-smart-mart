// middleware/tenantDB.js — Middleware สลับ database ตาม tenant ที่ login
// อ่าน db_name จาก JWT → เชื่อมต่อ database ของ tenant นั้น → ใส่ req.db

const { getTenantByDbName, getTenantConnection } = require('../config/tenantRegistry');
const config = require('../config/config');

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

// Pool cache — เก็บ connection pool แยกตาม dbName เพื่อไม่ต้องสร้างใหม่ทุก request
const poolCache = new Map();

async function getOrCreatePool(dbName) {
  if (poolCache.has(dbName)) {
    return poolCache.get(dbName);
  }
  
  const pool = require('mysql2/promise').createPool({
    host: config.DB_HOST || 'localhost',
    user: config.DB_USER || 'root',
    password: config.DB_PASSWORD || '',
    database: dbName,
    port: config.DB_PORT || 3306,  // ⭐️ ต้องมี port เหมือน db.js (Aiven ใช้ port ไม่ใช่ 3306)
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 8000,
    charset: 'utf8mb4',    // ⭐️ ตรงกับ db.js
    timezone: '+07:00',    // ⭐️ ตรงกับ db.js — สำคัญต่อ reports/NOW()
    ...(sslOption ? { ssl: sslOption } : {})
  });
  
  poolCache.set(dbName, pool);
  return pool;
}

// ⭐️ ลบ broken pool จาก cache เพื่อให้สร้างใหม่ได้ในภายหลัง
function removePoolFromCache(dbName) {
  poolCache.delete(dbName);
}

/**
 * Tenant DB middleware — สลับ database ตาม tenant ที่ login
 * ต้องใช้หลัง authenticateToken middleware
 */
async function tenantDB(req, res, next) {
  // ถ้าไม่มี user (public routes) → ข้าม
  if (!req.user || !req.user.db_name) {
    return next();
  }
  
  const dbName = req.user.db_name;
  
  try {
    // เชื่อมต่อ database ของ tenant
    req.db = await getOrCreatePool(dbName);
    req.dbName = dbName;
    next();
  } catch (err) {
    console.error(`[TENANT_DB] Failed to connect to ${dbName}:`, err.message);
    res.status(500).json({ error: 'ไม่สามารถเชื่อมต่อระบบได้' });
  }
}

/**
 * Helper: ดึงข้อมูล tenant จาก master DB
 */
async function getTenantInfo(dbName) {
  return getTenantByDbName(dbName);
}

module.exports = { tenantDB, getTenantInfo, getOrCreatePool, removePoolFromCache };
