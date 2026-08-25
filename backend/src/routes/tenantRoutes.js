// routes/tenantRoutes.js — CRUD สำหรับจัดการ tenants (Super Admin เท่านั้น)
const express = require('express');
const { requireRole } = require('../middleware/guards');
const router = express.Router();
const pool = require('../config/db');

// GET /api/tenants — list all tenants (Super Admin)
router.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT t.*, (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as user_count, ' +
      '(SELECT COUNT(*) FROM products WHERE tenant_id = t.id) as product_count ' +
      'FROM tenants t ORDER BY t.created_at DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูล tenants ได้' });
  }
});

// GET /api/tenants/:id — get tenant detail (Super Admin)
router.get('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'ไม่พบ tenant' });
    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูล tenant ได้' });
  }
});

// POST /api/tenants — create new tenant (Super Admin)
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const { name, slug, plan, line_liff_id, line_channel_id, line_channel_secret } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: 'ต้องระบุ name และ slug' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO tenants (name, slug, plan, line_liff_id, line_channel_id, line_channel_secret) VALUES (?, ?, ?, ?, ?, ?)',
      [name, slug, plan || 'free', line_liff_id || null, line_channel_id || null, line_channel_secret || null]
    );
    
    // Create default settings for the new tenant
    await pool.query(
      'INSERT INTO settings (tenant_id, store_name, tax_id, address, receipt_footer) VALUES (?, ?, ?, ?, ?)',
      [result.insertId, name, '', '', 'ขอบคุณที่ใช้บริการ']
    );
    
    // Create default admin user for the new tenant
    const bcrypt = require('bcrypt');
    const defaultPassword = await bcrypt.hash('admin123', 10);
    await pool.query(
      'INSERT INTO users (student_id, password, full_name, role, tenant_id) VALUES (?, ?, ?, ?, ?)',
      ['admin-' + slug, defaultPassword, 'Admin ' + name, 'ADMIN', result.insertId]
    );
    
    res.status(201).json({ 
      message: 'สร้าง tenant สำเร็จ',
      tenant_id: result.insertId,
      default_credentials: { username: 'admin-' + slug, password: 'admin123' }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'slug นี้ถูกใช้แล้ว' });
    }
    console.error('[500]', error.message);
    res.status(500).json({ error: 'ไม่สามารถสร้าง tenant ได้' });
  }
});

// PUT /api/tenants/:id — update tenant (Super Admin)
router.put('/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, slug, plan, line_liff_id, line_channel_id, line_channel_secret, is_active, max_users, max_products } = req.body;
  try {
    await pool.query(
      `UPDATE tenants SET name = COALESCE(?, name), slug = COALESCE(?, slug), plan = COALESCE(?, plan),
       line_liff_id = COALESCE(?, line_liff_id), line_channel_id = COALESCE(?, line_channel_id),
       line_channel_secret = COALESCE(?, line_channel_secret), is_active = COALESCE(?, is_active),
       max_users = COALESCE(?, max_users), max_products = COALESCE(?, max_products)
       WHERE id = ?`,
      [name, slug, plan, line_liff_id, line_channel_id, line_channel_secret, is_active, max_users, max_products, req.params.id]
    );
    
    // Also update settings.store_name if name changed
    if (name) {
      await pool.query('UPDATE settings SET store_name = ? WHERE tenant_id = ?', [name, req.params.id]);
    }
    
    res.json({ message: 'อัปเดต tenant สำเร็จ' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'slug นี้ถูกใช้แล้ว' });
    }
    console.error('[500]', error.message);
    res.status(500).json({ error: 'ไม่สามารถอัปเดต tenant ได้' });
  }
});

// DELETE /api/tenants/:id — soft delete tenant (Super Admin)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query('UPDATE tenants SET is_active = FALSE WHERE id = ?', [req.params.id]);
    res.json({ message: 'ปิดใช้งาน tenant แล้ว' });
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'ไม่สามารถปิดใช้งาน tenant ได้' });
  }
});

// GET /api/tenants/:id/stats — get tenant usage stats (Super Admin)
router.get('/:id/stats', requireRole('ADMIN'), async (req, res) => {
  try {
    const tenantId = req.params.id;
    const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    if (!tenant) return res.status(404).json({ error: 'ไม่พบ tenant' });
    
    const [[userCount]] = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ?', [tenantId]);
    const [[productCount]] = await pool.query('SELECT COUNT(*) as cnt FROM products WHERE tenant_id = ?', [tenantId]);
    const [[orderCount]] = await pool.query('SELECT COUNT(*) as cnt FROM orders WHERE tenant_id = ?', [tenantId]);
    const [[saleCount]] = await pool.query('SELECT COUNT(*) as cnt FROM sales WHERE tenant_id = ?', [tenantId]);
    
    res.json({
      plan: tenant.plan,
      max_users: tenant.max_users,
      max_products: tenant.max_products,
      current_users: userCount.cnt,
      current_products: productCount.cnt,
      total_orders: orderCount.cnt,
      total_sales: saleCount.cnt,
    });
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'ไม่สามารถดึงสถิติ tenant ได้' });
  }
});

module.exports = router;
