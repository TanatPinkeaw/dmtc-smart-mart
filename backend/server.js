const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { swaggerUi, specs } = require('./swagger');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = 'pos_coop_super_secret_key';

const app = express();
app.use(cors());
app.use(express.json());

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
  const { barcode, name, category_id, price, stock = 0, image_url } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO products (barcode, name, category_id, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?)',
      [barcode || null, name, category_id || null, price, stock, image_url || null]
    );
    res.status(201).json({ id: result.insertId, message: "เพิ่มสินค้าสำเร็จ" });
  } catch (error) {
    // ดัก Error กรณีบาร์โค้ดซ้ำ
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
app.put('/api/products/:id', async (req, res) => {
  const { barcode, name, category_id, price, image_url } = req.body;
  try {
    await pool.query(
      'UPDATE products SET barcode=?, name=?, category_id=?, price=?, image_url=? WHERE id=?',
      [barcode || null, name, category_id || null, price, image_url || null, req.params.id]
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
 *   post:
 *     summary: ล็อกอินเข้าสู่ระบบ (รับ Token)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: ล็อกอินสำเร็จ ได้รับ Token
 */
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [users] = await pool.query('SELECT * FROM users WHERE username = ? AND is_active = TRUE', [username]);
    if (users.length === 0) return res.status(401).json({ error: "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง" });

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง" });

    // สร้าง Token
    const token = jwt.sign(
      { id: user.id, role: user.role, full_name: user.full_name }, 
      JWT_SECRET, 
      { expiresIn: '12h' } // Token หมดอายุใน 12 ชั่วโมง (พอดีจบกะ)
    );

    res.json({ message: "ล็อกอินสำเร็จ", token, user: { id: user.id, full_name: user.full_name, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: ดึงรายชื่อพนักงานทั้งหมด
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: สำเร็จ
 */
app.get('/api/users', async (req, res) => {
  try {
    // ไม่ดึง password ออกมาแสดงเพื่อความปลอดภัย
    const [rows] = await pool.query('SELECT id, username, full_name, role, is_active FROM users');
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
  const { cashier_id, opening_cash } = req.body;
  if (!cashier_id || opening_cash === undefined) {
    return res.status(400).json({ error: "กรุณาระบุรหัสแคชเชียร์และเงินตั้งต้น" });
  }

  try {
    // เช็คว่าแคชเชียร์คนนี้มีกะที่เปิดค้างไว้หรือไม่
    const [existing] = await pool.query(
      'SELECT id FROM shifts WHERE cashier_id = ? AND status = "OPEN"',
      [cashier_id]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: "แคชเชียร์คนนี้มีกะที่เปิดอยู่แล้ว ต้องปิดกะเดิมก่อน" });
    }

    const [result] = await pool.query(
      'INSERT INTO shifts (cashier_id, opening_cash) VALUES (?, ?)',
      [cashier_id, opening_cash]
    );
    res.status(201).json({ shift_id: result.insertId, message: "เปิดกะการขายสำเร็จ" });
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
    const [rows] = await pool.query(
      'SELECT * FROM shifts WHERE cashier_id = ? AND status = "OPEN"', 
      [cashier_id]
    );
    // ⭐️ ไฮไลท์: เปลี่ยนจากการพ่น Error 404 เป็นการส่งค่า null กลับไปเฉยๆ
    // วิธีนี้ทำให้หน้าเว็บรู้ว่าไม่มีกะ โดยที่ไม่ต้องโวยวายขึ้นตัวแดงใน Console ครับ!
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
  const { cashier_id, actual_cash, note } = req.body;

  try {
    // 1. หากะที่กำลังเปิดอยู่
    const [shifts] = await pool.query(
      'SELECT id, opening_cash, opened_at FROM shifts WHERE cashier_id = ? AND status = "OPEN"',
      [cashier_id]
    );

    if (shifts.length === 0) {
      return res.status(404).json({ error: "ไม่พบกะที่กำลังเปิดอยู่สำหรับแคชเชียร์คนนี้" });
    }

    const currentShift = shifts[0];

    // 2. คำนวณหายอดขาย "เงินสด" ทั้งหมดที่เกิดขึ้นในกะนี้
    const [sales] = await pool.query(
      `SELECT SUM(total_amount) as total_cash_sales 
       FROM sales 
       WHERE cashier_id = ? AND payment_method = 'CASH' AND created_at >= ?`,
      [cashier_id, currentShift.opened_at]
    );

    const totalCashSales = sales[0].total_cash_sales || 0;
    
    // 3. คำนวณยอดเงิน (Expected = เงินตั้งต้น + ยอดขายเงินสด)
    const expected_cash = Number(currentShift.opening_cash) + Number(totalCashSales);
    const difference = Number(actual_cash) - expected_cash;

    // 4. บันทึกการปิดกะ
    await pool.query(
      `UPDATE shifts 
       SET expected_cash = ?, actual_cash = ?, difference = ?, status = 'CLOSED', closed_at = CURRENT_TIMESTAMP, note = ?
       WHERE id = ?`,
      [expected_cash, actual_cash, difference, note || null, currentShift.id]
    );

    res.json({
      message: "ปิดกะสำเร็จ",
      summary: {
        opening_cash: currentShift.opening_cash,
        cash_sales: totalCashSales,
        expected_cash: expected_cash,
        actual_cash: actual_cash,
        difference: difference,
        note: note
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================
// 5. SALES & POS (ระบบการขายหน้าเคาน์เตอร์)
// =========================================

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
  const { cashier_id, payment_method, amount_received, items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: "ตะกร้าสินค้าว่างเปล่า" });

  const conn = await pool.getConnection();

  try {
    // เริ่มระบบ Transaction (ถ้าพังกลางคัน ข้อมูลจะไม่บันทึกมั่ว)
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

      processedItems.push({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: product.price, // ดึงราคาจากฐานข้อมูลโดยตรง ป้องกันหน้าเว็บส่งราคาปลอม
        subtotal: subtotal
      });
    }

    // 2. ตรวจสอบเงินทอน
    if (amount_received < totalAmount) throw new Error("รับเงินลูกค้ามาไม่พอ!");
    const changeAmount = amount_received - totalAmount;

    // 3. สร้างหัวบิลใบเสร็จ (Sales)
    const [saleResult] = await conn.query(
      'INSERT INTO sales (cashier_id, total_amount, payment_method, amount_received, change_amount) VALUES (?, ?, ?, ?, ?)',
      [cashier_id, totalAmount, payment_method, amount_received, changeAmount]
    );
    const saleId = saleResult.insertId;

    // 4. บันทึกรายละเอียดสินค้าลงบิล (Sale Items)
    for (let item of processedItems) {
      await conn.query(
        // ⭐️ แก้กลับมาใช้คำว่า price ให้ตรงกับ db.js
        'INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)',
        [saleId, item.product_id, item.quantity, item.unit_price, item.subtotal]
      );

      // 5. ตัดสต๊อกสินค้าทันที
      await conn.query(
        'UPDATE products SET stock = stock - ? WHERE id = ?', 
        [item.quantity, item.product_id]
      );
    }

    // ยืนยันการบันทึกข้อมูลทั้งหมด
    await conn.commit();
    
    res.json({
      message: "ทำรายการสำเร็จ",
      receipt: {
        sale_id: saleId,
        total_amount: totalAmount,
        change_amount: changeAmount
      }
    });

  } catch (error) {
    await conn.rollback(); // ถ้าระบบพัง ให้ยกเลิกสิ่งที่ทำมาทั้งหมด ป้องกันเงินหาย!
    res.status(500).json({ error: error.message });
  } finally {
    conn.release(); // คืนการเชื่อมต่อให้ฐานข้อมูล
  }
});

// =========================================
// 5.1 SALES HISTORY, HOLD & VOID (ประวัติ, พักบิล และ ยกเลิกบิล)
// =========================================

// =========================================
// 5.1 SALES HISTORY & VOID (ประวัติการขาย, ยกเลิกบิล)
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
    
    // ⭐️ แก้ไข: ลบ is_voided ออก ใช้แค่ status อย่างเดียว ป้องกัน Error หาคอลัมน์ไม่เจอ
    let query = `
      SELECT s.id, s.created_at, s.total_amount, s.payment_method, s.status, u.full_name as cashier_name 
      FROM sales s
      JOIN users u ON s.cashier_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (start_date && end_date) {
      query += ` AND DATE(s.created_at) BETWEEN ? AND ?`;
      params.push(start_date, end_date);
    } else {
      query += ` AND DATE(s.created_at) = CURDATE()`;
    }

    query += ` ORDER BY s.created_at DESC`;
    
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
    const [rows] = await pool.query(`
      SELECT si.quantity, si.price, si.subtotal, p.name as product_name
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `, [req.params.id]);
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

    // คืนแต้ม
    if (sale.member_id) {
      const points = Math.floor(sale.total_amount / 10);
      await conn.query('UPDATE members SET points = GREATEST(0, points - ?) WHERE student_id = ?', [points, sale.member_id]);
    }

    await conn.commit();
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
    // ดึงยอดขายของ "วันนี้" เท่านั้น และเอาเฉพาะบิลที่สถานะ COMPLETED
    const [rows] = await pool.query(`
      SELECT 
        COUNT(id) as total_bills,
        COALESCE(SUM(total_amount), 0) as total_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END), 0) as cash_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'QR' THEN total_amount ELSE 0 END), 0) as qr_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'MIXED' THEN total_amount ELSE 0 END), 0) as mixed_sales
      FROM sales 
      WHERE DATE(created_at) = CURDATE() AND status = 'COMPLETED'
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
    // จอยตาราง sale_items, sales, และ products เพื่อหาสินค้าที่ขายได้จำนวนเยอะที่สุด
    const [rows] = await pool.query(`
      SELECT 
        p.id as product_id, 
        p.name, 
        SUM(si.quantity) as total_quantity, 
        SUM(si.subtotal) as total_revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE s.status = 'COMPLETED'
      GROUP BY p.id, p.name
      ORDER BY total_quantity DESC
      LIMIT 10
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
  const { name, discount_type, discount_value, start_date, end_date } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO promotions (name, discount_type, discount_value, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
      [name, discount_type, discount_value, start_date || null, end_date || null]
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
  const { promotion_id, grand_total } = req.body;
  try {
    const [promos] = await pool.query('SELECT * FROM promotions WHERE id = ? AND is_active = TRUE', [promotion_id]);
    if (promos.length === 0) return res.status(404).json({ error: "ไม่พบโปรโมชั่น หรือโปรโมชั่นหมดอายุแล้ว" });

    const promo = promos[0];
    let discount_amount = 0;

    if (promo.discount_type === 'PERCENT') {
      discount_amount = (grand_total * Number(promo.discount_value)) / 100;
    } else if (promo.discount_type === 'FIXED') {
      discount_amount = Number(promo.discount_value);
    }

    // ป้องกันส่วนลดเกินราคาสินค้า
    discount_amount = Math.min(discount_amount, grand_total);
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

    // คำนวณยอดรวมบิลสั่งซื้อ
    for (const item of items) {
      const subtotal = item.quantity * Number(item.unit_cost);
      totalCost += subtotal;
      processedItems.push({ ...item, subtotal });
    }

    // 1. สร้างบิลรับของเข้า
    const [purchaseResult] = await conn.query(
      'INSERT INTO purchases (supplier_id, user_id, total_cost) VALUES (?, ?, ?)',
      [supplier_id || null, user_id, totalCost]
    );
    const purchaseId = purchaseResult.insertId;

    // 2. บันทึกรายการของเข้า และ อัปเดตสต๊อก+ต้นทุนในตาราง products
    for (const item of processedItems) {
      // บันทึกรายการ
      await conn.query(
        'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)',
        [purchaseId, item.product_id, item.quantity, item.unit_cost, item.subtotal]
      );

      // ⭐️ อัปเดตสต๊อกให้บวกเพิ่ม และอัปเดตต้นทุน (cost) ให้เป็นล็อตล่าสุด
      await conn.query(
        'UPDATE products SET stock = stock + ?, cost = ? WHERE id = ?',
        [item.quantity, item.unit_cost, item.product_id]
      );
    }

    await conn.commit();
    res.status(201).json({ message: "บันทึกการรับสินค้าเข้าคลังสำเร็จ", purchase_id: purchaseId });
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
app.get('/api/clear-data', async (req, res) => {
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
app.get('/api/seed-data', async (req, res) => {
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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📚 Swagger Docs: http://localhost:${PORT}/api/docs`);
});





