const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { swaggerUi, specs } = require('./swagger');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const { exec } = require('child_process');
const cron = require('node-cron');
const upload = multer({ dest: 'uploads/' });

// 1. นำเข้า http และ socket.io
const http = require('http');
const { Server } = require('socket.io');

require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ ไม่พบ JWT_SECRET ใน .env — ห้ามรันระบบโดยไม่มีค่านี้');
  process.exit(1);
}

const app = express();

// 2. สร้าง HTTP Server ครอบ Express
const server = http.createServer(app);

// 3. ตั้งค่า Socket.io 
const io = new Server(server, {
  cors: {
    origin: "*", // ช่วง Dev อนุญาตให้ React (พอร์ตอื่น) เข้าถึงได้
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
  }
});

// 4. แทรค io เข้าไปใน req (ไม้ตายลับ!) 
// ทำให้เราสั่ง Socket ส่งข้อมูลจากใน API ได้เลย เช่น ตอนกดจ่ายเงินสำเร็จ
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use(cors());
app.use(express.json());

// ⭐️ เพิ่ม 2 บรรทัดนี้ เพื่อให้ฝั่ง Frontend ดึงรูปสลิปไปแสดงได้
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// =========================================
// AUTH MIDDLEWARE — ตรวจ JWT ทุก request ยกเว้น path ที่ระบุไว้
// =========================================
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/users/register',   // สมัครสมาชิกหน้าเคาน์เตอร์ (ยังไม่มี token)
  '/api/docs',
  '/api/init-db',          // bootstrap เท่านั้น — guard ด้วย SETUP_KEY แทน JWT (ดูด้านล่าง)
  '/api/seed-data',
  '/api/create-admin',
];

// ป้องกัน endpoint bootstrap ทั้ง 3 ตัว ด้วย key ลับใน .env
// เรียกใช้แบบ: GET /api/init-db?key=xxxxx
function requireSetupKey(req, res, next) {
  const key = req.query.key;
  if (!process.env.SETUP_KEY) {
    return res.status(503).json({ error: 'ปิดใช้งาน bootstrap endpoint นี้แล้ว (ไม่พบ SETUP_KEY ใน .env)' });
  }
  if (key !== process.env.SETUP_KEY) {
    return res.status(403).json({ error: 'setup key ไม่ถูกต้อง' });
  }
  next();
}

function authenticateToken(req, res, next) {
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) return next();

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'ไม่ได้รับอนุญาต กรุณาเข้าสู่ระบบ' });

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(403).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    req.user = payload; // { id, role, full_name }
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอสำหรับการดำเนินการนี้' });
    }
    next();
  };
}

app.use(authenticateToken);

// ⭐️ ตรวจสอบสต๊อกใกล้หมด (เกณฑ์ <=10 ชิ้น ตาม /api/inventory/low-stock) แล้วสร้างแจ้งเตือนระบบ
// แจ้งเฉพาะตอนสต๊อก "ตกลงมาต่ำกว่าเกณฑ์ครั้งแรก" (ข้าม threshold) กันแจ้งซ้ำทุกบิลที่ตัดสต๊อก
// ⚠️ บันทึก notification ลง DB ภายใน transaction แต่ "ไม่ emit" ตรงนี้ — คืน message กลับไปให้ผู้เรียก emit หลัง commit
//    (กัน race: ถ้า emit ก่อน commit client จะรีเฟรชแล้วเจอข้อมูลเก่า)
const LOW_STOCK_THRESHOLD = 10;
async function notifyIfLowStock(conn, io, productId, stockBefore, stockAfter) {
  if (stockBefore > LOW_STOCK_THRESHOLD && stockAfter <= LOW_STOCK_THRESHOLD) {
    const [rows] = await conn.query('SELECT name FROM products WHERE id = ?', [productId]);
    const productName = rows[0]?.name || `#${productId}`;
    const msg = `สินค้า "${productName}" สต๊อกใกล้หมด เหลือ ${stockAfter} ชิ้น`;
    await conn.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [msg]);
    return msg; // คืน message ให้ผู้เรียกเก็บไว้ emit หลัง commit
  }
  return null;
}

// ⭐️ คำนวณส่วนลดของโปรโมชั่น รองรับ PERCENT/FIXED/BOGO (BOGO ต้องมี items ของตะกร้าเพื่อเช็คจำนวนจริง)
// queryFn คือ conn.query หรือ pool.query แล้วแต่บริบท (ใน transaction หรือ preview เฉยๆ)
async function calculatePromotionDiscount(queryFn, promo, totalAmount, items) {
  if (promo.discount_type === 'PERCENT') {
    return Math.min((totalAmount * Number(promo.discount_value)) / 100, totalAmount);
  }
  if (promo.discount_type === 'FIXED') {
    return Math.min(Number(promo.discount_value), totalAmount);
  }
  if (promo.discount_type === 'BOGO') {
    if (!promo.buy_product_id || !promo.buy_qty || !promo.free_product_id || !promo.free_qty || !items) return 0;

    const sameProduct = Number(promo.buy_product_id) === Number(promo.free_product_id);
    const buyQty = items.filter(i => Number(i.product_id) === Number(promo.buy_product_id)).reduce((sum, i) => sum + Number(i.quantity), 0);
    const freeQtyInCart = items.filter(i => Number(i.product_id) === Number(promo.free_product_id)).reduce((sum, i) => sum + Number(i.quantity), 0);

    let freeUnitsGranted;
    if (sameProduct) {
      // ซื้อ X แถม Y ของชิ้นเดียวกัน (เช่น ซื้อ1แถม1 = ต้องมีในตะกร้าครบ buy_qty+free_qty ต่อ 1 เซ็ต)
      const setSize = Number(promo.buy_qty) + Number(promo.free_qty);
      const sets = Math.floor(buyQty / setSize);
      freeUnitsGranted = sets * Number(promo.free_qty);
    } else {
      // ซื้อสินค้า A ครบ แถมสินค้า B (คนละตัว) — B ต้องมีในตะกร้าด้วย
      if (buyQty < promo.buy_qty || freeQtyInCart === 0) return 0;
      const freeSets = Math.floor(buyQty / Number(promo.buy_qty));
      freeUnitsGranted = Math.min(freeSets * Number(promo.free_qty), freeQtyInCart);
    }
    if (freeUnitsGranted <= 0) return 0;

    const [freeProductRows] = await queryFn('SELECT price FROM products WHERE id = ?', [promo.free_product_id]);
    if (freeProductRows.length === 0) return 0;
    return Math.min(freeUnitsGranted * Number(freeProductRows[0].price), totalAmount);
  }
  return 0;
}

// ⭐️ เช็คสิทธิ์การใช้โปรโมชั่น (usage_limit รวม + usage_limit_per_user) คืน error message หรือ null ถ้าใช้ได้
async function checkPromotionUsageLimit(queryFn, promo, memberId) {
  if (promo.usage_limit != null && promo.usage_count >= promo.usage_limit) {
    return "โปรโมชั่นนี้ถูกใช้ครบจำนวนสิทธิ์แล้ว";
  }
  if (promo.usage_limit_per_user != null) {
    if (!memberId) return "โปรโมชั่นนี้จำกัดสิทธิ์ต่อคน กรุณาระบุสมาชิกก่อนใช้สิทธิ์";
    const [rows] = await queryFn('SELECT COUNT(*) as cnt FROM promotion_usages WHERE promotion_id = ? AND member_id = ?', [promo.id, memberId]);
    if (rows[0].cnt >= promo.usage_limit_per_user) return "คุณใช้สิทธิ์โปรโมชั่นนี้ครบจำนวนแล้ว";
  }
  return null;
}

// =========================================
// ตั้งค่าเหตุการณ์ (Events) ของ Socket.io
// =========================================
io.on('connection', (socket) => {
  console.log(`🟢 มีหน้าจอ POS เชื่อมต่อเข้ามาแล้ว: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`🔴 หน้าจอ POS ปิดการเชื่อมต่อ: ${socket.id}`);
  });
});

// Swagger Document Endpoint
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(specs));

// =========================================
// 3. CATEGORIES (ระบบหมวดหมู่สินค้า)
// =========================================

/**
 * @swagger
 * /api/categories:
 *   get:
 *     summary: ดึงหมวดหมู่ทั้งหมด
 *     tags: [Categories]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/categories:
 *   post:
 *     summary: เพิ่มหมวดหมู่ใหม่
 *     tags: [Categories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: เพิ่มสำเร็จ
 */
app.post('/api/categories', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "กรุณาระบุชื่อหมวดหมู่" });

  try {
    const [result] = await pool.query('INSERT INTO categories (name) VALUES (?)', [name]);
    res.status(201).json({ id: result.insertId, name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/categories/{id}:
 *   delete:
 *     summary: ลบหมวดหมู่
 *     tags: [Categories]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: ลบสำเร็จ
 */
app.delete('/api/categories/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.json({ message: "ลบหมวดหมู่สำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// 4. PRODUCTS & INVENTORY (ระบบสินค้าและคลัง)
// =========================================

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: ดึงข้อมูลสินค้าทั้งหมด (รองรับการค้นหาและฟิลเตอร์หมวดหมู่)
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: ค้นหาจากชื่อหรือบาร์โค้ด
 *       - in: query
 *         name: category_id
 *         schema:
 *           type: integer
 *         description: ฟิลเตอร์ตาม ID หมวดหมู่
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/products', async (req, res) => {
  try {
    const { search, category_id } = req.query;
    let query = `
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (p.name LIKE ? OR p.barcode LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category_id) {
      query += ` AND p.category_id = ?`;
      params.push(category_id);
    }

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: เพิ่มสินค้าใหม่
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - price
 *             properties:
 *               barcode:
 *                 type: string
 *               name:
 *                 type: string
 *               category_id:
 *                 type: integer
 *               price:
 *                 type: number
 *               stock:
 *                 type: integer
 *               image_url:
 *                 type: string
 *     responses:
 *       201:
 *         description: เพิ่มสำเร็จ
 */
app.post('/api/products', async (req, res) => {
  const { barcode, name, category_id, price, stock = 0, image_url, vendor_id, gp_rate } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO products (barcode, name, category_id, price, stock, image_url, vendor_id, gp_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [barcode || null, name, category_id || null, price, stock, image_url || null, vendor_id || null, gp_rate || 0]
    );
    res.status(201).json({ id: result.insertId, message: "เพิ่มสินค้าสำเร็จ" });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: "บาร์โค้ดนี้ซ้ำกับในระบบแล้ว" });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   put:
 *     summary: แก้ไขรายละเอียดสินค้า
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               barcode:
 *                 type: string
 *               name:
 *                 type: string
 *               category_id:
 *                 type: integer
 *               price:
 *                 type: number
 *               image_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: อัปเดตสำเร็จ
 */
app.put('/api/products/:id', requireRole('ADMIN'), async (req, res) => {
  const { barcode, name, category_id, price, image_url, vendor_id, gp_rate } = req.body;
  try {
    await pool.query(
      'UPDATE products SET barcode=?, name=?, category_id=?, price=?, image_url=?, vendor_id=?, gp_rate=? WHERE id=?',
      [barcode || null, name, category_id || null, price, image_url || null, vendor_id || null, gp_rate || null, req.params.id]
    );
    res.json({ message: "อัปเดตข้อมูลสินค้าสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: ลบสินค้า
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: ลบสำเร็จ
 */
app.delete('/api/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=?', [req.params.id]);
    res.json({ message: "ลบสินค้าสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// 1. AUTH & USERS (ระบบเข้าสู่ระบบและพนักงาน)
// =========================================
/**
 * @swagger
 * /api/auth/login:
 * post:
 * summary: ล็อกอินเข้าสู่ระบบ (รหัสนักศึกษา / เลขบัตรประชาชน)
 * tags: [Auth]
 */
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body; // หน้าเว็บส่งช่อง username มา เราจะเอาไปเทียบกับ student_id
  try {
    const [users] = await pool.query('SELECT * FROM users WHERE student_id = ? AND is_active = TRUE', [username]);
    if (users.length === 0) return res.status(401).json({ error: "รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง" });

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง" });

    // สร้าง Token
    const token = jwt.sign(
      { id: user.id, role: user.role, full_name: user.full_name },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ message: "ล็อกอินสำเร็จ", token, user: { id: user.id, student_id: user.student_id, full_name: user.full_name, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users/search:
 * get:
 * summary: ค้นหาผู้ใช้งานด้วยเบอร์โทรศัพท์ หรือ รหัสนักศึกษา (สำหรับแคชเชียร์)
 * tags: [Users]
 */
app.get('/api/users/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "กรุณาระบุคำค้นหา" });

  try {
    // ค้นหาทั้งจาก student_id และ phone_number
    const [rows] = await pool.query(
      'SELECT id, student_id, full_name, phone_number, points, role FROM users WHERE student_id = ? OR phone_number = ?',
      [q, q]
    );
    if (rows.length === 0) return res.status(404).json({ error: "ไม่พบข้อมูลสมาชิก" });

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * @swagger
 * /api/users/register:
 * post:
 * summary: สมัครสมาชิกลูกค้าใหม่หน้าเคาน์เตอร์
 * tags: [Users]
 */
app.post('/api/users/register', async (req, res) => {
  const { student_id, full_name, phone_number } = req.body;
  if (!student_id || !full_name || !phone_number) {
    return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  }

  try {
    // ⭐️ ทริค: ตั้งรหัสผ่านเริ่มต้นเป็น "เบอร์โทรศัพท์" ไปก่อน 
    // อนาคตตอนทำระบบจองออนไลน์ ลูกค้าค่อยเอาเบอร์โทรไปล็อกอินแล้วเปลี่ยนรหัสผ่านเอง
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(phone_number, salt);

    const [result] = await pool.query(
      'INSERT INTO users (student_id, password, full_name, phone_number, role, points) VALUES (?, ?, ?, ?, ?, 0)',
      [student_id, hashedPassword, full_name, phone_number, 'MEMBER']
    );

    res.status(201).json({
      message: "สมัครสมาชิกสำเร็จ",
      user: { id: result.insertId, student_id, full_name, phone_number, points: 0 }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: "รหัสนักศึกษา หรือ เบอร์โทรศัพท์นี้ มีในระบบแล้ว" });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users/{id}/profile:
 * put:
 * summary: อัปเดตข้อมูลโปรไฟล์ (เปลี่ยนเบอร์โทร, ชื่อ หรือ รหัสผ่าน)
 * tags: [Users]
 */
app.put('/api/users/:id/profile', async (req, res) => {
  const userId = req.params.id;
  const { full_name, phone_number, new_password } = req.body;

  try {
    const conn = await pool.getConnection();

    // 1. เช็คก่อนว่าเบอร์โทรใหม่นี้ ไปซ้ำกับของคนอื่นในระบบไหม (ถ้ามีการเปลี่ยนเบอร์)
    let phoneChanged = false;
    if (phone_number) {
      const [existing] = await conn.query('SELECT id FROM users WHERE phone_number = ? AND id != ?', [phone_number, userId]);
      if (existing.length > 0) { conn.release(); return res.status(400).json({ error: "เบอร์โทรศัพท์นี้ถูกใช้งานโดยบัญชีอื่นแล้ว" }); }

      const [current] = await conn.query('SELECT phone_number, full_name FROM users WHERE id = ?', [userId]);
      phoneChanged = current.length > 0 && current[0].phone_number !== phone_number;
    }

    // 2. ถ้ามีการส่งรหัสผ่านใหม่มา ให้เข้ารหัสด้วย
    let query = 'UPDATE users SET full_name = COALESCE(?, full_name), phone_number = COALESCE(?, phone_number)';
    let params = [full_name, phone_number];

    if (new_password) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(new_password, salt);
      query += ', password = ?';
      params.push(hashedPassword);
    }

    query += ' WHERE id = ?';
    params.push(userId);

    await conn.query(query, params);

    // ⭐️ เบอร์โทรเปลี่ยน = อาจกระทบฐานข้อมูลรายชื่อภายนอก (Sheet) แจ้ง ADMIN ให้ไปปรับปรุงให้ตรงกัน
    if (phoneChanged) {
      const [userRow] = await conn.query('SELECT full_name FROM users WHERE id = ?', [userId]);
      const msg = `${userRow[0]?.full_name || 'ผู้ใช้'} เปลี่ยนเบอร์โทรศัพท์เป็น ${phone_number} กรุณาตรวจสอบ/ปรับปรุงฐานข้อมูลรายชื่อ (Sheet) ให้ตรงกัน`;
      await conn.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [msg]);
      req.io.emit('notifications_updated', { message: msg });
    }

    conn.release();

    res.json({ message: "อัปเดตข้อมูลบัญชีสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users:
 * get:
 *    summary: ดึงรายชื่อผู้ใช้งานทั้งหมด (พนักงาน + นักศึกษา)
 *    tags: [Users]
 * responses:
 *    200:
 *        description: สำเร็จ
 */
app.get('/api/users', async (req, res) => {
  try {
    // ⭐️ ทริค: ใช้ AS username เพื่อหลอกหน้าเว็บ React ให้ยังใช้งานได้โดยไม่ต้องไปแก้โค้ดฝั่งหน้าเว็บอีกรอบ
    const [rows] = await pool.query('SELECT id, student_id AS username, full_name, role, is_active FROM users');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: เพิ่มพนักงานใหม่ (เข้ารหัสผ่านด้วย bcrypt)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *               - full_name
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               full_name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [ADMIN, CASHIER]
 *     responses:
 *       201:
 *         description: สร้างสำเร็จ
 */
app.post('/api/users', async (req, res) => {
  const { username, password, full_name, role = 'CASHIER' } = req.body;
  try {
    // เข้ารหัสผ่านก่อนบันทึกลงฐานข้อมูล
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const [result] = await pool.query(
      'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, full_name, role]
    );
    res.status(201).json({ id: result.insertId, message: "สร้างพนักงานสำเร็จ" });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: "ชื่อผู้ใช้งานนี้มีในระบบแล้ว" });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: แก้ไขข้อมูลพนักงาน (เฉพาะชื่อและบทบาท)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [ADMIN, CASHIER]
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: อัปเดตสำเร็จ
 */
app.put('/api/users/:id', async (req, res) => {
  const { full_name, role, is_active } = req.body;
  try {
    await pool.query(
      'UPDATE users SET full_name = ?, role = ?, is_active = ? WHERE id = ?',
      [full_name, role, is_active, req.params.id]
    );
    res.json({ message: "อัปเดตข้อมูลพนักงานสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users/update-role:
 * put:
 * summary: อัปเดต Role ของนักศึกษาให้เป็นพนักงาน (CASHIER/ADMIN)
 * tags: [Users]
 */
app.put('/api/users/update-role', async (req, res) => {
  const { student_id, role } = req.body;
  try {
    const [result] = await pool.query(
      'UPDATE users SET role = ? WHERE student_id = ?',
      [role, student_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "ไม่พบรหัสนักศึกษานี้ในระบบ" });
    }

    res.json({ message: `อัปเดตสิทธิ์ ${student_id} เป็น ${role} สำเร็จ` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: ปิดการใช้งานพนักงาน (Soft Delete)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: ปิดการใช้งานสำเร็จ
 */
app.delete('/api/users/:id', async (req, res) => {
  try {
    // เราจะไม่ใช้ DELETE FROM users จริงๆ เพราะจะทำให้บิลเก่าพัง 
    // แต่เราจะใช้วิธีปิดสถานะ (Soft Delete) แทน
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [req.params.id]);
    res.json({ message: "ระงับการใช้งานพนักงานสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users/sync-csv:
 *   post:
 *     summary: ซิงค์รายชื่อผู้ใช้จาก CSV — ใครไม่มีในไฟล์จะถูกระงับการใช้งาน (soft delete, ไม่ลบจริงกันบิลเก่าพัง)
 *     tags: [Users]
 */
app.post('/api/users/sync-csv', requireRole('ADMIN'), async (req, res) => {
  // ⭐️ DEBUG: ดูว่า server ใหม่รับ request จริงไหม และ body มีอะไร
  console.log('[sync-csv] body keys:', Object.keys(req.body));
  console.log('[sync-csv] rows count:', req.body.rows?.length, '| dry_run:', req.body.dry_run);
  if (req.body.rows?.length > 0) console.log('[sync-csv] first row:', JSON.stringify(req.body.rows[0]));

  const { rows, dry_run } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "รายชื่อจาก CSV ว่างเปล่า ยกเลิกการซิงค์เพื่อความปลอดภัย" });
  }

  const usernames = rows.map(r => r.username).filter(Boolean);
  if (usernames.length === 0) return res.status(400).json({ error: "ไม่พบ username ในไฟล์" });

  try {
    const placeholders = usernames.map(() => '?').join(',');

    // 1. ใครอยู่ใน CSV แต่ไม่มีในระบบ → สร้างใหม่ (รวมทั้ง inactive ด้วย เพราะอาจถูก soft-delete ไปก่อน)
    const [existing] = await pool.query(`SELECT student_id, is_active FROM users WHERE student_id IN (${placeholders})`, usernames);
    const existingSet = new Set(existing.map(u => u.student_id));
    // ⭐️ คนที่มีอยู่แล้วแต่ถูก soft-delete → reactivate แทนสร้างใหม่
    const inactiveInCsv = existing.filter(u => !u.is_active).map(u => u.student_id);
    console.log('[sync-csv] existing:', existingSet.size, '| inactive:', inactiveInCsv.length);
    const toCreate = rows.filter(r => r.username && !existingSet.has(r.username));

    // 2. ใครอยู่ในระบบแต่ไม่มีใน CSV (ไม่ใช่ ADMIN) → ปิดการใช้งาน
    const [toDeactivate] = await pool.query(
      `SELECT id, student_id AS username, full_name, role FROM users WHERE role != 'ADMIN' AND is_active = TRUE AND student_id NOT IN (${placeholders})`,
      usernames
    );

    const toReactivate = existing.filter(u => !u.is_active);

    if (dry_run) return res.json({ to_create: toCreate, to_reactivate: toReactivate, to_deactivate: toDeactivate });

    // สร้างสมาชิกใหม่ (password = phone_number)
    let created_count = 0;
    for (const row of toCreate) {
      const phone = (row.phone_number || row.username).trim();
      const hashed = await bcrypt.hash(phone, 10);
      await pool.query(
        'INSERT INTO users (student_id, full_name, phone_number, password, role, is_active) VALUES (?, ?, ?, ?, \'MEMBER\', TRUE)',
        [row.username.trim(), (row.full_name || row.username).trim(), row.phone_number?.trim() || null, hashed]
      );
      created_count++;
    }

    // ⭐️ reactivate คนที่เคยถูก soft-delete + อัปเดตชื่อ/เบอร์
    let reactivated_count = 0;
    for (const u of toReactivate) {
      const row = rows.find(r => r.username === u.student_id);
      if (!row) continue;
      await pool.query(
        'UPDATE users SET is_active = TRUE, full_name = ?, phone_number = ? WHERE student_id = ?',
        [(row.full_name || u.student_id).trim(), row.phone_number?.trim() || null, u.student_id]
      );
      reactivated_count++;
    }

    // ปิดการใช้งานคนที่ไม่มีใน CSV
    if (toDeactivate.length > 0) {
      const ids = toDeactivate.map(u => u.id);
      await pool.query(`UPDATE users SET is_active = FALSE WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    }

    res.json({
      message: `เพิ่มใหม่ ${created_count} คน, เปิดใช้งานคืน ${reactivated_count} คน, ปิดการใช้งาน ${toDeactivate.length} คน`,
      created_count, reactivated_count, deactivated_count: toDeactivate.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// 2. SHIFT MANAGEMENT (ระบบจัดการกะการขาย)
// =========================================
/**
 * @swagger
 * /api/shifts/open:
 *   post:
 *     summary: เปิดกะ (บันทึกยอดเงินทอนตั้งต้นในลิ้นชัก)
 *     tags: [Shifts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cashier_id
 *               - opening_cash
 *             properties:
 *               cashier_id:
 *                 type: integer
 *               opening_cash:
 *                 type: number
 *     responses:
 *       201:
 *         description: เปิดกะสำเร็จ
 */
app.post('/api/shifts/open', async (req, res) => {
  const { cashier_id, opening_cash, cash_breakdown, open_photo } = req.body;
  if (!cashier_id || opening_cash === undefined) {
    return res.status(400).json({ error: "กรุณาระบุรหัสแคชเชียร์และเงินตั้งต้น" });
  }
  if (!open_photo) return res.status(400).json({ error: "กรุณาถ่ายรูปยืนยันสถานที่ก่อนเปิดกะ" });

  try {
    // ⭐️ แก้เป็น 'OPEN' (ฟันหนูเดี่ยว)
    const [existing] = await pool.query(
      "SELECT id FROM shifts WHERE cashier_id = ? AND status = 'OPEN'",
      [cashier_id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: "แคชเชียร์คนนี้มีกะที่เปิดอยู่แล้ว ต้องปิดกะเดิมก่อน" });
    }

    const [result] = await pool.query(
      'INSERT INTO shifts (cashier_id, opening_cash, opening_cash_breakdown, open_photo) VALUES (?, ?, ?, ?)',
      [cashier_id, opening_cash, cash_breakdown ? JSON.stringify(cash_breakdown) : null, open_photo]
    );
    res.status(201).json({ shift_id: result.insertId, message: "เปิดกะการขายสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/shifts/last-closed:
 *   get:
 *     summary: ดึงยอดเงินสดปิดกะล่าสุดของแคชเชียร์คนนี้ (สำหรับ pre-fill เงินทอนตั้งต้นกะใหม่)
 *     tags: [Shifts]
 */
app.get('/api/shifts/last-closed', async (req, res) => {
  const { cashier_id } = req.query;
  if (!cashier_id) return res.status(400).json({ error: "กรุณาระบุ cashier_id" });
  try {
    const [rows] = await pool.query(
      "SELECT actual_cash, closing_cash_breakdown FROM shifts WHERE cashier_id = ? AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1",
      [cashier_id]
    );
    res.json(rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/shifts/current:
 *   get:
 *     summary: ดูข้อมูลกะที่กำลังเปิดอยู่ (ค้นหาตาม cashier_id)
 *     tags: [Shifts]
 *     parameters:
 *       - in: query
 *         name: cashier_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/shifts/current', async (req, res) => {
  const { cashier_id } = req.query;
  try {
    // ⭐️ แก้เป็น 'OPEN' (ฟันหนูเดี่ยว)
    const [rows] = await pool.query(
      "SELECT * FROM shifts WHERE cashier_id = ? AND status = 'OPEN'",
      [cashier_id]
    );
    if (rows.length === 0) return res.json(null);

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
/**
 * @swagger
 * /api/shifts/close:
 *   post:
 *     summary: ปิดกะ (ระบบจะคำนวณเงินสดที่ควรมีให้อัตโนมัติและหาเงินขาด/เกิน)
 *     tags: [Shifts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cashier_id
 *               - actual_cash
 *             properties:
 *               cashier_id:
 *                 type: integer
 *               actual_cash:
 *                 type: number
 *                 description: ยอดเงินสดที่พนักงานนับได้จริงในลิ้นชัก
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: ปิดกะสำเร็จ
 */
app.post('/api/shifts/close', async (req, res) => {
  const { cashier_id, actual_cash, note, cash_breakdown, close_photo } = req.body;
  if (!close_photo) return res.status(400).json({ error: "กรุณาถ่ายรูปยืนยันสถานที่ก่อนปิดกะ" });

  try {
    // ⭐️ แก้เป็น 'OPEN' (ฟันหนูเดี่ยว)
    const [shifts] = await pool.query(
      "SELECT id, opening_cash, opened_at FROM shifts WHERE cashier_id = ? AND status = 'OPEN'",
      [cashier_id]
    );

    if (shifts.length === 0) {
      return res.status(404).json({ error: "ไม่พบกะที่กำลังเปิดอยู่สำหรับแคชเชียร์คนนี้" });
    }

    const currentShift = shifts[0];

    // ⭐️ สรุปยอดขายทุกช่องทางในกะนี้ (ไม่ใช่แค่เงินสด) — นับเฉพาะบิลที่ COMPLETED
    const [sales] = await pool.query(
      `SELECT
         COUNT(*) as bill_count,
         COALESCE(SUM(total_amount), 0) as total_sales,
         COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END), 0) as cash_sales,
         COALESCE(SUM(CASE WHEN payment_method = 'QR' THEN total_amount ELSE 0 END), 0) as qr_sales,
         COALESCE(SUM(CASE WHEN payment_method NOT IN ('CASH','QR') THEN total_amount ELSE 0 END), 0) as other_sales
       FROM sales
       WHERE cashier_id = ? AND status = 'COMPLETED' AND created_at >= ?`,
      [cashier_id, currentShift.opened_at]
    );

    const s = sales[0];
    const totalCashSales = Number(s.cash_sales);
    const expected_cash = Number(currentShift.opening_cash) + totalCashSales; // เงินในลิ้นชัก = เงินทอนตั้งต้น + ยอดเงินสดเท่านั้น
    const difference = Number(actual_cash) - expected_cash;

    // ⭐️ tolerance ส่วนต่างเงินสด ±20 บาทถือว่าปกติ เกินกว่านี้บังคับกรอก note อธิบาย
    const CASH_DIFF_TOLERANCE = 20;
    if (Math.abs(difference) > CASH_DIFF_TOLERANCE && !(note && note.trim())) {
      return res.status(400).json({ error: `ส่วนต่างเงินสด ${difference > 0 ? 'เกิน' : 'ขาด'} ฿${Math.abs(difference).toFixed(2)} เกินเกณฑ์ปกติ (±${CASH_DIFF_TOLERANCE}) กรุณาระบุหมายเหตุอธิบายก่อนปิดกะ` });
    }

    await pool.query(
      `UPDATE shifts 
       SET expected_cash = ?, actual_cash = ?, difference = ?, status = 'CLOSED', closed_at = CURRENT_TIMESTAMP, note = ?, closing_cash_breakdown = ?, close_photo = ?
       WHERE id = ?`,
      [expected_cash, actual_cash, difference, note || null, cash_breakdown ? JSON.stringify(cash_breakdown) : null, close_photo, currentShift.id]
    );

    res.json({
      message: "ปิดกะสำเร็จ",
      summary: {
        opening_cash: Number(currentShift.opening_cash),
        opened_at: currentShift.opened_at,
        bill_count: Number(s.bill_count),
        total_sales: Number(s.total_sales),
        cash_sales: totalCashSales,
        qr_sales: Number(s.qr_sales),
        other_sales: Number(s.other_sales),
        expected_cash: expected_cash,
        actual_cash: Number(actual_cash),
        difference: difference,
        note: note
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// 2.1 SCHEDULES / ATTENDANCE (หมวด 7 — ตารางเวลา + เช็คมาสาย)
// =========================================

/**
 * @swagger
 * /api/schedules:
 *   post:
 *     summary: ตั้งตารางเวลาทำงานล่วงหน้าให้พนักงาน (upsert ต่อ cashier_id + work_date)
 *     tags: [Schedules]
 */
app.post('/api/schedules', requireRole('ADMIN'), async (req, res) => {
  const { cashier_id, work_date, expected_start, expected_end } = req.body;
  if (!cashier_id || !work_date || !expected_start || !expected_end) {
    return res.status(400).json({ error: "กรุณาระบุ cashier_id, work_date, expected_start, expected_end ให้ครบ" });
  }
  try {
    // ⭐️ upsert แบบ manual (ไม่มี unique key): มีอยู่แล้ว = update, ยังไม่มี = insert
    const [existing] = await pool.query('SELECT id FROM schedules WHERE cashier_id = ? AND work_date = ?', [cashier_id, work_date]);
    if (existing.length > 0) {
      await pool.query('UPDATE schedules SET expected_start = ?, expected_end = ? WHERE id = ?', [expected_start, expected_end, existing[0].id]);
      return res.json({ message: "แก้ไขตารางเวลาสำเร็จ", id: existing[0].id });
    }
    const [result] = await pool.query(
      'INSERT INTO schedules (cashier_id, work_date, expected_start, expected_end) VALUES (?, ?, ?, ?)',
      [cashier_id, work_date, expected_start, expected_end]
    );
    res.status(201).json({ message: "ตั้งตารางเวลาสำเร็จ", id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/schedules:
 *   get:
 *     summary: ดูตารางเวลาของพนักงาน (กรองด้วย cashier_id และ/หรือ date ได้)
 *     tags: [Schedules]
 */
app.get('/api/schedules', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
  try {
    const { cashier_id, date } = req.query;
    let query = `SELECT s.id, s.cashier_id, DATE_FORMAT(s.work_date, '%Y-%m-%d') as work_date, s.expected_start, s.expected_end, u.full_name FROM schedules s JOIN users u ON s.cashier_id = u.id WHERE 1=1`;
    const params = [];
    if (cashier_id) { query += ' AND s.cashier_id = ?'; params.push(cashier_id); }
    if (date) { query += ' AND s.work_date = ?'; params.push(date); }
    query += ' ORDER BY s.work_date DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/attendance/check-in:
 *   post:
 *     summary: ลงชื่อเข้างาน (ปัจจุบันใช้กับ ADMIN เท่านั้น — CASHIER ใช้ระบบเปิดกะแทน)
 *     tags: [Attendance]
 */
/**
 * @swagger
 * /api/attendance/upload-photo:
 *   post:
 *     summary: อัปโหลดรูปถ่ายยืนยันสถานที่ตอนเข้า/ออกงาน
 *     tags: [Attendance]
 */
app.post('/api/attendance/upload-photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ไม่พบไฟล์รูปภาพ" });
  res.json({ photo_url: `/uploads/${req.file.filename}` });
});

app.post('/api/attendance/check-in', requireRole('ADMIN'), async (req, res) => {
  const { check_in_photo } = req.body;
  if (!check_in_photo) return res.status(400).json({ error: "กรุณาถ่ายรูปยืนยันสถานที่ก่อนลงชื่อเข้างาน" });
  try {
    const [openRows] = await pool.query(
      `SELECT id FROM attendance
       WHERE user_id = ?
         AND (DATE(check_in) = CURDATE() OR DATE(CONVERT_TZ(check_in, '+00:00', '+07:00')) = CURDATE())
         AND check_out IS NULL`,
      [req.user.id]
    );
    // ⭐️ ถ้าลงชื่อเข้างานวันนี้แล้วและยังไม่ได้ออกงาน ห้ามลงชื่อซ้ำ
    if (openRows.length > 0) return res.status(400).json({ error: "ลงชื่อเข้างานวันนี้ไปแล้ว ยังไม่ได้ลงชื่อออกงาน" });

    const [result] = await pool.query('INSERT INTO attendance (user_id, check_in_photo) VALUES (?, ?)', [req.user.id, check_in_photo]);
    res.status(201).json({ message: "ลงชื่อเข้างานสำเร็จ", id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/attendance/check-out:
 *   put:
 *     summary: ลงชื่อออกงาน
 *     tags: [Attendance]
 */
app.put('/api/attendance/check-out', requireRole('ADMIN'), async (req, res) => {
  const { check_out_photo } = req.body;
  if (!check_out_photo) return res.status(400).json({ error: "กรุณาถ่ายรูปยืนยันสถานที่ก่อนลงชื่อออกงาน" });
  try {
    // ⭐️ เช็คทั้ง CURDATE() (Bangkok หลัง fix tz) และ CONVERT_TZ (กัน row เก่าที่เก็บเป็น UTC)
    const [rows] = await pool.query(
      `SELECT id FROM attendance
       WHERE user_id = ?
         AND (DATE(check_in) = CURDATE() OR DATE(CONVERT_TZ(check_in, '+00:00', '+07:00')) = CURDATE())
         AND check_out IS NULL
       ORDER BY check_in DESC LIMIT 1`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(400).json({ error: "ยังไม่ได้ลงชื่อเข้างานวันนี้" });

    await pool.query('UPDATE attendance SET check_out = NOW(), check_out_photo = ? WHERE id = ?', [check_out_photo, rows[0].id]);
    res.json({ message: "ลงชื่อออกงานสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/attendance/today:
 *   get:
 *     summary: เช็คว่าวันนี้ลงชื่อเข้างานหรือยัง (ใช้ตอนล็อกอิน ADMIN)
 *     tags: [Attendance]
 */
app.get('/api/attendance/today', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM attendance
       WHERE user_id = ?
         AND (DATE(check_in) = CURDATE() OR DATE(CONVERT_TZ(check_in, '+00:00', '+07:00')) = CURDATE())
         AND check_out IS NULL
       ORDER BY check_in DESC LIMIT 1`,
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/attendance:
 *   get:
 *     summary: ดูประวัติ attendance ทั้งหมด (ADMIN-only) กรองด้วย user_id/month ได้ — ใช้แก้ไขกรณีลืมออกงาน
 *     tags: [Attendance]
 */
app.get('/api/attendance', requireRole('ADMIN'), async (req, res) => {
  try {
    const { user_id, month } = req.query;

    // ⭐️ รวม attendance (ADMIN ลงชื่อเข้า-ออกงาน) + shifts (CASHIER เปิด-ปิดกะ) เป็นรายการเดียว
    // ทั้งคู่มีรูปเข้า/ออก + เวลาเข้า/ออก แค่คนละตาราง — tag source แยกประเภท
    let attFilter = '';
    let shiftFilter = '';
    const attParams = [];
    const shiftParams = [];
    if (user_id) { attFilter += ' AND a.user_id = ?'; attParams.push(user_id); shiftFilter += ' AND sh.cashier_id = ?'; shiftParams.push(user_id); }
    if (month) { attFilter += ` AND DATE_FORMAT(a.check_in, '%Y-%m') = ?`; attParams.push(month); shiftFilter += ` AND DATE_FORMAT(sh.opened_at, '%Y-%m') = ?`; shiftParams.push(month); }

    const query = `
      SELECT * FROM (
        SELECT a.id, 'ATTENDANCE' as source, a.user_id, u.full_name, u.role,
               a.check_in, a.check_out, a.check_in_photo, a.check_out_photo, a.note
        FROM attendance a JOIN users u ON a.user_id = u.id
        WHERE 1=1 ${attFilter}
        UNION ALL
        SELECT sh.id, 'SHIFT' as source, sh.cashier_id as user_id, u.full_name, u.role,
               sh.opened_at as check_in, sh.closed_at as check_out, sh.open_photo as check_in_photo, sh.close_photo as check_out_photo, sh.note
        FROM shifts sh JOIN users u ON sh.cashier_id = u.id
        WHERE 1=1 ${shiftFilter}
      ) combined
      ORDER BY check_in DESC LIMIT 200
    `;
    const [rows] = await pool.query(query, [...attParams, ...shiftParams]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/attendance/{id}:
 *   put:
 *     summary: ADMIN แก้ไข check_in/check_out ย้อนหลัง (กรณีลืม/ผิดพลาด) พร้อมบันทึก note
 *     tags: [Attendance]
 */
app.put('/api/attendance/:id', requireRole('ADMIN'), async (req, res) => {
  const { check_in, check_out, note, source } = req.body;
  try {
    if (source === 'SHIFT') {
      // แก้กะ (CASHIER): map check_in->opened_at, check_out->closed_at
      await pool.query(
        'UPDATE shifts SET opened_at = COALESCE(?, opened_at), closed_at = COALESCE(?, closed_at), note = COALESCE(?, note) WHERE id = ?',
        [check_in || null, check_out || null, note || null, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE attendance SET check_in = COALESCE(?, check_in), check_out = COALESCE(?, check_out), note = COALESCE(?, note) WHERE id = ?',
        [check_in || null, check_out || null, note || null, req.params.id]
      );
    }
    res.json({ message: "แก้ไขข้อมูลลงเวลาสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/attendance/:id', requireRole('ADMIN'), async (req, res) => {
  const { source } = req.query;
  try {
    if (source === 'SHIFT') {
      // ไม่ลบ shift จริง แค่ reset เวลาออกงานออก (กัน FK issues)
      await pool.query('UPDATE shifts SET closed_at = NULL, status = \'OPEN\' WHERE id = ?', [req.params.id]);
    } else {
      await pool.query('DELETE FROM attendance WHERE id = ?', [req.params.id]);
    }
    res.json({ message: "ลบรายการสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/attendance/auto-checkout-stale:
 *   post:
 *     summary: ตัดออกงาน/ปิดกะอัตโนมัติทุกคนที่ลืมออกข้ามวัน (ระบบมี cron รันเที่ยงคืนให้อยู่แล้ว endpoint นี้ไว้สั่งด้วยมือกรณีต้องการรันทันที)
 *     tags: [Attendance]
 */
// ⭐️ ตรรกะตัดออกงาน/ปิดกะอัตโนมัติ (แยกเป็นฟังก์ชันเพื่อให้ทั้ง endpoint และ cron เรียกใช้ร่วมกันได้)
async function runAutoCheckoutStale(io) {
  // ⭐️ attendance ที่ค้าง (ADMIN ลืมลงชื่อออกงานข้ามวัน)
  const [staleAttendance] = await pool.query(
    `SELECT a.id, a.user_id, u.full_name FROM attendance a JOIN users u ON a.user_id = u.id WHERE a.check_out IS NULL AND DATE(a.check_in) < CURDATE()`
  );
  for (const a of staleAttendance) {
    await pool.query(`UPDATE attendance SET check_out = check_in, note = 'ระบบตัดออกงานอัตโนมัติ (ลืมลงชื่อออก) กรุณาตรวจสอบ' WHERE id = ?`, [a.id]);
    const msg = `${a.full_name} ลืมลงชื่อออกงาน ระบบตัดให้อัตโนมัติแล้ว กรุณาตรวจสอบ/แก้ไขเวลาที่ถูกต้อง`;
    await pool.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [msg]);
  }

  // ⭐️ กะที่ค้าง (CASHIER ลืมปิดกะข้ามวัน) — ปิดให้โดยสมมติว่าเงินตรง (ไม่รู้ยอดจริง) ต้องให้ ADMIN ตรวจสอบทีหลัง
  const [staleShifts] = await pool.query(
    `SELECT sh.id, sh.opening_cash, sh.opened_at, u.full_name FROM shifts sh JOIN users u ON sh.cashier_id = u.id WHERE sh.status = 'OPEN' AND DATE(sh.opened_at) < CURDATE()`
  );
  for (const sh of staleShifts) {
    const [salesRows] = await pool.query(
      `SELECT COALESCE(SUM(total_amount),0) as total FROM sales WHERE cashier_id = (SELECT cashier_id FROM shifts WHERE id = ?) AND payment_method = 'CASH' AND created_at >= ?`,
      [sh.id, sh.opened_at]
    );
    const expectedCash = Number(sh.opening_cash) + Number(salesRows[0].total);
    await pool.query(
      `UPDATE shifts SET status = 'CLOSED', closed_at = NOW(), expected_cash = ?, actual_cash = ?, difference = 0, auto_closed = TRUE, note = 'ระบบปิดกะอัตโนมัติ (ลืมปิดกะ) สมมติเงินตรงตามยอดคาดการณ์ กรุณาตรวจนับจริงย้อนหลัง' WHERE id = ?`,
      [expectedCash, expectedCash, sh.id]
    );
    const msg = `กะของ ${sh.full_name} ลืมปิดข้ามวัน ระบบปิดให้อัตโนมัติแล้ว (สมมติเงินตรง) กรุณาตรวจนับเงินจริงย้อนหลัง`;
    await pool.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [msg]);
  }

  if (io && staleAttendance.length + staleShifts.length > 0) io.emit('notifications_updated', { message: 'มีการตัดออกงาน/ปิดกะอัตโนมัติ กรุณาตรวจสอบ' });

  return { attendance_closed: staleAttendance.length, shifts_closed: staleShifts.length };
}

app.post('/api/attendance/auto-checkout-stale', requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await runAutoCheckoutStale(req.io);
    res.json({ message: "ตรวจสอบและตัดออกอัตโนมัติเรียบร้อย", ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/holidays:
 *   post:
 *     summary: ตั้งวันหยุดพิเศษ (วันในนี้จะไม่ถูกนับว่ามาสาย/ขาดงาน)
 *     tags: [Holidays]
 */
app.post('/api/holidays', requireRole('ADMIN'), async (req, res) => {
  const { holiday_date, note } = req.body;
  if (!holiday_date) return res.status(400).json({ error: "กรุณาระบุวันที่" });
  try {
    await pool.query('INSERT INTO holidays (holiday_date, note) VALUES (?, ?)', [holiday_date, note || null]);
    res.status(201).json({ message: "เพิ่มวันหยุดสำเร็จ" });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: "วันที่นี้ถูกตั้งเป็นวันหยุดไปแล้ว" });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/holidays:
 *   get:
 *     summary: ดูรายการวันหยุดพิเศษทั้งหมด
 *     tags: [Holidays]
 */
app.get('/api/holidays', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') as holiday_date, note FROM holidays ORDER BY holiday_date DESC");
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/attendance:
 *   get:
 *     summary: เทียบเวลาเข้างานจริงกับตารางเวลา (CASHIER เทียบ shifts.opened_at, ADMIN เทียบ attendance.check_in) ข้ามวันหยุด กรองตามเดือนได้ (?month=YYYY-MM)
 *     tags: [Reports]
 */
app.get('/api/reports/attendance', requireRole('ADMIN'), async (req, res) => {
  try {
    const { month } = req.query; // 'YYYY-MM'
    const monthClause = month ? `AND DATE_FORMAT(work_date, '%Y-%m') = ?` : '';
    const params = month ? [month] : [];

    const [rows] = await pool.query(`
      SELECT user_id, full_name, work_date, expected_start, actual_time,
        CASE WHEN actual_time IS NULL THEN NULL
             ELSE TIMESTAMPDIFF(MINUTE, CONCAT(work_date, ' ', expected_start), actual_time)
        END as late_minutes
      FROM (
        SELECT s.cashier_id as user_id, u.full_name, s.work_date, s.expected_start, sh.opened_at as actual_time
        FROM schedules s
        JOIN users u ON s.cashier_id = u.id AND u.role = 'CASHIER'
        LEFT JOIN shifts sh ON sh.cashier_id = s.cashier_id AND DATE(sh.opened_at) = s.work_date
        UNION ALL
        SELECT s.cashier_id as user_id, u.full_name, s.work_date, s.expected_start, att.check_in as actual_time
        FROM schedules s
        JOIN users u ON s.cashier_id = u.id AND u.role = 'ADMIN'
        LEFT JOIN attendance att ON att.user_id = s.cashier_id AND DATE(att.check_in) = s.work_date
      ) combined
      WHERE work_date NOT IN (SELECT holiday_date FROM holidays)
      ${monthClause}
      ORDER BY work_date DESC, user_id
    `, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/orders/{id}/assign:
 *   post:
 *     summary: พนักงานรับงาน order (first-come-first-served) — ล็อคสิทธิ์เฉพาะคนนั้นจนปิดบิล
 *     tags: [Orders]
 */
app.post('/api/orders/:id/assign', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, assigned_to, status FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) { await conn.rollback(); return res.status(404).json({ error: "ไม่พบออเดอร์" }); }

    const order = rows[0];
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) { await conn.rollback(); return res.status(400).json({ error: "ออเดอร์นี้ปิดแล้ว" }); }
    if (order.assigned_to && order.assigned_to !== req.user.id) {
      // ดึงชื่อคนที่ล็อคไปแล้ว
      const [assignee] = await conn.query('SELECT full_name FROM users WHERE id = ?', [order.assigned_to]);
      await conn.rollback();
      return res.status(409).json({ error: `ออเดอร์นี้ถูกรับงานโดย ${assignee[0]?.full_name || 'พนักงานท่านอื่น'} แล้ว` });
    }

    await conn.query('UPDATE orders SET assigned_to = ? WHERE id = ?', [req.user.id, order.id]);
    await conn.commit();
    res.json({ message: "รับงานสำเร็จ", assigned_to: req.user.id });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally { conn.release(); }
});

// ⭐️ ลูกค้าส่งสลิปใหม่ (หลังโดน SLIP_REJECTED)
app.put('/api/orders/:id/resubmit-slip', authenticateToken, async (req, res) => {
  const { slip_image } = req.body;
  if (!slip_image) return res.status(400).json({ error: "กรุณาแนบสลิปใหม่" });
  try {
    const [orders] = await pool.query('SELECT user_id FROM orders WHERE id = ? AND status = ?', [req.params.id, 'SLIP_REJECTED']);
    if (orders.length === 0) return res.status(404).json({ error: "ไม่พบออเดอร์หรือสถานะไม่ถูกต้อง" });
    if (orders[0].user_id !== req.user.id) return res.status(403).json({ error: "ไม่มีสิทธิ์แก้ไขออเดอร์นี้" });
    await pool.query("UPDATE orders SET slip_image = ?, status = 'PENDING_VERIFY', reject_reason = NULL WHERE id = ?", [slip_image, req.params.id]);
    req.io.emit('new_order_received', { message: `ลูกค้าส่งสลิปใหม่ ออเดอร์ #${req.params.id}`, order_id: req.params.id });
    req.io.emit('order_status_changed', { order_id: req.params.id, status: 'PENDING_VERIFY' });
    res.json({ message: "ส่งสลิปใหม่สำเร็จ รอพนักงานตรวจสอบ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/sales/checkout:
 *   post:
 *     summary: ชำระเงินและสร้างใบเสร็จ (Checkout)
 *     tags: [Sales]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cashier_id
 *               - payment_method
 *               - amount_received
 *               - items
 *             properties:
 *               cashier_id:
 *                 type: integer
 *               payment_method:
 *                 type: string
 *               amount_received:
 *                 type: number
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     product_id:
 *                       type: integer
 *                     quantity:
 *                       type: integer
 *     responses:
 *       200:
 *         description: ทำรายการสำเร็จ
 */
app.post('/api/sales/checkout', async (req, res) => {
  // ⭐️ เพิ่มการรับค่า member_id, promotion_id, redeem_points เข้ามาด้วย
  const { cashier_id, member_id, promotion_id, redeem_points, payment_method, amount_received, items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: "ตะกร้าสินค้าว่างเปล่า" });

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    let totalAmount = 0;
    const processedItems = [];

    // 1. เช็คราคาสินค้าและสต๊อก
    for (let item of items) {
      const [productRows] = await conn.query('SELECT price, stock FROM products WHERE id = ?', [item.product_id]);
      if (productRows.length === 0) throw new Error(`ไม่พบสินค้า ID: ${item.product_id}`);

      const product = productRows[0];
      if (product.stock < item.quantity) throw new Error(`สต๊อกไม่เพียงพอสำหรับสินค้า ID: ${item.product_id}`);

      const subtotal = product.price * item.quantity;
      totalAmount += subtotal;

      processedItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price: product.price, subtotal: subtotal, stock_before: product.stock });
    }

    // ⭐️ 1.5 คำนวณส่วนลดจากโปรโมชั่นใหม่ฝั่ง Backend เอง (ห้ามเชื่อ discount ที่ client ส่งมา)
    let discountAmount = 0;
    let appliedPromo = null;
    if (promotion_id) {
      const [promoRows] = await conn.query('SELECT * FROM promotions WHERE id = ? AND is_active = TRUE FOR UPDATE', [promotion_id]);
      if (promoRows.length === 0) throw new Error('โปรโมชั่นไม่ถูกต้อง หรือหมดอายุแล้ว');
      const promo = promoRows[0];

      const limitError = await checkPromotionUsageLimit(conn.query.bind(conn), promo, member_id || null);
      if (limitError) throw new Error(limitError);

      discountAmount = await calculatePromotionDiscount(conn.query.bind(conn), promo, totalAmount, items);
      appliedPromo = promo;
    }
    let netTotal = totalAmount - discountAmount;

    // ⭐️ 1.6 แลกแต้มเป็นส่วนลด (1 แต้ม = ฿1) — คำนวณ/ตรวจสอบใหม่ฝั่ง backend ทั้งหมด ห้ามเชื่อ client
    let pointsRedeemed = 0;
    let pointsDiscount = 0;
    if (member_id && redeem_points > 0) {
      const [memberRows] = await conn.query('SELECT points FROM users WHERE id = ? FOR UPDATE', [member_id]);
      if (memberRows.length === 0) throw new Error('ไม่พบข้อมูลสมาชิก');
      const availablePoints = memberRows[0].points;

      pointsRedeemed = Math.min(Number(redeem_points), availablePoints, Math.floor(netTotal));
      if (pointsRedeemed < 0) pointsRedeemed = 0;
      pointsDiscount = pointsRedeemed; // อัตรา 1 แต้ม = ฿1
      netTotal -= pointsDiscount;
    }

    // 2. ตรวจสอบเงินทอน (เทียบกับยอดสุทธิหลังหักส่วนลด+แต้ม)
    if (amount_received < netTotal) throw new Error("รับเงินลูกค้ามาไม่พอ!");
    const changeAmount = amount_received - netTotal;

    // ⭐️ หากะที่เปิดอยู่ของแคชเชียร์คนนี้ ผูกเข้าบิล (แม่นกว่าเทียบช่วงเวลา ถ้าเปิดกะซ้อนเวลากันหลายคน)
    const [openShiftRows] = await conn.query(`SELECT id FROM shifts WHERE cashier_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`, [cashier_id]);
    const shiftId = openShiftRows[0]?.id || null;

    // 3. สร้างหัวบิลใบเสร็จ (ผูก member_id, promotion_id, discount_amount, points_redeemed, shift_id ลงไป)
    const [saleResult] = await conn.query(
      'INSERT INTO sales (cashier_id, member_id, promotion_id, total_amount, discount_amount, points_redeemed, points_discount, payment_method, amount_received, change_amount, shift_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [cashier_id, member_id || null, promotion_id || null, netTotal, discountAmount, pointsRedeemed, pointsDiscount, payment_method, amount_received, changeAmount, shiftId]
    );
    const saleId = saleResult.insertId;

    // 4. บันทึกรายละเอียดสินค้าและตัดสต๊อก
    const lowStockMsgs = [];
    for (let item of processedItems) {
      await conn.query('INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)', [saleId, item.product_id, item.quantity, item.unit_price, item.subtotal]);
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id]);
      const msg = await notifyIfLowStock(conn, req.io, item.product_id, item.stock_before, item.stock_before - item.quantity);
      if (msg) lowStockMsgs.push(msg);
    }

    // ⭐️ 5. หักแต้มที่แลกใช้ไป + คำนวณแต้มสะสมใหม่ (ทุก 20 บาท = 1 แต้ม, คิดจากยอดสุทธิหลังหักทุกส่วนลด)
    let earnedPoints = 0;
    if (member_id) {
      if (pointsRedeemed > 0) {
        await conn.query('UPDATE users SET points = points - ? WHERE id = ?', [pointsRedeemed, member_id]);
      }
      earnedPoints = Math.floor(netTotal / 20);
      if (earnedPoints > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [earnedPoints, member_id]);
      }
    }

    // ⭐️ 5.5 นับสิทธิ์การใช้โปรโมชั่น (usage_count รวม + per-user ถ้ามีจำกัด)
    if (appliedPromo && discountAmount > 0) {
      await conn.query('UPDATE promotions SET usage_count = usage_count + 1 WHERE id = ?', [appliedPromo.id]);
      if (member_id) {
        await conn.query('INSERT INTO promotion_usages (promotion_id, member_id) VALUES (?, ?)', [appliedPromo.id, member_id]);
      }
    }

    await conn.commit();
    req.io.emit('stock_updated', { message: 'มีการตัดสต๊อกสินค้า ให้โหลดข้อมูลใหม่' });
    req.io.emit('dashboard_updated', { message: 'มีบิลขายใหม่' });
    lowStockMsgs.forEach(msg => req.io.emit('notifications_updated', { message: msg }));

    res.json({
      message: "ทำรายการสำเร็จ",
      receipt: {
        sale_id: saleId,
        subtotal: totalAmount,
        discount_amount: discountAmount,
        points_redeemed: pointsRedeemed,
        points_discount: pointsDiscount,
        total_amount: netTotal,
        amount_received: amount_received,
        change_amount: changeAmount,
        earned_points: earnedPoints,
        payment_method
      }
    });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// =========================================
// 5.1 SALES HISTORY, HOLD & VOID (ประวัติ, พักบิล และ ยกเลิกบิล)
// =========================================

/**
 * @swagger
 * /api/sales/history:
 *   get:
 *     summary: ดึงประวัติการขาย (เลือกช่วงเวลาได้)
 *     tags: [Sales]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/sales/history', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // ⭐️ รวมบิลหน้าร้าน (sales) + บิลจองที่ปิดแล้ว (orders COMPLETED) เข้าด้วยกัน
    // ใช้ source แยกประเภท ('POS'/'PREORDER') เพราะ id ชนกันได้ระหว่าง 2 ตาราง
    // orders นับวันที่ตาม completed_at (วันที่มารับจริง) ไม่ใช่วันจอง
    let dateClauseSales = 'DATE(s.created_at) = CURDATE()';
    let dateClauseOrders = 'DATE(o.completed_at) = CURDATE()';
    const params = [];
    if (start_date && end_date) {
      dateClauseSales = 'DATE(s.created_at) BETWEEN ? AND ?';
      dateClauseOrders = 'DATE(o.completed_at) BETWEEN ? AND ?';
      params.push(start_date, end_date, start_date, end_date);
    }

    const query = `
      SELECT * FROM (
        SELECT s.id, 'POS' as source, s.created_at, s.total_amount, s.payment_method, s.status, u.full_name as cashier_name
        FROM sales s
        JOIN users u ON s.cashier_id = u.id
        WHERE ${dateClauseSales}
        UNION ALL
        SELECT o.id, 'PREORDER' as source, o.completed_at as created_at, o.total_amount, o.payment_method, o.status, cust.full_name as cashier_name
        FROM orders o
        JOIN users cust ON o.user_id = cust.id
        WHERE o.status = 'COMPLETED' AND ${dateClauseOrders}
      ) combined
      ORDER BY created_at DESC
    `;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/sales/history/{id}:
 *   get:
 *     summary: ดูรายละเอียดสินค้าภายในบิล
 *     tags: [Sales]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/sales/history/:id', async (req, res) => {
  try {
    const { source } = req.query; // 'PREORDER' = ดูจาก order_items, อื่นๆ = sale_items (บิลหน้าร้าน)
    let rows;
    if (source === 'PREORDER') {
      [rows] = await pool.query(`
        SELECT oi.quantity, oi.price, oi.subtotal, p.name as product_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [req.params.id]);
    } else {
      [rows] = await pool.query(`
        SELECT si.quantity, si.price, si.subtotal, p.name as product_name
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        WHERE si.sale_id = ?
      `, [req.params.id]);
    }
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/sales/{id}/void:
 *   post:
 *     summary: ยกเลิกบิล (Void) คืนสต๊อกและแต้ม (เฉพาะ ADMIN)
 *     tags: [Sales]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: ยกเลิกสำเร็จ
 */
app.post('/api/sales/:id/void', async (req, res) => {
  const saleId = req.params.id;
  const { user_role } = req.body;

  if (user_role !== 'ADMIN') return res.status(403).json({ error: "เฉพาะ ADMIN เท่านั้น" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ⭐️ ใช้ status ตรวจสอบอย่างเดียว
    const [sales] = await conn.query('SELECT member_id, total_amount, status FROM sales WHERE id = ? FOR UPDATE', [saleId]);
    if (sales.length === 0) throw new Error("ไม่พบข้อมูลบิลนี้");

    const sale = sales[0];
    if (sale.status === 'VOIDED') throw new Error("บิลนี้ถูกยกเลิกไปแล้ว");
    if (sale.status === 'HOLD') throw new Error("บิลนี้เป็นบิลพัก ต้องใช้ API ลบบิลพักแทน");

    // ⭐️ เปลี่ยนสถานะบิลเป็น VOIDED
    await conn.query('UPDATE sales SET status = "VOIDED" WHERE id = ?', [saleId]);

    // คืนสต๊อก
    const [items] = await conn.query('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?', [saleId]);
    for (const item of items) {
      await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
    }

    // คืนแต้ม (หารด้วย 20 ให้ตรงกับตอนได้แต้มใน checkout)
    if (sale.member_id) {
      const points = Math.floor(sale.total_amount / 20);
      await conn.query('UPDATE users SET points = GREATEST(0, points - ?) WHERE id = ?', [points, sale.member_id]);
    }

    // ⭐️ บันทึกแจ้งเตือนระบบ: บิลถูกยกเลิก (VOID)
    const voidMsg = `บิล #${saleId} ถูกยกเลิก (VOID) มูลค่า ฿${Number(sale.total_amount).toFixed(2)}`;
    await conn.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [voidMsg]);

    await conn.commit();
    req.io.emit('stock_updated', { message: `บิล #${saleId} ถูกยกเลิก สต๊อกคืนแล้ว` });
    req.io.emit('dashboard_updated', { message: `บิล #${saleId} ถูกยกเลิก` });
    req.io.emit('notifications_updated', { message: voidMsg });
    res.json({ message: `ยกเลิกบิล #${saleId} สำเร็จ` });
  } catch (error) {
    await conn.rollback();
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

/**
 * @swagger
 * /api/sales/hold:
 *   post:
 *     summary: บันทึกตะกร้าสินค้าไว้ชั่วคราว (พักบิล) - ยังไม่ตัดสต๊อก
 *     tags: [Sales]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cashier_id
 *               - items
 *             properties:
 *               cashier_id:
 *                 type: integer
 *               member_id:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     product_id:
 *                       type: integer
 *                     quantity:
 *                       type: integer
 *     responses:
 *       201:
 *         description: พักบิลสำเร็จ
 */
app.post('/api/sales/hold', async (req, res) => {
  const { cashier_id, member_id, items } = req.body;

  if (!items || items.length === 0) return res.status(400).json({ error: "ตะกร้าว่างเปล่า" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let grandTotal = 0;
    const processedItems = [];

    // คำนวณยอดรวม แต่ยัง "ไม่เช็คและไม่ตัด" สต๊อก
    for (const item of items) {
      const [rows] = await conn.query('SELECT price FROM products WHERE id = ?', [item.product_id]);
      if (rows.length === 0) throw new Error(`ไม่พบสินค้า ID ${item.product_id}`);

      const subtotal = Number(rows[0].price) * item.quantity;
      grandTotal += subtotal;
      processedItems.push({ ...item, price: rows[0].price, subtotal });
    }

    // สร้างบิลด้วยสถานะ 'HOLD' (เงินรับและเงินทอนให้เป็น 0 ไว้ก่อน)
    const [saleResult] = await conn.query(
      `INSERT INTO sales (cashier_id, member_id, total_amount, amount_received, change_amount, status) 
       VALUES (?, ?, ?, 0, 0, 'HOLD')`,
      [cashier_id, member_id || null, grandTotal]
    );
    const saleId = saleResult.insertId;

    // บันทึกรายการสินค้าในตะกร้า
    for (const item of processedItems) {
      await conn.query(
        'INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)',
        [saleId, item.product_id, item.quantity, item.price, item.subtotal]
      );
    }

    await conn.commit();
    res.status(201).json({ message: "พักบิลสำเร็จ", sale_id: saleId });
  } catch (error) {
    await conn.rollback();
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

/**
 * @swagger
 * /api/sales/hold:
 *   get:
 *     summary: ดึงรายการบิลที่ถูกพักไว้ทั้งหมด
 *     tags: [Sales]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/sales/hold', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sales WHERE status = "HOLD"');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/sales/hold/{id}:
 *   delete:
 *     summary: ลบบิลที่พักไว้ (ลูกค้ายกเลิกไม่เอาแล้ว)
 *     tags: [Sales]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: ลบสำเร็จ
 */
app.delete('/api/sales/hold/:id', async (req, res) => {
  const saleId = req.params.id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // ต้องลบรายการสินค้าในบิลออกก่อน (ตารางลูก) แล้วค่อยลบตัวบิลหลัก (ตารางแม่)
    await conn.query('DELETE FROM sale_items WHERE sale_id = ?', [saleId]);
    await conn.query('DELETE FROM sales WHERE id = ? AND status = "HOLD"', [saleId]);
    await conn.commit();
    res.json({ message: "ลบบิลที่พักไว้สำเร็จ" });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// =========================================
// 6. MEMBERS (ระบบสมาชิกสหกรณ์)
// =========================================

/**
 * @swagger
 * /api/members:
 *   get:
 *     summary: ค้นหาสมาชิก (รองรับการค้นหาด้วย student_id หรือชื่อ)
 *     tags: [Members]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: รหัสนักศึกษา หรือ ชื่อ-นามสกุล
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/members', async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM members';
    let params = [];

    if (search) {
      query += ' WHERE student_id LIKE ? OR full_name LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/members:
 *   post:
 *     summary: สมัครสมาชิกใหม่
 *     tags: [Members]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - student_id
 *               - full_name
 *             properties:
 *               student_id:
 *                 type: string
 *               full_name:
 *                 type: string
 *     responses:
 *       201:
 *         description: สมัครสมาชิกสำเร็จ
 */
app.post('/api/members', async (req, res) => {
  const { student_id, full_name } = req.body;
  if (!student_id || !full_name) {
    return res.status(400).json({ error: "กรุณาระบุรหัสนักศึกษาและชื่อ-นามสกุล" });
  }

  try {
    await pool.query(
      'INSERT INTO members (student_id, full_name, points) VALUES (?, ?, 0)',
      [student_id, full_name]
    );
    res.status(201).json({ message: "สมัครสมาชิกสำเร็จ", student_id, full_name, points: 0 });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: "รหัสนักศึกษานี้เป็นสมาชิกอยู่แล้ว" });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/members/{id}/points:
 *   get:
 *     summary: เช็คแต้มสะสมของสมาชิก
 *     tags: [Members]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: รหัสนักศึกษา (student_id)
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/members/:id/points', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT student_id, full_name, points FROM members WHERE student_id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "ไม่พบข้อมูลสมาชิก" });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/members/{id}/points:
 *   patch:
 *     summary: เพิ่ม/ลด แต้มสะสมแมนนวล (เช่น แลกของรางวัล)
 *     tags: [Members]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: รหัสนักศึกษา
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - points_to_add
 *             properties:
 *               points_to_add:
 *                 type: integer
 *                 description: ใส่ค่าบวกเพื่อเพิ่มแต้ม ใส่ค่าลบเพื่อตัดแต้ม
 *     responses:
 *       200:
 *         description: อัปเดตสำเร็จ
 */
app.patch('/api/members/:id/points', async (req, res) => {
  const { points_to_add } = req.body;
  if (points_to_add === undefined) {
    return res.status(400).json({ error: "กรุณาระบุจำนวนแต้มที่ต้องการอัปเดต" });
  }

  try {
    // ใช้ตัวแปรเพื่อป้องกันแต้มติดลบ
    const [result] = await pool.query(
      'UPDATE members SET points = GREATEST(0, points + ?) WHERE student_id = ?',
      [points_to_add, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "ไม่พบข้อมูลสมาชิก" });
    }

    res.json({ message: "อัปเดตแต้มสะสมสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/members/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "กรุณาเลือกไฟล์ CSV" });

  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        for (const row of results) {
          // สมมติใน CSV มีหัวตาราง: student_id, full_name, phone_number
          const { student_id, full_name, phone_number } = row;
          if (!student_id || !full_name) continue; // ข้ามแถวที่ข้อมูลไม่ครบ

          const password = await bcrypt.hash(phone_number || '123456', 10);

          await pool.query(
            `INSERT INTO users (student_id, password, full_name, phone_number, role) 
             VALUES (?, ?, ?, ?, 'MEMBER') 
             ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), phone_number = VALUES(phone_number)`,
            [student_id, password, full_name, phone_number || null]
          );
        }
        fs.unlinkSync(req.file.path); // ลบไฟล์ทิ้งหลัง Import เสร็จ
        res.json({ message: `นำเข้าสมาชิกสำเร็จ ${results.length} รายการ` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
});

// =========================================
// 7. REPORTS & DASHBOARD (ระบบรายงานสรุป)
// =========================================

/**
 * @swagger
 * /api/reports/dashboard:
 *   get:
 *     summary: สรุปยอดขายรวมประจำวัน (Today's Dashboard)
 *     tags: [Reports]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/reports/dashboard', async (req, res) => {
  try {
    // ⭐️ รวมยอดขายหน้าร้าน (sales) กับบิลจากการจองที่ลูกค้ามารับแล้ว (orders สถานะ COMPLETED)
    // นับ orders เข้าวันที่ "มารับจริง" (completed_at) ไม่ใช่วันที่จอง (created_at)
    const [rows] = await pool.query(`
      SELECT
        COALESCE(SUM(cnt), 0) as total_bills,
        COALESCE(SUM(total), 0) as total_sales,
        COALESCE(SUM(cash), 0) as cash_sales,
        COALESCE(SUM(qr), 0) as qr_sales,
        COALESCE(SUM(mixed), 0) as mixed_sales
      FROM (
        SELECT
          COUNT(id) as cnt,
          SUM(total_amount) as total,
          SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END) as cash,
          SUM(CASE WHEN payment_method = 'QR' THEN total_amount ELSE 0 END) as qr,
          SUM(CASE WHEN payment_method = 'MIXED' THEN total_amount ELSE 0 END) as mixed
        FROM sales
        WHERE DATE(created_at) = CURDATE() AND status = 'COMPLETED'
        UNION ALL
        SELECT
          COUNT(id),
          SUM(total_amount),
          SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END),
          SUM(CASE WHEN payment_method = 'QR' THEN total_amount ELSE 0 END),
          0
        FROM orders
        WHERE DATE(completed_at) = CURDATE() AND status = 'COMPLETED'
      ) combined
    `);

    res.json({
      date: new Date().toISOString().split('T')[0],
      summary: rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/top-selling:
 *   get:
 *     summary: จัดอันดับสินค้าขายดี (Top 10)
 *     tags: [Reports]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/reports/top-selling', async (req, res) => {
  try {
    // ⭐️ รวมรายการจาก sale_items (ขายหน้าร้าน) กับ order_items (บิลจองที่ COMPLETED แล้ว)
    const [rows] = await pool.query(`
      SELECT product_id, name, SUM(quantity) as total_quantity, SUM(revenue) as total_revenue
      FROM (
        SELECT p.id as product_id, p.name as name, si.quantity as quantity, si.subtotal as revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        WHERE s.status = 'COMPLETED'
        UNION ALL
        SELECT p.id, p.name, oi.quantity, oi.subtotal
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE o.status = 'COMPLETED'
      ) combined
      GROUP BY product_id, name
      ORDER BY total_quantity DESC
      LIMIT 10
    `);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
/**
 * @swagger
 * /api/reports/vendor-sales:
 *   get:
 *     summary: สรุปยอดขายสินค้าฝากขายแยกตามนักศึกษา (สำหรับจ่ายเงินรอบเดือน)
 *     tags: [Reports]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/reports/vendor-sales', async (req, res) => {
  try {
    // ⭐️ ถ้ามี ?vendor_id= ส่งมา ให้กรองเฉพาะของเจ้าของคนนั้น (ใช้กับหน้า "ยอดฝากขายของฉัน")
    // ไม่ส่งมา = ดึงสรุปทุกคน (ใช้กับ ADMIN)
    const { vendor_id } = req.query;
    let query = `
      SELECT 
        u.id as vendor_id,
        u.student_id,
        u.full_name,
        SUM(si.quantity) as total_items_sold,
        SUM(si.subtotal) as total_sales,
        SUM(si.subtotal * (p.gp_rate / 100)) as coop_gp_earnings,
        SUM(si.subtotal - (si.subtotal * (p.gp_rate / 100))) as vendor_earnings
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      JOIN users u ON p.vendor_id = u.id
      WHERE s.status = 'COMPLETED'
    `;
    const params = [];
    if (vendor_id) {
      query += ` AND u.id = ?`;
      params.push(vendor_id);
    }
    query += ` GROUP BY u.id, u.student_id, u.full_name ORDER BY vendor_earnings DESC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/vendor-sales/detail:
 *   get:
 *     summary: รายละเอียดสินค้าฝากขายรายชิ้นของ vendor คนหนึ่ง (สำหรับหน้า "ยอดฝากขายของฉัน")
 *     tags: [Reports]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/reports/vendor-sales/detail', async (req, res) => {
  try {
    const { vendor_id } = req.query;
    if (!vendor_id) return res.status(400).json({ error: 'ต้องระบุ vendor_id' });

    const [rows] = await pool.query(`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.gp_rate,
        SUM(si.quantity) as quantity_sold,
        SUM(si.subtotal) as total_sales,
        SUM(si.subtotal * (p.gp_rate / 100)) as coop_gp_earnings,
        SUM(si.subtotal - (si.subtotal * (p.gp_rate / 100))) as vendor_earnings
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE s.status = 'COMPLETED' AND p.vendor_id = ?
      GROUP BY p.id, p.name, p.gp_rate
      ORDER BY vendor_earnings DESC
    `, [vendor_id]);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// =========================================
// REPORTS เพิ่มเติม (หมวด 5 — Dashboard ADMIN) — ทุก endpoint requireRole('ADMIN')
// =========================================

/**
 * @swagger
 * /api/reports/void-summary:
 *   get:
 *     summary: สรุปยอด/จำนวนบิลที่ถูกยกเลิก (VOID) วันนี้
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/void-summary', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT COUNT(id) as void_count, COALESCE(SUM(total_amount), 0) as void_amount
      FROM sales
      WHERE status = 'VOIDED' AND DATE(created_at) = CURDATE()
    `);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/shift-anomalies:
 *   get:
 *     summary: กะที่ปิดแล้วมีส่วนต่างเงินสดผิดปกติวันนี้ (|difference| เกิน tolerance)
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/shift-anomalies', requireRole('ADMIN'), async (req, res) => {
  try {
    // tolerance ±20 บาท ถือว่าปกติ เกินกว่านี้ = ผิดปกติ
    const [rows] = await pool.query(`
      SELECT sh.id, sh.difference, sh.closed_at, u.full_name as cashier_name
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      WHERE sh.status = 'CLOSED' AND DATE(sh.closed_at) = CURDATE() AND ABS(sh.difference) > 20
      ORDER BY ABS(sh.difference) DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/sales-comparison:
 *   get:
 *     summary: เปรียบเทียบยอดขายวันนี้ vs เมื่อวาน vs สัปดาห์ก่อน (%)
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/sales-comparison', requireRole('ADMIN'), async (req, res) => {
  try {
    // ยอดต่อวัน = sales (created_at) + orders COMPLETED (completed_at)
    const dayTotal = async (dateExpr) => {
      const [rows] = await pool.query(`
        SELECT
          (SELECT COALESCE(SUM(total_amount),0) FROM sales WHERE status='COMPLETED' AND DATE(created_at) = ${dateExpr})
          +
          (SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE status='COMPLETED' AND DATE(completed_at) = ${dateExpr})
          as total
      `);
      return Number(rows[0].total);
    };

    const today = await dayTotal('CURDATE()');
    const yesterday = await dayTotal('(CURDATE() - INTERVAL 1 DAY)');
    const lastWeek = await dayTotal('(CURDATE() - INTERVAL 7 DAY)');

    const pct = (base) => base > 0 ? Math.round(((today - base) / base) * 1000) / 10 : null;

    res.json({
      today, yesterday, last_week: lastWeek,
      pct_vs_yesterday: pct(yesterday),
      pct_vs_last_week: pct(lastWeek)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/hourly-sales:
 *   get:
 *     summary: ยอดขายรายชั่วโมงของวันนี้ (จาก sales.created_at)
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/hourly-sales', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT HOUR(created_at) as hour, COALESCE(SUM(total_amount),0) as total
      FROM sales
      WHERE status='COMPLETED' AND DATE(created_at) = CURDATE()
      GROUP BY HOUR(created_at)
      ORDER BY hour ASC
    `);
    // เติมชั่วโมงที่ไม่มียอดให้เป็น 0 (0-23) เพื่อกราฟต่อเนื่อง
    const map = {};
    rows.forEach(r => { map[r.hour] = Number(r.total); });
    const result = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: map[h] || 0 }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/sales-by-cashier:
 *   get:
 *     summary: สรุปยอดขาย/จำนวนบิลต่อพนักงานต่อกะ (วันนี้)
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/sales-by-cashier', requireRole('ADMIN'), async (req, res) => {
  try {
    // ⭐️ หมวด 6: JOIN sales.shift_id = shifts.id แม่นกว่าเทียบช่วงเวลา (รองรับเปิดกะซ้อนเวลากันหลายคน)
    // บิลเก่าก่อนมีคอลัมน์ shift_id จะไม่ถูกนับในรายงานนี้ (shift_id เป็น NULL)
    const [rows] = await pool.query(`
      SELECT
        sh.id as shift_id, u.id as cashier_id, u.full_name as cashier_name,
        sh.opened_at, sh.closed_at, sh.status as shift_status,
        COUNT(s.id) as bill_count, COALESCE(SUM(s.total_amount), 0) as total_sales
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      LEFT JOIN sales s ON s.shift_id = sh.id AND s.status = 'COMPLETED'
      WHERE DATE(sh.opened_at) = CURDATE()
      GROUP BY sh.id, u.id, u.full_name, sh.opened_at, sh.closed_at, sh.status
      ORDER BY sh.opened_at DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/open-shifts:
 *   get:
 *     summary: กะที่ยังเปิดค้างอยู่ (status=OPEN)
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/open-shifts', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT sh.id, sh.opening_cash, sh.opened_at, u.full_name as cashier_name
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      WHERE sh.status = 'OPEN'
      ORDER BY sh.opened_at ASC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/pending-orders:
 *   get:
 *     summary: Pre-order ที่ยังค้างดำเนินการ (ยังไม่ COMPLETED/CANCELLED)
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/pending-orders', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT status, COUNT(id) as count, COALESCE(SUM(total_amount),0) as total
      FROM orders
      WHERE status NOT IN ('COMPLETED', 'CANCELLED')
      GROUP BY status
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/sales-channel:
 *   get:
 *     summary: สัดส่วนยอดขายวันนี้ แยกหน้าร้าน (sales) vs Pre-order (orders)
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/sales-channel', requireRole('ADMIN'), async (req, res) => {
  try {
    const [walkin] = await pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM sales WHERE status='COMPLETED' AND DATE(created_at)=CURDATE()`);
    const [preorder] = await pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM orders WHERE status='COMPLETED' AND DATE(completed_at)=CURDATE()`);
    res.json({ walkin_sales: Number(walkin[0].total), preorder_sales: Number(preorder[0].total) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/gross-profit:
 *   get:
 *     summary: กำไรขั้นต้นวันนี้ (price - cost ต่อชิ้น) พร้อมหัก GP สินค้าฝากขาย
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/gross-profit', requireRole('ADMIN'), async (req, res) => {
  try {
    // กำไรขั้นต้น = subtotal - (cost * qty) - GP ที่ต้องคืน vendor (เฉพาะสินค้าฝากขาย)
    // GP สหกรณ์ = subtotal * gp_rate/100 คือส่วนที่สหกรณ์ได้ ส่วน vendor_earnings คืน vendor
    // กำไรจริงของสหกรณ์: สินค้าปกติ = subtotal - cost*qty ; สินค้าฝากขาย = subtotal * gp_rate/100
    const [rows] = await pool.query(`
      SELECT COALESCE(SUM(
        CASE
          WHEN p.vendor_id IS NOT NULL THEN si.subtotal * (p.gp_rate / 100)
          ELSE si.subtotal - (p.cost * si.quantity)
        END
      ), 0) as gross_profit
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE s.status='COMPLETED' AND DATE(s.created_at)=CURDATE()
    `);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/dead-stock:
 *   get:
 *     summary: สินค้าขายไม่ออก (ไม่มียอดขายใน 30 วันล่าสุด) แต่ยังมีสต๊อก
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/dead-stock', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.id, p.name, p.stock
      FROM products p
      WHERE p.is_active = TRUE AND p.stock > 0
        AND p.id NOT IN (
          SELECT DISTINCT si.product_id
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.status='COMPLETED' AND s.created_at >= (CURDATE() - INTERVAL 30 DAY)
        )
      ORDER BY p.stock DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/reports/vendor-summary:
 *   get:
 *     summary: สรุปยอดขายสินค้าฝากขายรวมทุก vendor (สำหรับ ADMIN) หัก GP แล้ว
 *     tags: [Reports]
 *     responses:
 *       200: { description: สำเร็จ }
 */
app.get('/api/reports/vendor-summary', requireRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        u.id as vendor_id, u.full_name as vendor_name,
        SUM(si.quantity) as total_items_sold,
        SUM(si.subtotal) as total_sales,
        SUM(si.subtotal * (p.gp_rate / 100)) as coop_gp_earnings,
        SUM(si.subtotal - (si.subtotal * (p.gp_rate / 100))) as vendor_earnings
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      JOIN users u ON p.vendor_id = u.id
      WHERE s.status='COMPLETED' AND p.vendor_id IS NOT NULL
      GROUP BY u.id, u.full_name
      ORDER BY vendor_earnings DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// 10. SETTINGS (ตั้งค่าร้านค้า)
// =========================================

/**
 * @swagger
 * /api/settings/store:
 *   get:
 *     summary: ดึงข้อมูลร้าน (ชื่อร้าน, ที่อยู่, เลขผู้เสียภาษี)
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/settings/store', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/settings/store:
 *   put:
 *     summary: อัปเดตข้อมูลร้านค้า
 *     tags: [Settings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               store_name:
 *                 type: string
 *               tax_id:
 *                 type: string
 *               address:
 *                 type: string
 *               receipt_footer:
 *                 type: string
 *     responses:
 *       200:
 *         description: อัปเดตสำเร็จ
 */
app.put('/api/settings/store', async (req, res) => {
  const { store_name, tax_id, address, receipt_footer } = req.body;
  try {
    await pool.query(
      'UPDATE settings SET store_name = ?, tax_id = ?, address = ?, receipt_footer = ? WHERE id = 1',
      [store_name, tax_id, address, receipt_footer]
    );
    res.json({ message: "อัปเดตข้อมูลร้านค้าสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/settings/receipt:
 *   get:
 *     summary: ดึงข้อความท้ายใบเสร็จ
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/settings/receipt', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT receipt_footer FROM settings WHERE id = 1');
    res.json({ receipt_footer: rows[0].receipt_footer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// 4.1 INVENTORY (ส่วนเสริมของระบบสินค้า)
// =========================================

/**
 * @swagger
 * /api/products/{id}/stock:
 *   patch:
 *     summary: ปรับสต๊อกแมนนวล (+ เติมของ, - ตัดของเสีย)
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - adjustment
 *               - type
 *             properties:
 *               adjustment:
 *                 type: integer
 *                 description: จำนวนที่ปรับ (บวกหรือลบ)
 *               type:
 *                 type: string
 *                 enum: [RESTOCK, DAMAGE, LOSS]
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: ปรับสต๊อกสำเร็จ
 */
app.patch('/api/products/:id/stock', async (req, res) => {
  const { adjustment, type, note } = req.body;
  if (adjustment === undefined || !type) {
    return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมี adjustment และ type)" });
  }

  try {
    // ใช้ GREATEST เพื่อป้องกันไม่ให้สต๊อกติดลบในกรณีที่ตัดของเสียมากกว่าที่มี
    const [result] = await pool.query(
      'UPDATE products SET stock = GREATEST(0, stock + ?) WHERE id = ?',
      [adjustment, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "ไม่พบสินค้า" });
    }

    // หมายเหตุ: ในระบบจริง อาจจะมีการบันทึกลงตาราง stock_history (ประวัติการปรับสต๊อก) ด้วย
    res.json({ message: `ปรับสต๊อกสำเร็จ (เหตุผล: ${type})` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/inventory/low-stock:
 *   get:
 *     summary: ดึงรายการสินค้าที่สต๊อกเหลือน้อย (<= 10 ชิ้น)
 *     tags: [Products]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/inventory/low-stock', async (req, res) => {
  try {
    // ดึงสินค้าที่เหลือน้อยกว่าหรือเท่ากับ 10 ชิ้น
    const [rows] = await pool.query('SELECT id, barcode, name, stock FROM products WHERE stock <= 10 AND is_active = TRUE ORDER BY stock ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// 8. PROMOTIONS (ระบบโปรโมชั่นและส่วนลด)
// =========================================

/**
 * @swagger
 * /api/promotions:
 *   get:
 *     summary: ดึงรายการโปรโมชั่นที่กำลังใช้งานอยู่
 *     tags: [Promotions]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/promotions', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM promotions WHERE is_active = TRUE AND (end_date IS NULL OR end_date >= CURDATE())');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/promotions:
 *   post:
 *     summary: สร้างโปรโมชั่นใหม่
 *     tags: [Promotions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               discount_type:
 *                 type: string
 *                 enum: [PERCENT, FIXED, BOGO]
 *               discount_value:
 *                 type: number
 *               start_date:
 *                 type: string
 *                 format: date
 *               end_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: สร้างสำเร็จ
 */
app.post('/api/promotions', async (req, res) => {
  const {
    name, discount_type, discount_value, start_date, end_date,
    buy_product_id, buy_qty, free_product_id, free_qty,
    usage_limit, usage_limit_per_user
  } = req.body;

  // ⭐️ BOGO/ซื้อครบแถม ต้องระบุ buy_product_id, buy_qty, free_product_id, free_qty ให้ครบ
  if (discount_type === 'BOGO' && (!buy_product_id || !buy_qty || !free_product_id || !free_qty)) {
    return res.status(400).json({ error: "โปรโมชั่นแบบซื้อครบแถม ต้องระบุสินค้าที่ต้องซื้อ, จำนวนที่ต้องซื้อ, สินค้าที่แถม, จำนวนที่แถม ให้ครบ" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO promotions
        (name, discount_type, discount_value, start_date, end_date, buy_product_id, buy_qty, free_product_id, free_qty, usage_limit, usage_limit_per_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, discount_type, discount_value || 0, start_date || null, end_date || null,
       buy_product_id || null, buy_qty || null, free_product_id || null, free_qty || null,
       usage_limit || null, usage_limit_per_user || null]
    );
    res.status(201).json({ id: result.insertId, message: "สร้างโปรโมชั่นสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * @swagger
 * /api/promotions/verify:
 *   post:
 *     summary: ตรวจสอบและคำนวณส่วนลดของตะกร้าสินค้า
 *     tags: [Promotions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - promotion_id
 *               - grand_total
 *             properties:
 *               promotion_id:
 *                 type: integer
 *               grand_total:
 *                 type: number
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.post('/api/promotions/verify', async (req, res) => {
  const { promotion_id, grand_total, items, member_id } = req.body;
  try {
    const [promos] = await pool.query('SELECT * FROM promotions WHERE id = ? AND is_active = TRUE', [promotion_id]);
    if (promos.length === 0) return res.status(404).json({ error: "ไม่พบโปรโมชั่น หรือโปรโมชั่นหมดอายุแล้ว" });

    const promo = promos[0];

    const limitError = await checkPromotionUsageLimit(pool.query.bind(pool), promo, member_id || null);
    if (limitError) return res.status(400).json({ error: limitError });

    const discount_amount = await calculatePromotionDiscount(pool.query.bind(pool), promo, grand_total, items);
    if (promo.discount_type === 'BOGO' && discount_amount === 0) {
      return res.status(400).json({ error: "ตะกร้าไม่ตรงเงื่อนไขโปรโมชั่นนี้ (ซื้อไม่ครบจำนวน หรือไม่มีสินค้าที่แถมในตะกร้า)" });
    }
    const net_total = grand_total - discount_amount;

    res.json({ discount_amount, net_total, promo_name: promo.name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// 9. SUPPLIERS & PURCHASES (รับของเข้า)
// =========================================

/**
 * @swagger
 * /api/suppliers:
 *   get:
 *     summary: ดึงรายชื่อซัพพลายเออร์ทั้งหมด
 *     tags: [Purchases]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/suppliers', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM suppliers');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/suppliers:
 *   post:
 *     summary: เพิ่มซัพพลายเออร์
 *     tags: [Purchases]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               contact_info:
 *                 type: string
 *     responses:
 *       201:
 *         description: สร้างสำเร็จ
 */
app.post('/api/suppliers', async (req, res) => {
  const { name, contact_info } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO suppliers (name, contact_info) VALUES (?, ?)', [name, contact_info]);
    res.status(201).json({ id: result.insertId, message: "เพิ่มซัพพลายเออร์สำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/suppliers/{id}:
 *   delete:
 *     summary: ลบซัพพลายเออร์
 *     tags: [Purchases]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: ลบสำเร็จ
 */
app.delete('/api/suppliers/:id', async (req, res) => {
  try {
    // ลบข้อมูลซัพพลายเออร์ตาม ID
    await pool.query('DELETE FROM suppliers WHERE id = ?', [req.params.id]);
    res.json({ message: "ลบข้อมูลซัพพลายเออร์สำเร็จ" });
  } catch (error) {
    // ดัก Error กรณีที่ซัพพลายเออร์เจ้านี้เคยส่งของให้เราแล้ว (มีบิลผูกอยู่)
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ error: "ไม่สามารถลบได้ เนื่องจากซัพพลายเออร์นี้มีประวัติการรับสินค้าในคลังแล้ว" });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/purchases:
 *   post:
 *     summary: สร้างใบรับสินค้าเข้าคลัง (เพิ่มสต๊อกและอัปเดตต้นทุนอัตโนมัติ)
 *     tags: [Purchases]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_id
 *               - items
 *             properties:
 *               supplier_id:
 *                 type: integer
 *               user_id:
 *                 type: integer
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     product_id:
 *                       type: integer
 *                     quantity:
 *                       type: integer
 *                     unit_cost:
 *                       type: number
 *     responses:
 *       201:
 *         description: รับของเข้าสำเร็จ
 */

app.post('/api/purchases', async (req, res) => {
  const { supplier_id, user_id, items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: "ไม่มีรายการสินค้า" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let totalCost = 0;
    const processedItems = [];

    // ⭐️ ตรวจสอบ + คำนวณยอดรวมบิลสั่งซื้อ (กัน quantity/unit_cost ติดลบหรือศูนย์)
    for (const item of items) {
      const quantity = Number(item.quantity);
      const unitCost = Number(item.unit_cost);
      if (!quantity || quantity <= 0) throw new Error(`จำนวนรับเข้าต้องมากกว่า 0 (สินค้า ID: ${item.product_id})`);
      if (!(unitCost > 0)) throw new Error(`ทุน/ชิ้นต้องมากกว่า 0 (สินค้า ID: ${item.product_id})`);

      const subtotal = quantity * unitCost;
      totalCost += subtotal;
      processedItems.push({ product_id: item.product_id, quantity, unit_cost: unitCost, subtotal });
    }

    // 1. สร้างบิลรับของเข้า
    const [purchaseResult] = await conn.query(
      'INSERT INTO purchases (supplier_id, user_id, total_cost) VALUES (?, ?, ?)',
      [supplier_id || null, user_id, totalCost]
    );
    const purchaseId = purchaseResult.insertId;

    // 2. บันทึกรายการของเข้า และ อัปเดตสต๊อก+ต้นทุนถัวเฉลี่ยถ่วงน้ำหนักในตาราง products
    for (const item of processedItems) {
      // บันทึกรายการ (unit_cost ต่อล็อตจริง เก็บไว้ตรงนี้เสมอ ใช้คำนวณกำไรย้อนหลังแบบแยกตามล็อตได้แม่นยำ ไม่อิง products.cost ปัจจุบัน)
      await conn.query(
        'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)',
        [purchaseId, item.product_id, item.quantity, item.unit_cost, item.subtotal]
      );

      // ⭐️ ต้นทุนถัวเฉลี่ยถ่วงน้ำหนัก: new_avg = (stock_เดิม*cost_เดิม + qty_รับเข้า*unit_cost_ใหม่) / (stock_เดิม+qty_รับเข้า)
      const [prodRows] = await conn.query('SELECT stock, cost FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      if (prodRows.length === 0) throw new Error(`ไม่พบสินค้า ID: ${item.product_id}`);
      const { stock: stockBefore, cost: costBefore } = prodRows[0];

      const newStock = Number(stockBefore) + item.quantity;
      const newAvgCost = ((Number(stockBefore) * Number(costBefore)) + (item.quantity * item.unit_cost)) / newStock;

      await conn.query('UPDATE products SET stock = ?, cost = ? WHERE id = ?', [newStock, newAvgCost, item.product_id]);
    }

    await conn.commit();
    req.io.emit('stock_updated', { message: 'มีการรับสินค้าเข้าคลัง สต๊อกอัปเดตแล้ว' });
    res.status(201).json({ message: "บันทึกการรับสินค้าเข้าคลังสำเร็จ", purchase_id: purchaseId });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// =========================================
// 11. PRE-ORDER & NOTIFICATIONS (ระบบสั่งจองและแจ้งเตือน)
// =========================================

// 1. API สำหรับอัปโหลดสลิป
app.post('/api/orders/upload-slip', upload.single('slip'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ไม่พบไฟล์รูปภาพ" });
  res.json({ slip_url: `/uploads/${req.file.filename}` });
});

// 2. API สร้างออเดอร์ใหม่
app.post('/api/orders', async (req, res) => {
  // รับข้อมูลจากหน้าเว็บ (⭐️ เพิ่ม redeem_points สำหรับแลกแต้มเป็นส่วนลด)
  const { items, payment_method, slip_image, use_phone_for_points, redeem_points } = req.body;
  const user_id = req.user.id; // ดึงจากคนที่ล็อกอินอยู่

  if (!items || items.length === 0) return res.status(400).json({ error: "ตะกร้าว่างเปล่า" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let totalAmount = 0;
    const processedItems = [];

    // คำนวณราคา + เช็คสต๊อกพอจริง (ล็อกแถวสินค้ากันขายเกินตอนมีหลายคนจองพร้อมกัน)
    for (const item of items) {
      const [rows] = await conn.query('SELECT price, stock, name FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      if (rows.length === 0) throw new Error(`ไม่พบสินค้า ID ${item.product_id}`);
      if (rows[0].stock < item.quantity) {
        throw new Error(`สต๊อกไม่พอสำหรับ "${rows[0].name}" (เหลือ ${rows[0].stock}, ต้องการ ${item.quantity})`);
      }
      const subtotal = Number(rows[0].price) * item.quantity;
      totalAmount += subtotal;
      processedItems.push({ product_id: item.product_id, quantity: item.quantity, price: rows[0].price, subtotal, stock_before: rows[0].stock });
    }

    // ⭐️ แลกแต้มเป็นส่วนลด (1 แต้ม = ฿1) — คำนวณ/ตรวจสอบใหม่ฝั่ง backend ทั้งหมด ห้ามเชื่อ client
    // (pattern เดียวกับ POST /sales/checkout: ล็อกแถว users FOR UPDATE กันแลกแต้มซ้ำ/เกินยอดจริง)
    let pointsRedeemed = 0;
    let pointsDiscount = 0;
    if (redeem_points > 0) {
      const [userRows] = await conn.query('SELECT points FROM users WHERE id = ? FOR UPDATE', [user_id]);
      if (userRows.length === 0) throw new Error('ไม่พบข้อมูลผู้ใช้');
      const availablePoints = userRows[0].points;

      pointsRedeemed = Math.min(Number(redeem_points), availablePoints, Math.floor(totalAmount));
      if (pointsRedeemed < 0) pointsRedeemed = 0;
      pointsDiscount = pointsRedeemed; // อัตรา 1 แต้ม = ฿1
    }
    const netTotal = totalAmount - pointsDiscount;

    // คำนวณแต้มสะสมใหม่ที่จะได้รับ ถ้าลูกค้ากรอกเบอร์มา หรือติ๊กว่าจะสะสมแต้ม
    // (ทุก 20 บาท = 1 แต้ม, คิดจากยอดสุทธิ "หลังหักแต้มที่แลกไปแล้ว" เหมือน pattern ใน /sales/checkout)
    const earnPoints = use_phone_for_points ? Math.floor(netTotal / 20) : 0;
    
    // สถานะ: ถ้าจ่ายสแกน = รอตรวจสอบสลิป, ถ้าเงินสด = รอจ่ายหน้าร้าน
    const status = payment_method === 'QR' ? 'PENDING_VERIFY' : 'WAITING_CASH';

    // บันทึกหัวบิลออเดอร์ (⭐️ total_amount = ยอดสุทธิหลังหักแต้มแล้ว, เก็บ points_redeemed/points_discount ไว้ด้วย)
    const [orderResult] = await conn.query(
      'INSERT INTO orders (user_id, total_amount, payment_method, slip_image, earn_points, points_redeemed, points_discount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [user_id, netTotal, payment_method, slip_image || null, earnPoints, pointsRedeemed, pointsDiscount, status]
    );
    const orderId = orderResult.insertId;

    // บันทึกรายการสินค้าในออเดอร์ + ตัดสต๊อกทันที (กันขายเกินตั้งแต่ลูกค้ากดจอง)
    const lowStockMsgs = [];
    for (const item of processedItems) {
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)',
        [orderId, item.product_id, item.quantity, item.price, item.subtotal]
      );
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id]);
      const msg = await notifyIfLowStock(conn, req.io, item.product_id, item.stock_before, item.stock_before - item.quantity);
      if (msg) lowStockMsgs.push(msg);
    }

    // ⭐️ หักแต้มที่แลกใช้ไปทันที (กันแลกแต้มซ้ำ/เกินยอดจริงถ้าลูกค้ามีออเดอร์ค้างหลายใบพร้อมกัน)
    // ถ้าออเดอร์นี้ถูกยกเลิกภายหลัง ระบบจะคืนแต้มให้ที่ PUT /orders/:id/status (CANCELLED) และ /orders/:id/cancel-by-user
    if (pointsRedeemed > 0) {
      await conn.query('UPDATE users SET points = points - ? WHERE id = ?', [pointsRedeemed, user_id]);
    }

    // ⭐️ บันทึกแจ้งเตือนระบบ: มีออเดอร์จองใหม่เข้ามา (ให้พนักงานเห็นในหน้าแจ้งเตือนด้วย ไม่ใช่แค่ badge)
    const newOrderMsg = `มีคำสั่งซื้อจองใหม่ #${orderId} เข้ามา`;
    await conn.query('INSERT INTO notifications (user_id, message) VALUES (NULL, ?)', [newOrderMsg]);

    await conn.commit();

    // ⭐️ เวทมนตร์ WebSocket: แจ้งเตือนพนักงานว่ามีออเดอร์ใหม่เข้าแล้ว!!
    req.io.emit('new_order_received', { message: 'มีคำสั่งซื้อใหม่เข้ามา!', order_id: orderId });
    req.io.emit('notifications_updated', { message: newOrderMsg });
    req.io.emit('stock_updated', { message: `ออเดอร์จอง #${orderId} ตัดสต๊อกแล้ว` });
    lowStockMsgs.forEach(msg => req.io.emit('notifications_updated', { message: msg }));

    res.status(201).json({
      message: "สั่งจองสินค้าสำเร็จ",
      order_id: orderId,
      points_redeemed: pointsRedeemed,
      points_discount: pointsDiscount,
      total_amount: netTotal
    });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// 3. API ดึงรายการออเดอร์
app.get('/api/orders', async (req, res) => {
  try {
    let query = `
      SELECT o.*, u.full_name as customer_name, u.phone_number,
             a.full_name as assigned_name
      FROM orders o 
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN users a ON o.assigned_to = a.id
      ORDER BY o.created_at DESC
    `;
    
    // ถ้าเป็นแค่ MEMBER ให้ดูได้แค่ออเดอร์ของตัวเอง
    if (req.user.role === 'MEMBER') {
      query = `
        SELECT o.*, u.full_name as customer_name, u.phone_number,
               a.full_name as assigned_name
        FROM orders o 
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN users a ON o.assigned_to = a.id
        WHERE o.user_id = ${req.user.id} 
        ORDER BY o.created_at DESC
      `;
    }

    const [orders] = await pool.query(query);

    // ดึงรายการสินค้าข้างในออเดอร์มาให้ด้วยเลย
    for (let order of orders) {
      const [items] = await pool.query(`
        SELECT oi.*, p.name as product_name, p.image_url 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id = ?
      `, [order.id]);
      order.items = items;
    }

    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. API จัดการสถานะออเดอร์ (พนักงานกดยืนยัน / ยกเลิก)
app.put('/api/orders/:id/status', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
  const orderId = req.params.id;
  const { status, reject_reason } = req.body;
  // status: PENDING_VERIFY → PREPARING → READY → COMPLETED
  //         PENDING_VERIFY → SLIP_REJECTED (สลิปผิด, ขอส่งใหม่)
  //         PENDING_VERIFY → REFUND_REQUESTED (โอนแล้วแต่ไม่เอาแล้ว)
  //         PENDING_VERIFY/any → CANCELLED (สลิปปลอม/ยกเลิก)

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ดึงข้อมูลออเดอร์มาเช็ค
    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (orders.length === 0) throw new Error("ไม่พบออเดอร์นี้");
    const order = orders[0];

    // ⭐️ ตรวจสิทธิ์: ถ้ามี assigned_to แล้ว เฉพาะคนนั้น (หรือ ADMIN) เท่านั้นที่แก้ได้
    if (order.assigned_to && order.assigned_to !== req.user.id && req.user.role !== 'ADMIN') {
      const [assignee] = await conn.query('SELECT full_name FROM users WHERE id = ?', [order.assigned_to]);
      throw new Error(`ออเดอร์นี้อยู่ในความรับผิดชอบของ ${assignee[0]?.full_name || 'พนักงานท่านอื่น'} แล้ว`);
    }

    // ⭐️ กันยกเลิกซ้ำ (ป้องกันคืนแต้มซ้ำสองรอบถ้ากดยกเลิกออเดอร์ที่ถูกยกเลิกไปแล้ว)
    if (status === 'CANCELLED' && order.status === 'CANCELLED') {
      throw new Error("ออเดอร์นี้ถูกยกเลิกไปแล้ว");
    }

    // ⭐️ ห้ามยกเลิกออเดอร์ที่เริ่มเตรียมของ/พร้อมให้รับแล้ว (กันเตรียมของไปแล้วโดนยกเลิกทีหลัง)
    if (status === 'CANCELLED' && ['PREPARING', 'READY'].includes(order.status)) {
      throw new Error("ไม่สามารถยกเลิกได้ เนื่องจากเริ่มเตรียมสินค้าไปแล้ว");
    }

    let stockChanged = false;
    const lowStockMsgs = [];

    // ⭐️ ถ้ายังไม่มีคนรับงาน → auto-assign ให้คนที่กดเลย (first action = claim)
    if (!order.assigned_to) {
      await conn.query('UPDATE orders SET assigned_to = ? WHERE id = ?', [req.user.id, orderId]);
    }

    // อัปเดตสถานะ
    await conn.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);

    // ถ้ายกเลิกออเดอร์ (เช่น สลิปมั่ว) — คืนสต๊อกกลับ เพราะตัดไปแล้วตั้งแต่ตอนลูกค้าจอง
    let cancelMsg = null;
    if (status === 'CANCELLED') {
      cancelMsg = `ออเดอร์ #${orderId} ถูกยกเลิก เนื่องจาก: ${reject_reason || 'สลิปไม่ถูกต้อง'}`;
      await conn.query('INSERT INTO notifications (user_id, message) VALUES (?, ?)', [order.user_id, cancelMsg]);

      const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
      for (const item of items) {
        await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
      }
      stockChanged = true;

      // ⭐️ คืนแต้มที่เคยแลกไปตอนสั่งจอง (ถ้ามี) เพราะบิลนี้ไม่สำเร็จแล้ว
      if (order.points_redeemed > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.points_redeemed, order.user_id]);
      }
    }

    // ⭐️ สลิปผิด — คืนสต๊อก แจ้งลูกค้าให้ส่งสลิปใหม่หรือยกเลิก
    if (status === 'SLIP_REJECTED') {
      const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
      for (const item of items) {
        await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
      }
      stockChanged = true;
    }

    // ⭐️ ขอคืนเงิน (โอนมาแล้วแต่ไม่เอาแล้ว) — แจ้งลูกค้าให้นำสลิปมาที่ร้าน + คืนแต้ม
    if (status === 'REFUND_REQUESTED') {
      if (order.points_redeemed > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.points_redeemed, order.user_id]);
      }
    }

    // ถ้าออเดอร์เสร็จสมบูรณ์ (ลูกค้ามารับของแล้ว) ให้เพิ่มแต้มสะสม (สต๊อกตัดไปแล้วตั้งแต่ตอนจอง)
    if (status === 'COMPLETED') {
      await conn.query('UPDATE orders SET completed_at = NOW() WHERE id = ?', [orderId]);
      if (order.earn_points > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.earn_points, order.user_id]);
      }
    }

    // ⭐️ แจ้งเตือนลูกค้าแบบมีข้อความจริง บันทึกลง notifications ด้วย (ไม่ใช่แค่ socket เฉยๆ กันพลาดถ้าลูกค้าไม่ได้เปิดแอปอยู่ตอนนั้น)
    const statusMessages = {
      PREPARING: `ออเดอร์ #${orderId} พนักงานรับเรื่องแล้ว กำลังเตรียมสินค้า ${order.payment_method === 'CASH' ? 'เตรียมเงินไว้ได้เลยครับ' : ''}`,
      READY: `ออเดอร์ #${orderId} เตรียมสินค้าเสร็จแล้ว พร้อมให้มารับได้เลยครับ`,
      COMPLETED: `ออเดอร์ #${orderId} รับสินค้าเรียบร้อยแล้ว ขอบคุณที่ใช้บริการครับ`,
      SLIP_REJECTED: `ออเดอร์ #${orderId} สลิปไม่ถูกต้อง: ${reject_reason || 'กรุณาตรวจสอบสลิปอีกครั้ง'} — ถ้าโอนมาแล้วจริงให้แนบสลิปใหม่ที่ถูกต้อง ถ้าต้องการยกเลิกแจ้งพนักงานได้เลย`,
      REFUND_REQUESTED: `ออเดอร์ #${orderId} อยู่ระหว่างรอคืนเงิน — กรุณานำหลักฐานการโอนมาที่ร้านเพื่อรับเงินคืนเป็นเงินสด`,
    };
    const statusMsg = statusMessages[status] || cancelMsg;
    if (statusMessages[status]) {
      await conn.query('INSERT INTO notifications (user_id, message) VALUES (?, ?)', [order.user_id, statusMsg]);
    }

    await conn.commit();

    // ⭐️ ย้ายมาหลัง commit เสมอ กัน client รีเฟรชแล้วเจอข้อมูลเก่า (transaction ยังไม่ commit ตอนยิง event)
    if (stockChanged) req.io.emit('stock_updated', { message: `ออเดอร์ #${orderId} อัปเดตสต๊อกแล้ว` });
    lowStockMsgs.forEach(msg => req.io.emit('notifications_updated', { message: msg }));
    if (statusMsg) req.io.emit(`notification_user_${order.user_id}`, { message: statusMsg });
    req.io.emit(`order_update_user_${order.user_id}`, { order_id: orderId, status: status });
    req.io.emit('order_status_changed', { order_id: orderId, status: status });

    res.json({ message: "อัปเดตสถานะออเดอร์สำเร็จ" });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// ⭐️ 1. แก้ไข API ดึงแจ้งเตือนให้ดึงแค่ 50 รายการล่าสุด
// ⭐️ ADMIN/CASHIER เห็นแจ้งเตือนระบบ (user_id IS NULL: ออเดอร์ใหม่/void/สต๊อกใกล้หมด) รวมกับของตัวเอง
// MEMBER เห็นเฉพาะแจ้งเตือนของตัวเอง (เช่น สถานะออเดอร์ที่จอง/ตีกลับสลิป)
app.get('/api/notifications', async (req, res) => {
  try {
    const isStaff = ['ADMIN', 'CASHIER'].includes(req.user.role);
    const query = isStaff
      ? 'SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY created_at DESC LIMIT 50'
      : 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50';
    const [rows] = await pool.query(query, [req.user.id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ⭐️ ทำเครื่องหมายอ่านแจ้งเตือนทั้งหมดแล้ว (เรียกตอนกดกระดิ่ง) — ครอบคลุมทั้งของตัวเองและของระบบที่ role นี้เห็นได้
app.put('/api/notifications/read-all', async (req, res) => {
  try {
    const isStaff = ['ADMIN', 'CASHIER'].includes(req.user.role);
    const query = isStaff
      ? 'UPDATE notifications SET is_read = 1 WHERE user_id IS NULL OR user_id = ?'
      : 'UPDATE notifications SET is_read = 1 WHERE user_id = ?';
    await pool.query(query, [req.user.id]);
    res.json({ message: "อ่านแจ้งเตือนทั้งหมดแล้ว" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ⭐️ API ดึงจำนวนออเดอร์ที่รอจัดการ (แสดงเลข Badge แดงๆ) — ย้ายมาไว้ก่อน จะได้ลบ route ซ้ำด้านล่างได้สะดวก
app.get('/api/orders/pending-count', requireRole('ADMIN', 'CASHIER'), async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT COUNT(id) as count FROM orders WHERE status IN ('PENDING_VERIFY', 'WAITING_CASH', 'PREPARING')");
    res.json({ count: rows[0].count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ⭐️ เพิ่ม API ให้ลูกค้ายกเลิกออเดอร์ตัวเอง
app.put('/api/orders/:id/cancel-by-user', authenticateToken, async (req, res) => {
  const orderId = req.params.id;
  const { refund_info } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE', [orderId, req.user.id]);
    if (orders.length === 0) throw new Error("ไม่พบออเดอร์นี้ หรือคุณไม่มีสิทธิ์ยกเลิก");
    const order = orders[0];

    if (!['PENDING_VERIFY', 'WAITING_CASH'].includes(order.status)) {
      throw new Error("ไม่สามารถยกเลิกได้ (ระบบกำลังเตรียมของหรือเสร็จแล้ว) กรุณาติดต่อพนักงาน");
    }

    const cancelReason = order.payment_method === 'QR' 
      ? `ลูกค้ายกเลิกเอง (คืนเงินไปที่: ${refund_info})` 
      : 'ลูกค้ายกเลิกเอง';

    await conn.query('UPDATE orders SET status = ?, reject_reason = ? WHERE id = ?', ['CANCELLED', cancelReason, orderId]);

    // ⭐️ คืนสต๊อกกลับ เพราะตัดไปแล้วตั้งแต่ตอนจอง
    const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
    for (const item of items) {
      await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
    }

    // ⭐️ คืนแต้มที่เคยแลกไปตอนสั่งจอง (ถ้ามี) เพราะบิลนี้ไม่สำเร็จแล้ว
    if (order.points_redeemed > 0) {
      await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [order.points_redeemed, order.user_id]);
    }

    await conn.commit();

    req.io.emit('new_order_received', { message: `❌ ลูกค้ายกเลิกออเดอร์ #${orderId}`, order_id: orderId });
    req.io.emit('order_status_changed', { order_id: orderId, status: 'CANCELLED' });
    req.io.emit('stock_updated', { message: `ออเดอร์ #${orderId} ยกเลิก คืนสต๊อกแล้ว` });
    req.io.emit(`order_update_user_${order.user_id}`, { order_id: orderId, status: 'CANCELLED' });

    res.json({ message: "ยกเลิกออเดอร์สำเร็จ" });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// =========================================
// API สำหรับล้างข้อมูล (เตรียมอัปเกรดระบบ)
// =========================================
app.get('/api/clear-data', requireRole('ADMIN'), async (req, res) => {
  try {
    // ปิดการเช็ค Foreign Key ชั่วคราว เพื่อให้ลบข้อมูลที่ผูกกันอยู่ได้
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');

    // รายชื่อตารางที่ต้องการล้างข้อมูลทิ้ง (ไม่รวม users และ settings)
    const tablesToClear = [
      'purchase_items',
      'purchases',
      'sale_items',
      'sales',
      'shifts',
      'products',
      'promotions',
      'suppliers',
      'members'
    ];

    // วนลูปใช้คำสั่ง TRUNCATE ล้างข้อมูลและรีเซ็ต AUTO_INCREMENT เป็น 1
    for (let table of tablesToClear) {
      await pool.query(`TRUNCATE TABLE ${table}`);
    }

    // เปิดการเช็ค Foreign Key กลับมาเหมือนเดิม
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');

    res.json({ message: "เคลียร์ข้อมูลสำเร็จ! ข้อมูลสินค้าและบิลหายไปแล้ว (แต่ยังคง User ไว้) 🎉" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// API สำหรับนำเข้าข้อมูลสินค้าเริ่มต้น (Seed Data)
// =========================================
app.get('/api/seed-data', requireSetupKey, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. นำเข้าหมวดหมู่สินค้า 5 หมวด
    const categories = ['ไอศกรีม', 'เครื่องดื่ม', 'ขนมขบเคี้ยวและเบเกอรี่', 'อาหารกึ่งสำเร็จรูป', 'เครื่องเขียนและของเบ็ดเตล็ด'];
    const catMap = {}; // เก็บ ID ของหมวดหมู่ที่เพิ่งสร้าง
    for (let i = 0; i < categories.length; i++) {
      const [result] = await conn.query('INSERT INTO categories (name) VALUES (?)', [categories[i]]);
      catMap[categories[i]] = result.insertId;
    }

    // 2. รายการสินค้าทั้งหมดจากไฟล์ที่นายส่งมา (ให้สต๊อกเริ่มต้นที่ 50 ชิ้น และตั้งต้นทุนให้)
    const products = [
      // หมวด: ไอศกรีม
      { cat: 'ไอศกรีม', code: 'IC001', name: 'ไอศกรีมแม็กนั่ม อัลมอนด์ / คลาสสิก', price: 50 },
      { cat: 'ไอศกรีม', code: 'IC002', name: 'คอร์นเนตโต รสช็อกโกแลต คลาสสิก', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC003', name: 'คอร์นเนตโต รสสตรอเบอร์รี่', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC004', name: 'คอร์นเนตโต รสช็อกโกแลต-วานิลลา', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC005', name: 'คอร์นเนตโต รสชาเขียว / รสพิเศษขนาดใหญ่', price: 35 },
      { cat: 'ไอศกรีม', code: 'IC006', name: 'คอร์นเนตโต รสพิเศษ', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC007', name: 'วอลล์ ท็อปเท็น รสช็อกโกแลต', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC008', name: 'วอลล์ ท็อปเท็น รสวานิลลาช็อก', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC009', name: 'วอลล์ สวีทฮาร์ท ช็อกโกแลต', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC010', name: 'วอลล์ บอนด์ บอนด์ รสช็อกโกแลต', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC011', name: 'วอลล์ บอนด์ บอนด์ รสผลไม้/วานิลลา', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC012', name: 'วอลล์คัพ รสช็อกโกแลต', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC013', name: 'วอลล์คัพ รสสตรอเบอร์รี่', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC014', name: 'วอลล์คัพ รสวานิลลา', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC015', name: 'วอลล์ ป๊อป ถ้วยกลมเล็ก', price: 20 },
      { cat: 'ไอศกรีม', code: 'IC016', name: 'แพดเดิลป๊อป ทวิสเตอร์', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC017', name: 'แพดเดิลป๊อป ฟรุตตี้แม็กซ์', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC018', name: 'แพดเดิลป๊อป รสเรนโบว์', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC019', name: 'แพดเดิลป๊อป จรวด ทอยสตอรี่', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC020', name: 'แพดเดิลป๊อป ผีน้อย', price: 10 },
      { cat: 'ไอศกรีม', code: 'IC021', name: 'แพดเดิลป๊อป ช็อกลาวา', price: 10 },
      { cat: 'ไอศกรีม', code: 'IC022', name: 'แพดเดิลป๊อป รสฟุตบอล', price: 10 },
      { cat: 'ไอศกรีม', code: 'IC023', name: 'แพดเดิลป๊อป แท่งเล็กราคาประหยัด', price: 5 },
      { cat: 'ไอศกรีม', code: 'IC024', name: 'เนสท์เล่ ลาฟรุ๊ตต้า รสโยเกิร์ตลิ้นจี่', price: 15 },
      { cat: 'ไอศกรีม', code: 'IC025', name: 'ไอศกรีมโอรีโอ แซนด์วิช/สติ๊ก', price: 35 },
      { cat: 'ไอศกรีม', code: 'IC026', name: 'เนสกาแฟ โกลด์ คาปูชิโน่ แท่ง', price: 40 },
      { cat: 'ไอศกรีม', code: 'IC027', name: 'วอลล์ รสข้าวเหนียวมะม่วง', price: 20 },

      // หมวด: เครื่องดื่ม
      { cat: 'เครื่องดื่ม', code: 'BV001', name: 'ชาคูลล์ซ่า กรีนที เลมอน', price: 15 },
      { cat: 'เครื่องดื่ม', code: 'BV002', name: 'ชาคูลล์ซ่า รสองุ่นเคียวโฮ', price: 15 },
      { cat: 'เครื่องดื่ม', code: 'BV003', name: 'นม UHT รสจืด/รสหวาน', price: 17 },
      { cat: 'เครื่องดื่ม', code: 'BV004', name: 'น้ำอัดลมกระป๋อง', price: 17 },
      { cat: 'เครื่องดื่ม', code: 'BV005', name: 'โออิชิ รสน้ำผึ้งผสมมะนาว', price: 20 },
      { cat: 'เครื่องดื่ม', code: 'BV006', name: 'โออิชิ รสข้าวญี่ปุ่น', price: 20 },
      { cat: 'เครื่องดื่ม', code: 'BV007', name: 'โออิชิ รสองุ่นเคียวโฮ', price: 20 },
      { cat: 'เครื่องดื่ม', code: 'BV008', name: 'น้ำดื่มเพียวไลฟ์ / คริสตัล', price: 10 },
      { cat: 'เครื่องดื่ม', code: 'BV009', name: 'นมกล่องโฟร์โมสต์/ไทย-เดนมาร์ค', price: 12 },
      { cat: 'เครื่องดื่ม', code: 'BV010', name: 'ดีไลท์ / ดัชมิลล์ ขวดเล็ก', price: 10 },
      { cat: 'เครื่องดื่ม', code: 'BV011', name: 'น้ำอัดลมน้ำดำ/น้ำแดง ขวดใหญ่', price: 30 },

      // หมวด: ขนมขบเคี้ยวและเบเกอรี่
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN001', name: 'เลย์ รสคลาสสิก', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN002', name: 'เลย์ รสมะเขือเทศ', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN003', name: 'เลย์ รสโนริสาหร่าย', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN004', name: 'เลย์ รสเอ็กซ์ตร้าบาร์บีคิว', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN005', name: 'ขนมโตโต้', price: 5 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN006', name: 'ขนมรูปไก่ย่าง / ปาปริก้า', price: 5 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN007', name: 'สแน็คแจ๊ค', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN008', name: 'คอนเน่ รสดั้งเดิม', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN009', name: 'วาฟเฟิลอบกรอบแผ่นกลม', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN010', name: 'ครองแครงกรอบ', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN011', name: 'กล้วยฉาบ / เผือกฉาบ', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN012', name: 'แคบหมูทอดกรอบ', price: 15 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN013', name: 'ขนมซองขนาดเล็ก (คละยี่ห้อ)', price: 5 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN014', name: 'ขนมปังอบกรอบหน้าเนยน้ำตาล (เล็ก)', price: 10 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN015', name: 'ขนมปังอบกรอบหน้าเนยน้ำตาล (ใหญ่)', price: 20 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN016', name: 'มาร์ชแมลโลว์ / เยลลี่กระปุก', price: 10 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN017', name: 'สาหร่ายเถ้าแก่น้อย บิ๊กชีท', price: 5 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN018', name: 'เวเฟอร์ทิวลี่ทวิน รสช็อกโกแลต', price: 5 },
      { cat: 'ขนมขบเคี้ยวและเบเกอรี่', code: 'SN019', name: 'ปลาหมึกแผ่นปรุงรส / เบนโตะ', price: 5 },

      // หมวด: อาหารกึ่งสำเร็จรูป
      { cat: 'อาหารกึ่งสำเร็จรูป', code: 'IF001', name: 'มาม่าคัพ รสต้มยำกุ้ง / หมูสับ', price: 15 },
      { cat: 'อาหารกึ่งสำเร็จรูป', code: 'IF002', name: 'ไวไวคัพ รสดั้งเดิม / ต้มยำ', price: 15 },

      // หมวด: เครื่องเขียนและของเบ็ดเตล็ด
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST001', name: 'กระบอกพลาสติกใสเอนกประสงค์', price: 25 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST002', name: 'ไม้บรรทัดพลาสติกสี', price: 10 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST003', name: 'ยางลบก้อนสีขาว', price: 5 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST004', name: 'กรรไกรสำนักงาน', price: 20 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST005', name: 'สมุดโน้ตปกพลาสติกอ่อน', price: 15 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST006', name: 'เหรียญของเล่นพลาสติกสีทอง', price: 10 },
      { cat: 'เครื่องเขียนและของเบ็ดเตล็ด', code: 'ST007', name: 'เข็มขัดนักเรียนชายสีดำ', price: 50 },
    ];

    // นำเข้าสินค้า
    for (const p of products) {
      const categoryId = catMap[p.cat];
      const stock = 50; // ให้สต๊อกเริ่มต้น 50 ชิ้น จะได้กดขายได้เลย
      const cost = Math.floor(p.price * 0.7); // จำลองต้นทุนเป็น 70% ของราคาขาย

      await conn.query(
        'INSERT INTO products (barcode, name, category_id, price, stock, cost) VALUES (?, ?, ?, ?, ?, ?)',
        [p.code, p.name, categoryId, p.price, stock, cost]
      );
    }

    await conn.commit();
    res.json({ message: `เสกข้อมูลสำเร็จ! เพิ่มหมวดหมู่ ${categories.length} รายการ และสินค้า ${products.length} รายการ เรียบร้อยแล้ว 🎉` });

  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// =========================================
// API สร้างผู้จัดการคนแรก (เข้ารหัสผ่านเรียบร้อย!)
// =========================================
app.get('/api/create-admin', requireSetupKey, async (req, res) => {
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('1234', salt); // รหัสผ่านคือ 1234

    await pool.query("DELETE FROM users WHERE student_id = 'admin'");

    // ⭐️ เปลี่ยนจาก username เป็น student_id
    await pool.query(
      "INSERT INTO users (student_id, password, full_name, role, is_active) VALUES (?, ?, 'ผู้จัดการระบบ', 'ADMIN', 1)",
      ['admin', hashedPassword]
    );

    res.json({ message: "สร้างบัญชีสำเร็จ! 🎉 ให้เข้าสู่ระบบด้วย รหัสนักศึกษา: admin / Password: 1234" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// API เวทมนตร์ สร้างตารางฐานข้อมูลอัตโนมัติบน Cloud
// =========================================
app.get('/api/init-db', requireSetupKey, async (req, res) => {
  try {
    const queries = [
      `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, student_id VARCHAR(50) UNIQUE, password VARCHAR(255), full_name VARCHAR(100), role VARCHAR(20) DEFAULT 'CASHIER', is_active TINYINT(1) DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS categories (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100))`,
      `CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, barcode VARCHAR(50), name VARCHAR(255), category_id INT, price DECIMAL(10,2), cost DECIMAL(10,2) DEFAULT 0, stock INT DEFAULT 0, image_url TEXT, vendor_id INT NULL, gp_rate DECIMAL(5,2) DEFAULT 0, is_active TINYINT(1) DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS suppliers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), contact_info TEXT)`,
      `CREATE TABLE IF NOT EXISTS purchases (id INT AUTO_INCREMENT PRIMARY KEY, supplier_id INT, user_id INT, total_amount DECIMAL(10,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS purchase_items (id INT AUTO_INCREMENT PRIMARY KEY, purchase_id INT, product_id INT, quantity INT, unit_cost DECIMAL(10,2), subtotal DECIMAL(10,2))`,
      `CREATE TABLE IF NOT EXISTS shifts (id INT AUTO_INCREMENT PRIMARY KEY, cashier_id INT, opening_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, closing_time TIMESTAMP NULL, opening_cash DECIMAL(10,2), expected_cash DECIMAL(10,2), actual_cash DECIMAL(10,2), difference DECIMAL(10,2), status VARCHAR(20) DEFAULT 'OPEN')`,
      `CREATE TABLE IF NOT EXISTS members (id INT AUTO_INCREMENT PRIMARY KEY, student_id VARCHAR(50) UNIQUE, full_name VARCHAR(100), points INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS sales (id INT AUTO_INCREMENT PRIMARY KEY, cashier_id INT, member_id INT, total_amount DECIMAL(10,2), payment_method VARCHAR(50), amount_received DECIMAL(10,2), change_amount DECIMAL(10,2), status VARCHAR(50) DEFAULT 'COMPLETED', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS sale_items (id INT AUTO_INCREMENT PRIMARY KEY, sale_id INT, product_id INT, quantity INT, price DECIMAL(10,2), subtotal DECIMAL(10,2))`,
      `CREATE TABLE IF NOT EXISTS settings (id INT AUTO_INCREMENT PRIMARY KEY, store_name VARCHAR(255) DEFAULT 'ร้านค้าสหกรณ์', tax_id VARCHAR(50), address TEXT, receipt_footer TEXT)`,
      
      // ⭐️ 3 ตารางใหม่สำหรับระบบ Pre-order
      `CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, total_amount DECIMAL(10,2), payment_method VARCHAR(50), slip_image TEXT NULL, earn_points INT DEFAULT 0, status VARCHAR(50) DEFAULT 'PENDING_VERIFY', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS order_items (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT, product_id INT, quantity INT, price DECIMAL(10,2), subtotal DECIMAL(10,2))`,
      `CREATE TABLE IF NOT EXISTS notifications (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, message TEXT, is_read TINYINT(1) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    ];

    for (let q of queries) {
      await pool.query(q);
    }

    // ตั้งค่าชื่อร้านเริ่มต้น
    await pool.query("INSERT IGNORE INTO settings (id, store_name) VALUES (1, 'ร้านค้าสหกรณ์')");

    res.json({ message: "สร้างตารางสำเร็จครบ 11 ตาราง! 🎉 โครงสร้างฐานข้อมูลพร้อมลุยแล้ว" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// BACKUP & SCHEDULED JOBS (หมวด 13 + auto-checkout)
// =========================================
// ⭐️ Backup ผ่าน mysqldump ใน container docker (ตาม docker-compose.yml เดิม: container=pos_mysql, db=pos_coop)
// เก็บไฟล์ .sql ไว้ในโฟลเดอร์ backups/ (ควร sync ออกนอกเครื่องอีกทีตอน deploy จริง)
const BACKUP_DIR = path.join(__dirname, 'backups');
const DB_CONTAINER = process.env.DB_CONTAINER || 'pos_mysql';
const DB_NAME = process.env.DB_NAME || 'pos_coop';
const DB_ROOT_PW = process.env.DB_ROOT_PASSWORD || 'rootpassword';
const BACKUP_KEEP_DAYS = 7; // เก็บ backup ย้อนหลังกี่วัน

function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(BACKUP_DIR, `backup_${stamp}.sql`);

  // docker exec pos_mysql mysqldump -u root -p<pw> pos_coop > backups/backup_xxx.sql
  const cmd = `docker exec ${DB_CONTAINER} mysqldump -u root -p${DB_ROOT_PW} --default-character-set=utf8mb4 ${DB_NAME}`;
  exec(cmd, { maxBuffer: 1024 * 1024 * 200 }, (err, stdout, stderr) => {
    if (err) {
      console.error('❌ Backup ล้มเหลว:', stderr || err.message);
      return;
    }
    fs.writeFileSync(outFile, stdout);
    console.log(`💾 Backup สำเร็จ: ${outFile}`);

    // ลบไฟล์ backup เก่าเกิน BACKUP_KEEP_DAYS วัน
    try {
      const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400000;
      for (const f of fs.readdirSync(BACKUP_DIR)) {
        if (!f.startsWith('backup_')) continue;
        const fp = path.join(BACKUP_DIR, f);
        if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
      }
    } catch (cleanErr) { console.error('⚠️ ลบ backup เก่าไม่สำเร็จ:', cleanErr.message); }
  });
}

/**
 * @swagger
 * /api/backup/run:
 *   post:
 *     summary: สั่ง backup ฐานข้อมูลทันที (ADMIN) — สร้างไฟล์ .sql ในโฟลเดอร์ backups/
 *     tags: [Backup]
 */
app.post('/api/backup/run', requireRole('ADMIN'), (req, res) => {
  runBackup();
  res.json({ message: "เริ่ม backup ฐานข้อมูลแล้ว (ตรวจไฟล์ในโฟลเดอร์ backups/)" });
});

const PORT = 3000;
// เปลี่ยนจาก app.listen เป็น server.listen
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📚 Swagger Docs: http://localhost:${PORT}/api/docs`);
  console.log(`⚡ WebSocket Server is ready!`);

  // ⭐️ Cron: backup ทุกวันตี 2 (เวลาไทย ถ้าตั้ง TZ=Asia/Bangkok ตอนรัน)
  cron.schedule('0 2 * * *', () => {
    console.log('⏰ เริ่ม backup ตามตารางเวลา (ตี 2)...');
    runBackup();
  });

  // ⭐️ Cron: ตัดออกงาน/ปิดกะอัตโนมัติทุกเที่ยงคืน (ข้อ 12 — ลืมออกงาน/ลืมปิดกะข้ามวัน)
  cron.schedule('5 0 * * *', async () => {
    try {
      const result = await runAutoCheckoutStale(io);
      console.log(`⏰ ตัดออกงานอัตโนมัติ: attendance ${result.attendance_closed}, shifts ${result.shifts_closed}`);
    } catch (e) { console.error('❌ auto-checkout cron ล้มเหลว:', e.message); }
  });

  console.log('🕐 ตั้ง cron: backup (ตี 2), auto-checkout (เที่ยงคืน) เรียบร้อย');
});