// routes/adminDashboard.js — Super Admin Dashboard API
// จัดการ customers ทั้งหมด (สร้าง/ดู/ปิดใช้งาน)
const express = require('express');
const { requireRole } = require('../middleware/guards');
const router = express.Router();
const { getAllTenants, addTenant, getMasterPool, softDeleteTenant, ensureDeletedAtColumn, getTenantByDbName } = require('../config/tenantRegistry');
const { removePoolFromCache } = require('../middleware/tenantDB');
const logAudit = require('../utils/auditLog').logAudit;
const { provisionTenant } = require('../scripts/provisionTenant');

// GET /api/admin/dashboard — Overview stats
router.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const tenants = await getAllTenants();
    
    // Get stats for each tenant
    const enrichedTenants = await Promise.all(tenants.map(async (t) => {
      try {
        const pool = require('../middleware/tenantDB').getOrCreatePool(t.db_name);
        const [[userCount]] = await pool.query('SELECT COUNT(*) as cnt FROM users');
        const [[productCount]] = await pool.query('SELECT COUNT(*) as cnt FROM products');
        const [[orderCount]] = await pool.query('SELECT COUNT(*) as cnt FROM orders');
        const [[saleTotal]] = await pool.query('SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE status = "COMPLETED"');
        
        return {
          ...t,
          user_count: userCount.cnt,
          product_count: productCount.cnt,
          order_count: orderCount.cnt,
          total_revenue: saleTotal.total
        };
      } catch (err) {
        return { ...t, user_count: 0, product_count: 0, order_count: 0, total_revenue: 0 };
      }
    }));
    
    res.json({
      total_tenants: tenants.length,
      active_tenants: tenants.filter(t => t.is_active).length,
      tenants: enrichedTenants
    });
  } catch (error) {
    // ⭐️ log error.code ด้วย (ER_BAD_DB_ERROR/ER_NO_SUCH_TABLE/EACCES...) — Render logs ชี้สาเหตุได้ทันที
    console.error(`[ADMIN_DASHBOARD][GET /] ${error.code || 'NO_CODE'}:`, error.message);
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูล dashboard ได้' });
  }
});

// POST /api/admin/dashboard/create — Create new tenant
router.post('/create', requireRole('ADMIN'), async (req, res) => {
  const { shop_name, admin_username, admin_password, plan } = req.body;
  
  if (!shop_name || !admin_username || !admin_password) {
    return res.status(400).json({ error: 'ต้องระบุ shop_name, admin_username, admin_password' });
  }
  
  try {
    // Generate DB name
    const dbName = 'pos_' + shop_name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_g/, '')
      .substring(0, 30);
    
    // Provision tenant (create DB + tables + admin user)
    const result = await provisionTenant(shop_name, admin_username, admin_password);
    
    // Register in master DB
    await addTenant(shop_name, result.dbName, admin_username, plan || 'free');
    
    res.status(201).json({
      message: 'สร้างระบบสำหรับ ' + shop_name + ' สำเร็จ!',
      db_name: result.dbName,
      admin_username: result.adminUsername,
      admin_password: result.adminPassword
    });
  } catch (error) {
    console.error(`[ADMIN_DASHBOARD][POST /create] ${error.code || 'NO_CODE'}:`, error.message);
    res.status(500).json({ error: 'ไม่สามารถสร้างระบบได้: ' + error.message });
  }
});

// PUT /api/admin/dashboard/tenant/:id/toggle — Toggle tenant active status
router.put('/tenant/:id/toggle', requireRole('ADMIN'), async (req, res) => {
  try {
    await ensureDeletedAtColumn();
    const pool = getMasterPool();
    const [result] = await pool.query('UPDATE tenants SET is_active = NOT is_active WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบ tenant หรือถูกลบไปแล้ว' });
    res.json({ message: 'อัปเดตสถานะสำเร็จ' });
  } catch (error) {
    console.error(`[ADMIN_DASHBOARD][PUT toggle] ${error.code || 'NO_CODE'}:`, error.message);
    res.status(500).json({ error: 'ไม่สามารถอัปเดตสถานะได้' });
  }
});

// DELETE /api/admin/dashboard/tenant/:id — Soft delete (ซ่อนจากรายการ + ปิดใช้งาน, ข้อมูล tenant DB ยังอยู่)
router.delete('/tenant/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    // ⭐️ Get tenant info BEFORE soft delete (to evict pool cache)
    const masterPool = getMasterPool();
    const [[tenant]] = await masterPool.query('SELECT db_name FROM tenants WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!tenant) return res.status(404).json({ error: 'ไม่พบ tenant หรือถูกลบไปแล้ว' });
    const deleted = await softDeleteTenant(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'ไม่พบ tenant หรือถูกลบไปแล้ว' });
    // ⭐️ Evict pool from cache to prevent memory leak
    removePoolFromCache(tenant.db_name);
    logAudit(getMasterPool(), 'POS_ADMIN_DELETE_TENANT', req.user.id, { db_name: tenant.db_name }, 'TENANT', req.params.id).catch(() => {});
    res.json({ message: 'ลบร้านค้าสำเร็จ (soft delete — ข้อมูล database ยังเก็บไว้)' });
  } catch (error) {
    console.error(`[ADMIN_DASHBOARD][DELETE tenant] ${error.code || 'NO_CODE'}:`, error.message);
    res.status(500).json({ error: 'ไม่สามารถลบร้านค้าได้' });
  }
});

// GET /api/admin/dashboard/tenant/:id — Get tenant details
router.get('/tenant/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const pool = getMasterPool();
    await ensureDeletedAtColumn();
    const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!tenant) return res.status(404).json({ error: 'ไม่พบ tenant' });
    
    // Get detailed stats from tenant's database
    try {
      const tenantPool = require('../middleware/tenantDB').getOrCreatePool(tenant.db_name);
      const [[users]] = await tenantPool.query('SELECT COUNT(*) as cnt FROM users');
      const [[products]] = await tenantPool.query('SELECT COUNT(*) as cnt FROM products');
      const [[orders]] = await tenantPool.query('SELECT COUNT(*) as cnt FROM orders');
      const [[sales]] = await tenantPool.query('SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE status = "COMPLETED"');
      const [userList] = await tenantPool.query('SELECT id, student_id, full_name, role, is_active FROM users');
      
      res.json({
        ...tenant,
        stats: {
          users: users.cnt,
          products: products.cnt,
          orders: orders.cnt,
          revenue: sales.total
        },
        users: userList
      });
    } catch (err) {
      res.json({ ...tenant, stats: { users: 0, products: 0, orders: 0, revenue: 0 }, users: [] });
    }
  } catch (error) {
    console.error(`[ADMIN_DASHBOARD][GET tenant/:id] ${error.code || 'NO_CODE'}:`, error.message);
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูล tenant ได้' });
  }
});

module.exports = router;
