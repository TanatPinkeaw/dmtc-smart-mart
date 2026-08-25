// utils/storeConfig.js — Helper ดึง store name จาก settings/tenant config แทน hardcoded
// ใช้ร่วมกันทั้ง email templates, LINE messages, receipt, etc.

const pool = require('../config/db');

// Cache store names to avoid hitting DB on every request
const storeNameCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get store name for a tenant
 * @param {number|null} tenantId - tenant_id (null = default tenant)
 * @returns {Promise<string>} store name
 */
async function getStoreName(tenantId = null) {
  const cacheKey = tenantId || 'default';
  const cached = storeNameCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return cached.name;
  }

  try {
    const tid = tenantId || 1;
    const [rows] = await pool.query(
      'SELECT store_name FROM settings WHERE tenant_id = ? LIMIT 1',
      [tid]
    );
    const name = rows[0]?.store_name || 'DMTC Mart';
    storeNameCache.set(cacheKey, { name, time: Date.now() });
    return name;
  } catch {
    return 'DMTC Mart'; // fallback
  }
}

/**
 * Get full tenant config
 * @param {number|null} tenantId
 * @returns {Promise<object>}
 */
async function getTenantConfig(tenantId = null) {
  const tid = tenantId || 1;
  const [rows] = await pool.query('SELECT * FROM tenants WHERE id = ?', [tid]);
  return rows[0] || { name: 'DMTC Mart', slug: 'dmtc-mart', plan: 'free' };
}

/**
 * Get LINE LIFF ID for a tenant
 * @param {number|null} tenantId
 * @returns {Promise<string|null>}
 */
async function getLiffId(tenantId = null) {
  const config = await getTenantConfig(tenantId);
  return config.line_liff_id || null;
}

/**
 * Invalidate cache (call after settings update)
 */
function invalidateCache(tenantId = null) {
  const cacheKey = tenantId || 'default';
  storeNameCache.delete(cacheKey);
}

module.exports = { getStoreName, getTenantConfig, getLiffId, invalidateCache };
