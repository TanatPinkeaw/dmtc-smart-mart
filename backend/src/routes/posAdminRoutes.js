// routes/posAdminRoutes.js — POS Admin Management Routes (per-tenant)
// Uses req.db (tenant-specific pool) for all queries

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { requireRole } = require('../middleware/guards');
const { serverError, badRequest, unauthorized } = require('../utils/http');

router.post('/login', async (req, res) => {
  const { username, password, db_name } = req.body;
  if (!username || !password || !db_name) return badRequest(res, 'ต้องระบุ username, password, และ db_name');
  try {
    const { getOrCreatePool, removePoolFromCache } = require('../middleware/tenantDB');
    let tenantPool;
    try {
      tenantPool = await getOrCreatePool(db_name);
      // ⭐️ Validate pool actually connects (catch bad db_name early)
      await tenantPool.query('SELECT 1');
    } catch (poolErr) {
      // ⭐️ Remove broken pool from cache so next attempt creates fresh pool
      removePoolFromCache(db_name);
      throw poolErr; // re-throw to outer catch
    }
    const [users] = await tenantPool.query('SELECT * FROM users WHERE student_id = ? AND is_active = TRUE LIMIT 1', [username]);
    if (users.length === 0) return unauthorized(res, 'รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง');
    const user = users[0];
    if (!(await bcrypt.compare(password, user.password))) return unauthorized(res, 'รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง');
    if (user.role !== 'ADMIN' && user.role !== 'MANAGER') return unauthorized(res, 'ไม่มีสิทธิ์เข้าถึงหน้าจัดการร้าน');
    const [settings] = await tenantPool.query('SELECT store_name FROM settings LIMIT 1');
    res.json({ success: true, user: { id: user.id, student_id: user.student_id, full_name: user.full_name, role: user.role }, store_name: settings[0]?.store_name || 'POS Store', db_name });
  } catch (err) {
    console.error('[POS_ADMIN_LOGIN]', err.code || 'NO_CODE', err.message);
    // ⭐️ ครอบคลุมทุก connection/DB error ที่เป็นไปได้
    const code = err.code || '';
    const msg = String(err.message || '');
    const isConnectionError = ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','PROTOCOL_CONNECTION_LOST'].includes(code) || msg.includes('getaddrinfo') || msg.includes('connect') || msg.includes('timeout');
    const isDBError = ['ER_BAD_DB_ERROR','ER_ACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR'].includes(code);
    const isTableError = ['ER_NO_SUCH_TABLE','ER_NO_SUCH_INDEX'].includes(code);
    if (isConnectionError || isDBError) {
      return badRequest(res, 'ไม่พบฐานข้อมูลร้านนี้ (db_name: ' + db_name + ') — กรุณาตรวจสอบว่าร้านนี้ถูกสร้างแล้ว');
    }
    if (isTableError) {
      return badRequest(res, 'ฐานข้อมูลร้านนี้ยังไม่สมบูรณ์ — ตารางบางตารางหายไป กรุณาติดต่อผู้ดูแลระบบ');
    }
    serverError(res);
  }
});

router.get('/stats', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const db = req.db;
    const [[u]] = await db.query('SELECT COUNT(*) as cnt FROM users');
    const [[p]] = await db.query('SELECT COUNT(*) as cnt FROM products WHERE is_active = 1');
    const [[s]] = await db.query("SELECT COALESCE(SUM(total_amount),0) as t FROM sales WHERE status='COMPLETED' AND DATE(created_at)=CURDATE()");
    res.json({ users: u.cnt, products: p.cnt, today_sales: s.t });
  } catch (e) { serverError(res); }
});

router.get('/products', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try { const [r] = await req.db.query('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id ORDER BY p.name'); res.json(r); }
  catch (e) { serverError(res); }
});

router.post('/products', requireRole('ADMIN'), async (req, res) => {
  const { barcode, name, category_id, price, cost, stock } = req.body;
  if (!name) return badRequest(res, 'ต้องระบุชื่อสินค้า');
  try { const [r] = await req.db.query('INSERT INTO products (barcode,name,category_id,price,cost,stock) VALUES (?,?,?,?,?,?)', [barcode||null,name,category_id||null,price||0,cost||0,stock||0]); res.status(201).json({ id: r.insertId }); }
  catch (e) { if (e.code==='ER_DUP_ENTRY') return badRequest(res,'บาร์โค้ดซ้ำ'); serverError(res); }
});

router.put('/products/:id', requireRole('ADMIN'), async (req, res) => {
  const { barcode, name, category_id, price, cost, stock } = req.body;
  try { await req.db.query('UPDATE products SET barcode=?,name=?,category_id=?,price=?,cost=?,stock=? WHERE id=?', [barcode||null,name,category_id||null,price,cost,stock,req.params.id]); res.json({ message: 'สำเร็จ' }); }
  catch (e) { serverError(res); }
});

router.delete('/products/:id', requireRole('ADMIN'), async (req, res) => {
  try { await req.db.query('DELETE FROM products WHERE id=?', [req.params.id]); res.json({ message: 'ลบสำเร็จ' }); } catch (e) { serverError(res); }
});

router.get('/categories', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try { const [r] = await req.db.query('SELECT * FROM categories ORDER BY id'); res.json(r); } catch (e) { serverError(res); }
});

router.post('/categories', requireRole('ADMIN'), async (req, res) => {
  const { name } = req.body; if (!name) return badRequest(res, 'ต้องระบุชื่อ');
  try { const [r] = await req.db.query('INSERT INTO categories (name) VALUES (?)', [name]); res.status(201).json({ id: r.insertId }); } catch (e) { serverError(res); }
});

router.delete('/categories/:id', requireRole('ADMIN'), async (req, res) => {
  try { await req.db.query('DELETE FROM categories WHERE id=?', [req.params.id]); res.json({ message: 'ลบสำเร็จ' }); } catch (e) { serverError(res); }
});

router.get('/users', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try { const [r] = await req.db.query('SELECT id,student_id,full_name,phone_number,role,points,is_active FROM users ORDER BY created_at DESC'); res.json(r); } catch (e) { serverError(res); }
});

router.get('/settings', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try { const [r] = await req.db.query('SELECT * FROM settings WHERE id=1'); res.json(r[0]||{}); } catch (e) { serverError(res); }
});

router.put('/settings', requireRole('ADMIN'), async (req, res) => {
  const { store_name, tax_id, address, receipt_footer } = req.body;
  try { await req.db.query('UPDATE settings SET store_name=?,tax_id=?,address=?,receipt_footer=? WHERE id=1', [store_name,tax_id,address,receipt_footer]); res.json({ message: 'สำเร็จ' }); } catch (e) { serverError(res); }
});

router.get('/reports/daily', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try { const [r] = await req.db.query("SELECT DATE(created_at) as date,COUNT(*) as bills,SUM(total_amount) as total FROM sales WHERE status='COMPLETED' GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30"); res.json(r); } catch (e) { serverError(res); }
});

router.get('/reports/top-selling', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try { const [r] = await req.db.query("SELECT p.name,SUM(si.quantity) as qty,SUM(si.subtotal) as revenue FROM sale_items si JOIN sales s ON si.sale_id=s.id JOIN products p ON si.product_id=p.id WHERE s.status='COMPLETED' GROUP BY p.name ORDER BY qty DESC LIMIT 10"); res.json(r); } catch (e) { serverError(res); }
});

module.exports = router;
