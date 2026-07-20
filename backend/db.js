const mysql = require('mysql2/promise');
require('dotenv').config(); // ⭐️ 1. เพิ่มบรรทัดนี้ เพื่อให้ db.js อ่านไฟล์ .env ได้

// ⭐️ Task 6 — เอา fallback รหัสผ่านฮาร์ดโค้ด ('rootpassword') ออก
// เดิมถ้า DB_PASSWORD หายจาก .env ระบบจะบูทต่อแบบเงียบๆ ด้วยรหัสผ่านอ่อนแอ — อันตรายเวลา deploy จริง
// ตอนนี้ต้องมี DB_HOST/DB_USER/DB_PASSWORD/DB_NAME ใน .env จริงเท่านั้น ไม่มี fallback ให้ค่าอ่อนแอ
const REQUIRED_DB_ENV = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingDbEnv = REQUIRED_DB_ENV.filter(key => !process.env[key]);
if (missingDbEnv.length > 0) {
  console.error(`❌ db.js: ไม่พบ environment variable ที่จำเป็น: ${missingDbEnv.join(', ')}`);
  process.exit(1);
}

// ⭐️ SSL สำหรับ MySQL บนคลาวด์ (เช่น Aiven) — เปิดเมื่อ DB_SSL=true
// - ถ้ามี DB_SSL_CA (เนื้อ CA cert แบบ PEM หรือ base64) จะ verify แบบเต็ม ปลอดภัยสุด
// - ถ้าไม่มี CA จะเข้ารหัสแต่ไม่ verify (พอสำหรับ demo) ; local dev ไม่ต้องตั้ง DB_SSL เลย
let sslOption;
if (process.env.DB_SSL === 'true') {
  if (process.env.DB_SSL_CA) {
    const ca = process.env.DB_SSL_CA.includes('BEGIN CERTIFICATE')
      ? process.env.DB_SSL_CA
      : Buffer.from(process.env.DB_SSL_CA, 'base64').toString('utf8');
    sslOption = { ca, rejectUnauthorized: true };
  } else {
    sslOption = { rejectUnauthorized: false };
  }
}

// ⭐️ 2. เปลี่ยนบล็อก const pool เดิม ให้เป็นแบบนี้
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+07:00', // ⭐️ บังคับ timezone เป็นไทย (Bangkok) กัน NOW()/CURDATE() เพี้ยนเป็น UTC
  ...(sslOption ? { ssl: sslOption } : {})
});

// ⭐️ ทุกครั้งที่ pool เปิด connection ใหม่ ตั้ง session time_zone เป็นไทย
// (จำเป็นเพราะ MySQL server ใน docker default เป็น UTC — NOW()/CURDATE() จะเพี้ยนถ้าไม่ตั้ง)
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+07:00'");
});
// const pool = mysql.createPool({
//   host: process.env.DB_HOST || 'localhost',
//   user: process.env.DB_USER || 'root',
//   password: process.env.DB_PASSWORD || '',
//   database: process.env.DB_NAME || 'pos_coop',
//   port: process.env.DB_PORT || 3306,
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0
// });

// const pool = mysql.createPool({
//   host: 'localhost',
//   user: 'root',
//   password: 'rootpassword', // เปลี่ยนตามที่นายตั้งใน docker-compose
//   database: 'pos_coop',
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
//   charset: 'utf8mb4'
// });

const initDB = async () => {
  try {
    const connection = await pool.getConnection();
    await connection.query("SET time_zone = '+07:00'"); // ⭐️ ตั้ง tz เป็น Bangkok ตั้งแต่ต้น
    // ==========================================
    // MODULE 1, 3, 6, 9, 10: Master Data (ข้อมูลหลัก)
    // ==========================================

    // 1. ตารางผู้ใช้งานแบบ Single Identity (พนักงาน + นักศึกษา ในตารางเดียว)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id VARCHAR(50) UNIQUE NOT NULL, -- ใช้เป็น Username สำหรับล็อกอิน
        password VARCHAR(255) NOT NULL,         -- ค่าเริ่มต้นคือเลขบัตร ปชช.
        full_name VARCHAR(100) NOT NULL,
        phone_number VARCHAR(15) UNIQUE,        -- เบอร์โทร (เอาไว้ให้แคชเชียร์ค้นหาตอนคิดเงิน)
        role ENUM('MEMBER', 'CASHIER', 'ADMIN') DEFAULT 'MEMBER', -- ใครสมัครใหม่จะได้เป็น MEMBER ก่อน
        points INT DEFAULT 0,                   -- เก็บแต้มสะสม
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    

    // 3. ตารางหมวดหมู่สินค้า (Categories)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. [NEW] ตารางซัพพลายเออร์ (Suppliers) - สำหรับรับของเข้า
    await connection.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        contact_info VARCHAR(255),
        address TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. [NEW] ตารางโปรโมชั่น (Promotions)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS promotions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        discount_type ENUM('PERCENT', 'FIXED', 'BOGO') NOT NULL, -- ลดเปอร์เซ็นต์, ลดเงินสด, ซื้อ1แถม1
        discount_value DECIMAL(10, 2) NOT NULL,
        start_date DATE,
        end_date DATE,
        is_active BOOLEAN DEFAULT TRUE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. [NEW] ตารางตั้งค่าร้านค้า (Settings)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT PRIMARY KEY DEFAULT 1, 
        store_name VARCHAR(255) NOT NULL DEFAULT 'สหกรณ์วิทยาลัย',
        tax_id VARCHAR(50),
        address TEXT,
        receipt_footer TEXT -- เอา DEFAULT ออกจากตรงนี้
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ==========================================
    // MODULE 4: Inventory (ระบบคลังสินค้า)
    // ==========================================

    // 7. ตารางสินค้า (Products) - อัปเดตให้รองรับระบบฝากขาย
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        barcode VARCHAR(50) UNIQUE,
        name VARCHAR(255) NOT NULL,
        category_id INT,
        vendor_id INT DEFAULT NULL,         -- ⭐️ ใครเป็นเจ้าของผลงาน (ผูกกับ users.id)
        gp_rate DECIMAL(5, 2) DEFAULT 0.00, -- ⭐️ เปอร์เซ็นต์หัก GP (เช่น 10.00)
        cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
        price DECIMAL(10, 2) NOT NULL,
        stock INT NOT NULL DEFAULT 0,
        image_url VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
        FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    // ==========================================
    // MODULE 2, 5: Sales & Transactions (ระบบขายและกะ)
    // ==========================================

    // 8. ตารางกะการขาย (Shifts)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS shifts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cashier_id INT NOT NULL,
        opening_cash DECIMAL(10, 2) NOT NULL,
        expected_cash DECIMAL(10, 2) DEFAULT 0,
        actual_cash DECIMAL(10, 2) DEFAULT 0,
        difference DECIMAL(10, 2) DEFAULT 0,
        status ENUM('OPEN', 'CLOSED') DEFAULT 'OPEN',
        opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP NULL,
        note TEXT,
        FOREIGN KEY (cashier_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 9. ตารางบิลขาย (Sales) - ผูกโปรโมชั่น และผูกลูกค้าเข้ากับตาราง users
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cashier_id INT,
        member_id INT, -- ⭐️ เปลี่ยนจาก VARCHAR เป็น INT เพื่อชี้ไปหา id ของตาราง users
        promotion_id INT, 
        payment_method ENUM('CASH', 'QR', 'MIXED') DEFAULT 'CASH',
        total_amount DECIMAL(10, 2) NOT NULL, 
        discount_amount DECIMAL(10, 2) DEFAULT 0, 
        amount_received DECIMAL(10, 2) NOT NULL,
        change_amount DECIMAL(10, 2) NOT NULL,
        status ENUM('COMPLETED', 'VOIDED', 'HOLD') DEFAULT 'COMPLETED',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cashier_id) REFERENCES users(id),
        FOREIGN KEY (member_id) REFERENCES users(id), -- ⭐️ ชี้ไปที่ตาราง users แทน
        FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 10. ตารางรายการสินค้าในบิลขาย (Sale Items)
    // ตารางรายละเอียดบิลขาย (Sale Items)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sale_id INT NOT NULL,
        product_id INT NOT NULL,
        quantity INT NOT NULL,
        price DECIMAL(10,2) NOT NULL, /* ⭐️ ต้องมีบรรทัดนี้! เพื่อเก็บราคาต่อชิ้น */
        subtotal DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ==========================================
    // MODULE 9: Purchasing (รับของเข้าคลัง)
    // ==========================================

    // 11. ตารางใบรับสินค้า (Purchases)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id INT AUTO_INCREMENT PRIMARY KEY,
        supplier_id INT,
        user_id INT, -- พนักงานที่รับของ
        total_cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
        status ENUM('COMPLETED', 'CANCELLED') DEFAULT 'COMPLETED',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 12. ตารางรายการในใบรับสินค้า (Purchase Items)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchase_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchase_id INT NOT NULL,
        product_id INT NOT NULL,
        quantity INT NOT NULL,
        unit_cost DECIMAL(10, 2) NOT NULL, -- ต้นทุนต่อชิ้นล็อตนี้
        subtotal DECIMAL(10, 2) NOT NULL,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 13. ใส่ข้อมูลตั้งค่าร้านค้าเริ่มต้น (Initial Data)
    await connection.query(`
      INSERT IGNORE INTO settings (id, store_name, tax_id, address, receipt_footer) 
      VALUES (1, 'สหกรณ์วิทยาลัย', '1234567890123', '123 ถนนการศึกษา', 'ขอบคุณที่อุดหนุนสหกรณ์ของเรา')
    `);

    // ==========================================
    // MODULE: Pre-order (สั่งจองล่วงหน้า) — ⭐️ ย้ายมาไว้ที่นี่เพื่อให้สร้างตารางอัตโนมัติทุกครั้งที่ server บูท
    // เดิม 3 ตารางนี้อยู่แค่ใน /api/init-db (endpoint ที่ต้องเรียกเองครั้งเดียว) ทำให้ DB ที่ไม่เคยเรียก endpoint นี้ไม่มีตาราง
    // ==========================================

    // 14. ตารางออเดอร์จอง (Orders)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        total_amount DECIMAL(10, 2),
        payment_method VARCHAR(50),
        slip_image TEXT NULL,
        earn_points INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'PENDING_VERIFY',
        reject_reason TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 15. ตารางรายการในออเดอร์จอง (Order Items)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        product_id INT NOT NULL,
        quantity INT NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        subtotal DECIMAL(10, 2) NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ⭐️ Task 13 — ตาราง password reset tokens
    await connection.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        reset_token VARCHAR(255) UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        INDEX idx_token (reset_token),
        INDEX idx_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 16. ตารางแจ้งเตือน (Notifications)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        message TEXT,
        is_read TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 16.1 ตารางบันทึกการตรวจสอบย้อนหลัง (Audit Logs) — บันทึกการกระทำสำคัญที่กระทบเงิน/สิทธิ์
    await connection.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        user_id INT NULL,
        resource_type VARCHAR(50) NULL,
        resource_id INT NULL,
        details TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ==========================================
    // MODULE: Schedules / Attendance (หมวด 7 — ตารางเวลา + เช็คมาสาย)
    // ==========================================

    // 17. ตารางตารางเวลาทำงานล่วงหน้า (Schedules) — ADMIN ตั้งให้ CASHIER
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schedules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cashier_id INT NOT NULL,
        work_date DATE NOT NULL,
        expected_start TIME NOT NULL,
        expected_end TIME NOT NULL,
        FOREIGN KEY (cashier_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 18. ตารางบันทึกเข้า-ออกงาน (Attendance) — ปัจจุบันใช้กับ ADMIN เท่านั้น (CASHIER ใช้ระบบกะแทน)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        check_in TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        check_out TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 19. ตารางวันหยุดพิเศษ (Holidays) — ADMIN ตั้งเอง วันในตารางนี้จะไม่ถูกนับว่ามาสาย/ขาดงาน
    await connection.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id INT AUTO_INCREMENT PRIMARY KEY,
        holiday_date DATE NOT NULL UNIQUE,
        note VARCHAR(255)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ⭐️ Defensive patch: เติมคอลัมน์ points_redeemed / points_discount ให้ตาราง sales
    // (สำหรับฟีเจอร์แลกแต้มเป็นส่วนลด) ถ้า DB เก่ายังไม่มี
    try {
      await connection.query(`ALTER TABLE sales ADD COLUMN points_redeemed INT DEFAULT 0`);
      console.log("🔧 เพิ่มคอลัมน์ sales.points_redeemed ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE sales (points_redeemed) ล้มเหลว:", alterErr.message);
    }
    try {
      await connection.query(`ALTER TABLE sales ADD COLUMN points_discount DECIMAL(10,2) DEFAULT 0`);
      console.log("🔧 เพิ่มคอลัมน์ sales.points_discount ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE sales (points_discount) ล้มเหลว:", alterErr.message);
    }
    // ⭐️ Defensive patch: shift_id — ผูกบิลเข้ากะที่เปิดอยู่ตอนขาย (สำหรับสรุปยอดต่อพนักงานต่อกะ แม่นกว่าเทียบช่วงเวลา)
    try {
      await connection.query(`ALTER TABLE sales ADD COLUMN shift_id INT NULL`);
      console.log("🔧 เพิ่มคอลัมน์ sales.shift_id ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE sales (shift_id) ล้มเหลว:", alterErr.message);
    }
    // ⭐️ Defensive patch: เก็บรายละเอียดนับเงินแยกแบงก์/เหรียญ (หมวด D) — เก็บเป็น JSON ไม่ต้องเปลี่ยน schema หลัก
    try {
      await connection.query(`ALTER TABLE shifts ADD COLUMN opening_cash_breakdown JSON NULL`);
      console.log("🔧 เพิ่มคอลัมน์ shifts.opening_cash_breakdown ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE shifts (opening_cash_breakdown) ล้มเหลว:", alterErr.message);
    }
    try {
      await connection.query(`ALTER TABLE shifts ADD COLUMN closing_cash_breakdown JSON NULL`);
      console.log("🔧 เพิ่มคอลัมน์ shifts.closing_cash_breakdown ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE shifts (closing_cash_breakdown) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Defensive patch: ถ้า DB เก่าเคยสร้างตาราง orders มาแล้วโดยไม่มีคอลัมน์ reject_reason
    // (เช่นสร้างผ่าน /api/init-db เวอร์ชันเก่า) ให้เติมคอลัมน์ให้อัตโนมัติแบบไม่ทำให้ server พังถ้ามีอยู่แล้ว
    try {
      await connection.query(`ALTER TABLE orders ADD COLUMN reject_reason TEXT NULL`);
      console.log("🔧 เพิ่มคอลัมน์ orders.reject_reason ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') {
        console.error("⚠️ ALTER TABLE orders ล้มเหลว:", alterErr.message);
      }
    }

    // ⭐️ Defensive patch: เติมคอลัมน์ points_redeemed / points_discount ให้ตาราง orders
    // (สำหรับฟีเจอร์แลกแต้มเป็นส่วนลดตอนสั่งจอง Pre-order — pattern เดียวกับ sales.points_redeemed/points_discount)
    try {
      await connection.query(`ALTER TABLE orders ADD COLUMN points_redeemed INT DEFAULT 0`);
      console.log("🔧 เพิ่มคอลัมน์ orders.points_redeemed ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE orders (points_redeemed) ล้มเหลว:", alterErr.message);
    }
    try {
      await connection.query(`ALTER TABLE orders ADD COLUMN points_discount DECIMAL(10,2) DEFAULT 0`);
      console.log("🔧 เพิ่มคอลัมน์ orders.points_discount ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE orders (points_discount) ล้มเหลว:", alterErr.message);
    }
    // ⭐️ Defensive patch: completed_at — เวลาที่ออเดอร์ COMPLETED จริง (ลูกค้ามารับของ)
    // ใช้แยกจาก created_at (เวลาจอง) เพื่อนับยอดขายเข้าวันที่มารับจริง ไม่ใช่วันที่จอง
    try {
      await connection.query(`ALTER TABLE orders ADD COLUMN completed_at TIMESTAMP NULL`);
      console.log("🔧 เพิ่มคอลัมน์ orders.completed_at ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE orders (completed_at) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Defensive patch: โปรโมชั่น BOGO/ซื้อครบแถม + จำกัดสิทธิ์การใช้
    const promoColumns = [
      ['buy_product_id', 'INT NULL'],
      ['buy_qty', 'INT NULL'],
      ['free_product_id', 'INT NULL'],
      ['free_qty', 'INT NULL'],
      ['usage_limit', 'INT NULL'],
      ['usage_count', 'INT NOT NULL DEFAULT 0'],
      ['usage_limit_per_user', 'INT NULL'],
    ];
    for (const [col, def] of promoColumns) {
      try {
        await connection.query(`ALTER TABLE promotions ADD COLUMN ${col} ${def}`);
        console.log(`🔧 เพิ่มคอลัมน์ promotions.${col} ที่ขาดไปให้แล้ว`);
      } catch (alterErr) {
        if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(`⚠️ ALTER TABLE promotions (${col}) ล้มเหลว:`, alterErr.message);
      }
    }

    // ⭐️ ตารางบันทึกการใช้สิทธิ์โปรโมชั่นต่อคน (สำหรับเช็ค usage_limit_per_user)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS promotion_usages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        promotion_id INT NOT NULL,
        member_id INT NOT NULL,
        used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (promotion_id) REFERENCES promotions(id),
        FOREIGN KEY (member_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ⭐️ Defensive patch: ถ่ายรูปยืนยันสถานที่ตอนเข้า/ออกงาน (ADMIN attendance)
    try {
      await connection.query(`ALTER TABLE attendance ADD COLUMN check_in_photo VARCHAR(255) NULL`);
      console.log("🔧 เพิ่มคอลัมน์ attendance.check_in_photo ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE attendance (check_in_photo) ล้มเหลว:", alterErr.message);
    }
    try {
      await connection.query(`ALTER TABLE attendance ADD COLUMN check_out_photo VARCHAR(255) NULL`);
      console.log("🔧 เพิ่มคอลัมน์ attendance.check_out_photo ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE attendance (check_out_photo) ล้มเหลว:", alterErr.message);
    }
    // ⭐️ note ไว้เผื่อ ADMIN แก้ไขย้อนหลัง (ลืม check-out) หรือระบบ auto-checkout ตัดให้
    try {
      await connection.query(`ALTER TABLE attendance ADD COLUMN note VARCHAR(255) NULL`);
      console.log("🔧 เพิ่มคอลัมน์ attendance.note ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE attendance (note) ล้มเหลว:", alterErr.message);
    }
    // ⭐️ note ปิดกะอัตโนมัติ (ลืมปิดกะข้ามวัน) ให้ ADMIN เห็นว่ากะไหนถูกระบบบังคับปิดให้
    try {
      await connection.query(`ALTER TABLE shifts ADD COLUMN auto_closed BOOLEAN DEFAULT FALSE`);
      console.log("🔧 เพิ่มคอลัมน์ shifts.auto_closed ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE shifts (auto_closed) ล้มเหลว:", alterErr.message);
    }
    // ⭐️ รูปยืนยันสถานที่ตอนเปิด/ปิดกะ (CASHIER แนบรูปว่าอยู่ที่สหกรณ์จริง เหมือน attendance ของ ADMIN)
    try {
      await connection.query(`ALTER TABLE shifts ADD COLUMN open_photo VARCHAR(255) NULL`);
      console.log("🔧 เพิ่มคอลัมน์ shifts.open_photo ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE shifts (open_photo) ล้มเหลว:", alterErr.message);
    }
    try {
      await connection.query(`ALTER TABLE shifts ADD COLUMN close_photo VARCHAR(255) NULL`);
      console.log("🔧 เพิ่มคอลัมน์ shifts.close_photo ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE shifts (close_photo) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Task 3 — Shift discrepancy workflow: ส่วนต่างเงินสดเกินเกณฑ์ต้องรอ ADMIN อนุมัติก่อนปิดกะจริง
    for (const [col, def] of [
      ['discrepancy_amount', 'DECIMAL(10,2) NULL'],
      ['discrepancy_flag', 'BOOLEAN DEFAULT 0'],
      ['admin_approval_required', 'BOOLEAN DEFAULT 0'],
      ['admin_approved_by', 'INT NULL'],
      ['admin_approval_notes', 'TEXT NULL'],
    ]) {
      try {
        await connection.query(`ALTER TABLE shifts ADD COLUMN ${col} ${def}`);
        console.log(`🔧 เพิ่มคอลัมน์ shifts.${col} ที่ขาดไปให้แล้ว`);
      } catch (alterErr) {
        if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(`⚠️ ALTER TABLE shifts (${col}) ล้มเหลว:`, alterErr.message);
      }
    }
    // ⭐️ Sprint 2 — D1: status ENUM ประกอบด้วย OPEN/PENDING_CLOSE/CLOSED/REJECTED
    // OPEN → PENDING_CLOSE (cashier initiates close) → CLOSED (manager approves) or REJECTED → OPEN (manager rejects)
    try {
      await connection.query(`ALTER TABLE shifts MODIFY COLUMN status ENUM('OPEN','PENDING_CLOSE','CLOSED','REJECTED') DEFAULT 'OPEN'`);
    } catch (alterErr) {
      console.error("⚠️ ALTER TABLE shifts (status enum D1) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Sprint 1 — D3: หมวดหมู่สาเหตุส่วนต่างเงินสด (แยกจาก note ที่เป็น freeform text) — ใช้ track root
    // cause สะสมได้ (เช่น "ทอนผิดบ่อยแค่ไหน" vs "รับเงินปลอมบ่อยแค่ไหน") ไม่ได้แทนที่ note เดิม ใช้คู่กัน
    try {
      await connection.query(
        `ALTER TABLE shifts ADD COLUMN discrepancy_category ENUM(
          'SHORT_CHANGE', 'FAKE_BILL', 'FORGOT_RECEIPT', 'CUSTOMER_RETURN', 'OTHER'
        ) DEFAULT NULL`
      );
      console.log("🔧 เพิ่มคอลัมน์ shifts.discrepancy_category ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE shifts (discrepancy_category) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Sprint 2 — D1: Dual-Control Shift Close: approved_by, approval_notes, approved_at
    for (const [col, def] of [
      ['approved_by', 'INT NULL'],
      ['approval_notes', 'TEXT NULL'],
      ['approved_at', 'TIMESTAMP NULL'],
    ]) {
      try {
        await connection.query(`ALTER TABLE shifts ADD COLUMN ${col} ${def}`);
        console.log(`🔧 เพิ่มคอลัมน์ shifts.${col} (D1) ที่ขาดไปให้แล้ว`);
      } catch (alterErr) {
        if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(`⚠️ ALTER TABLE shifts (${col}) ล้มเหลว:`, alterErr.message);
      }
    }

    // ⭐️ Task 4 — Pre-order slip verification audit trail (นอกเหนือจาก orders.status ที่ใช้อยู่แล้ว)
    for (const [col, def] of [
      ['slip_file_path', 'VARCHAR(255) NULL'],
      ['slip_verified_by', 'INT NULL'],
      ['slip_verified_at', 'DATETIME NULL'],
      ['slip_verification_status', "ENUM('PENDING','VERIFIED','REJECTED') DEFAULT 'PENDING'"],
    ]) {
      try {
        await connection.query(`ALTER TABLE orders ADD COLUMN ${col} ${def}`);
        console.log(`🔧 เพิ่มคอลัมน์ orders.${col} ที่ขาดไปให้แล้ว`);
      } catch (alterErr) {
        if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(`⚠️ ALTER TABLE orders (${col}) ล้มเหลว:`, alterErr.message);
      }
    }

    // ⭐️ Defensive patch: assigned_to — พนักงานที่รับงาน order นี้ไปดูแล (lock สิทธิ์)
    try {
      await connection.query(`ALTER TABLE orders ADD COLUMN assigned_to INT NULL`);
      console.log("🔧 เพิ่มคอลัมน์ orders.assigned_to ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE orders (assigned_to) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Sprint 2 — Expiry Discount Feature: expiry_date, discount_percent, is_expired (generated)
    try {
      await connection.query(`ALTER TABLE products ADD COLUMN expiry_date DATE DEFAULT NULL`);
      console.log("🔧 เพิ่มคอลัมน์ products.expiry_date ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE products (expiry_date) ล้มเหลว:", alterErr.message);
    }
    try {
      await connection.query(`ALTER TABLE products ADD COLUMN discount_percent INT DEFAULT 40`);
      console.log("🔧 เพิ่มคอลัมน์ products.discount_percent ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE products (discount_percent) ล้มเหลว:", alterErr.message);
    }
    try {
      await connection.query(`ALTER TABLE products ADD COLUMN is_expired BOOLEAN GENERATED ALWAYS AS (expiry_date IS NOT NULL AND expiry_date < CURDATE()) STORED`);
      console.log("🔧 เพิ่มคอลัมน์ products.is_expired (GENERATED) ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE products (is_expired) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Phase 1 — โปรโมชั่นระดับสินค้า มีช่วงวันที่ (promo_percent ลด % ระหว่าง promo_start..promo_end)
    for (const [col, ddl] of [
      ['promo_percent', 'ADD COLUMN promo_percent INT DEFAULT 0'],
      ['promo_start', 'ADD COLUMN promo_start DATE DEFAULT NULL'],
      ['promo_end', 'ADD COLUMN promo_end DATE DEFAULT NULL'],
    ]) {
      try {
        await connection.query(`ALTER TABLE products ${ddl}`);
        console.log(`🔧 เพิ่มคอลัมน์ products.${col} ที่ขาดไปให้แล้ว`);
      } catch (alterErr) {
        if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(`⚠️ ALTER TABLE products (${col}) ล้มเหลว:`, alterErr.message);
      }
    }

    // ⭐️ Sprint 2 — B6: Idempotency — add idempotency_key columns to financial endpoints
    for (const [table, columns] of [
      ['sales', 'idempotency_key'],
      ['orders', 'idempotency_key'],
      ['shifts', 'idempotency_key'],
      ['purchases', 'idempotency_key'],
    ]) {
      try {
        await connection.query(`ALTER TABLE ${table} ADD COLUMN ${columns} VARCHAR(255) UNIQUE NULL`);
        console.log(`🔧 เพิ่มคอลัมน์ ${table}.${columns} ที่ขาดไปให้แล้ว`);
      } catch (alterErr) {
        if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(`⚠️ ALTER TABLE ${table} (${columns}) ล้มเหลว:`, alterErr.message);
      }
    }

    // ⭐️ Sprint 2 — C2: Audit Log Viewer — Add missing columns for audit_logs
    for (const [col, def] of [
      ['description', 'TEXT NULL'],
      ['amount_cents', 'INT DEFAULT 0'],
      ['status', "VARCHAR(50) DEFAULT 'SUCCESS'"],
    ]) {
      try {
        await connection.query(`ALTER TABLE audit_logs ADD COLUMN ${col} ${def}`);
        console.log(`🔧 เพิ่มคอลัมน์ audit_logs.${col} (C2) ที่ขาดไปให้แล้ว`);
      } catch (alterErr) {
        if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(`⚠️ ALTER TABLE audit_logs (${col}) ล้มเหลว:`, alterErr.message);
      }
    }
    // ⭐️ Sprint 2 — C2: Add indexes to audit_logs for faster querying
    try {
      await connection.query(`ALTER TABLE audit_logs ADD INDEX idx_created_at (created_at)`);
      console.log("🔧 เพิ่ม index audit_logs.idx_created_at ที่ขาดไปให้แล้ว");
    } catch (indexErr) {
      if (indexErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE audit_logs (idx_created_at) ล้มเหลว:", indexErr.message);
    }
    try {
      await connection.query(`ALTER TABLE audit_logs ADD INDEX idx_action (action)`);
      console.log("🔧 เพิ่ม index audit_logs.idx_action ที่ขาดไปให้แล้ว");
    } catch (indexErr) {
      if (indexErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE audit_logs (idx_action) ล้มเหลว:", indexErr.message);
    }
    try {
      await connection.query(`ALTER TABLE audit_logs ADD INDEX idx_user_id (user_id)`);
      console.log("🔧 เพิ่ม index audit_logs.idx_user_id ที่ขาดไปให้แล้ว");
    } catch (indexErr) {
      if (indexErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE audit_logs (idx_user_id) ล้มเหลว:", indexErr.message);
    }

    // ⭐️ Sprint 2 — C3: Backup & Restore
    await connection.query(`
      CREATE TABLE IF NOT EXISTS backups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        backup_date DATE NOT NULL,
        file_size_mb DECIMAL(10,2),
        status ENUM('SUCCESS', 'FAILED', 'PENDING') DEFAULT 'PENDING',
        backup_path VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        restored_at TIMESTAMP NULL,
        restored_by INT,
        notes TEXT,
        INDEX (backup_date),
        INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ⭐️ Summary/Payroll feature — hourly wage per staff member, editable by ADMIN in the new
    // summary page. Defaults to 0 so nothing breaks for existing users until ADMIN sets a rate.
    try {
      await connection.query(`ALTER TABLE users ADD COLUMN hourly_rate DECIMAL(10,2) DEFAULT 0`);
      console.log("🔧 เพิ่มคอลัมน์ users.hourly_rate ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE users (hourly_rate) ล้มเหลว:", alterErr.message);
    }

    console.log("✅ Ultimate Master Database Schema is Ready!");
    connection.release();
  } catch (err) {
    console.error("❌ Database Initialization Failed:", err);
  }
};

initDB();

module.exports = pool;