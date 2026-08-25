// middleware/tenant.js — Tenant scope middleware
// Reads tenant_id from req.user (JWT) and makes it available for all downstream queries.
// In multi-tenant mode, every query should filter by tenant_id.

/**
 * Middleware: inject tenant_id from JWT into req.tenantId
 * Must be used AFTER authenticateToken middleware
 */
function tenantScope(req, res, next) {
  req.tenantId = req.user?.tenant_id || null;
  next();
}

/**
 * Helper: wrap a query to auto-inject tenant_id WHERE clause
 * Usage: const rows = await tenantQuery(conn, 'SELECT * FROM products WHERE category_id = ?', [catId], req.tenantId);
 */
async function tenantQuery(conn, sql, params = [], tenantId = null) {
  if (tenantId === null) return conn.query(sql, params);
  
  // Simple approach: append tenant_id filter
  // For INSERT: auto-inject tenant_id
  // For SELECT/UPDATE/DELETE: append WHERE tenant_id = ?
  const trimmed = sql.trim().toUpperCase();
  
  if (trimmed.startsWith('INSERT')) {
    // For INSERT, we need to inject tenant_id into the column list
    // This is a simplified version - in production, use a query builder
    return conn.query(sql, params);
  }
  
  // For SELECT/UPDATE/DELETE with WHERE clause
  if (trimmed.includes('WHERE')) {
    // Append AND tenant_id = ? before ORDER BY / LIMIT / GROUP BY
    const whereMatch = sql.match(/WHERE\s+/i);
    if (whereMatch) {
      const insertPos = whereMatch.index + whereMatch[0].length;
      // Check if there's already a tenant_id filter
      if (!sql.substring(insertPos).match(/tenant_id\s*=/i)) {
        const newSql = sql.substring(0, insertPos) + 'tenant_id = ? AND ' + sql.substring(insertPos);
        params = [tenantId, ...params];
        return conn.query(newSql, params);
      }
    }
  }
  
  // Fallback: return original query
  return conn.query(sql, params);
}

/**
 * Helper: check plan limits for a tenant
 */
async function checkPlanLimits(conn, tenantId, resource, count) {
  if (!tenantId) return true; // No tenant = no limits (backward compat)
  
  const [rows] = await conn.query(
    'SELECT plan, max_users, max_products FROM tenants WHERE id = ?',
    [tenantId]
  );
  
  if (rows.length === 0) return true; // Tenant not found = no limits
  
  const tenant = rows[0];
  const limits = {
    free: { max_users: 3, max_products: 100 },
    basic: { max_users: 5, max_products: 500 },
    pro: { max_users: 15, max_products: 2000 },
    enterprise: { max_users: 999, max_products: 99999 },
  };
  
  const limit = limits[tenant.plan] || limits.free;
  const currentLimit = resource === 'users' ? limit.max_users : limit.max_products;
  
  const [[{ cnt }]] = await conn.query(
    `SELECT COUNT(*) as cnt FROM ${resource} WHERE tenant_id = ?`,
    [tenantId]
  );
  
  return cnt + count <= currentLimit;
}

module.exports = { tenantScope, tenantQuery, checkPlanLimits };
