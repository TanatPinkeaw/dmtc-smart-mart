// middleware/tenantDB.js — Middleware สลับ database ตาม tenant ที่ login
// อ่าน db_name จาก JWT → เชื่อมต่อ database ของ tenant นั้น → ใส่ req.db

const { getTenantByDbName, getTenantConnection } = require('../config/tenantRegistry');

// Pool cache — เก็บ connection pool แยกตาม dbName เพื่อไม่ต้องสร้างใหม่ทุก request
const poolCache = new Map();

async function getOrCreatePool(dbName) {
  if (poolCache.has(dbName)) {
    return poolCache.get(dbName);
  }
  
  const pool = require('mysql2/promise').createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    waitForConnections: true,
    connectionLimit: 10
  });
  
  poolCache.set(dbName, pool);
  return pool;
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

module.exports = { tenantDB, getTenantInfo, getOrCreatePool };
