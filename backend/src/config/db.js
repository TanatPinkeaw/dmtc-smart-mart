const mysql = require('mysql2/promise');
// ⭐️ env โหลด + validate แล้วที่ config.js ที่เดียว (เดิม db.js เรียก dotenv.config() และเช็ค
// required vars ซ้ำกับ server.js เกือบทุกตัวอักษร) ดู config.js สำหรับรายละเอียด
const config = require('./config');

// ⭐️ SSL สำหรับ MySQL บนคลาวด์ (เช่น Aiven) — เปิดเมื่อ DB_SSL=true
// - ถ้ามี DB_SSL_CA (เนื้อ CA cert แบบ PEM หรือ base64) จะ verify แบบเต็ม ปลอดภัยสุด
// - ถ้าไม่มี CA จะเข้ารหัสแต่ไม่ verify cert (กันดักฟังข้อมูลระหว่างทางได้ แต่ยังมีช่องให้ MITM แบบ
//   ปลอมเซิร์ฟเวอร์ได้ถ้า attacker คุม network/DNS) ; local dev ไม่ต้องตั้ง DB_SSL เลย
// TODO: ตั้ง DB_SSL_CA (CA cert จาก Aiven console) แล้วเปลี่ยนบล็อกนี้ให้บังคับอีกทีเพื่อ verify cert
// เต็มรูปแบบ ตอนนี้ผ่อนให้ทดสอบได้ก่อน — encrypted แต่ยัง rejectUnauthorized:false อยู่
let sslOption;
if (config.DB_SSL) {
  if (config.DB_SSL_CA) {
    const ca = config.DB_SSL_CA.includes('BEGIN CERTIFICATE')
      ? config.DB_SSL_CA
      : Buffer.from(config.DB_SSL_CA, 'base64').toString('utf8');
    sslOption = { ca, rejectUnauthorized: true };
  } else {
    // ⭐️ ยังไม่ตั้ง DB_SSL_CA — เข้ารหัสอยู่ (กันดักฟัง) แต่ไม่ verify cert (กัน MITM ไม่เต็มรูปแบบ)
    // ใช้ได้ทั้ง dev และ production ชั่วคราว ตั้ง DB_SSL_CA เมื่อพร้อมเพื่อความปลอดภัยเต็มที่
    sslOption = { rejectUnauthorized: false };
  }
}

const pool = mysql.createPool({
  host: config.DB_HOST,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  port: config.DB_PORT,
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

    // ⭐️ Defensive patch: ready_at — เวลาที่ออเดอร์เปลี่ยนเป็น READY จริง (แยกจาก completed_at ที่นับ
    // ตอนลูกค้ามารับของแล้ว) ใช้เป็นจุดอ้างอิงของ cron เตือนลูกค้าที่ของพร้อมแล้วแต่ยังไม่มารับ
    // (ดู server.js PUT /api/orders/:id ที่ set ready_at = NOW() ตอน status → READY, และ cron
    // "pickup reminder" รายชั่วโมงที่เช็คว่า ready_at นานเกิน threshold หรือยัง)
    try {
      await connection.query(`ALTER TABLE orders ADD COLUMN ready_at TIMESTAMP NULL`);
      console.log("🔧 เพิ่มคอลัมน์ orders.ready_at ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE orders (ready_at) ล้มเหลว:", alterErr.message);
    }
    // ⭐️ Defensive patch: pickup_reminder_sent — กันส่งข้อความเตือน "มารับของ" ซ้ำทุกชั่วโมงไม่รู้จบ
    // ให้สมาชิกโดนเตือนแค่ครั้งเดียวต่อออเดอร์ (cron ตั้งเป็น 1 หลังส่งสำเร็จ)
    try {
      await connection.query(`ALTER TABLE orders ADD COLUMN pickup_reminder_sent TINYINT(1) DEFAULT 0`);
      console.log("🔧 เพิ่มคอลัมน์ orders.pickup_reminder_sent ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE orders (pickup_reminder_sent) ล้มเหลว:", alterErr.message);
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
    // ⭐️ Removed: ALTER TABLE products ADD COLUMN is_expired BOOLEAN GENERATED ALWAYS AS (...)
    // MySQL rejects CURDATE() in a generated column (non-deterministic), so this ALTER has
    // failed silently on every single boot since it was added — the column never existed.
    // Not a functional bug: the real expiry feature computes `expiry_status` as a plain SQL
    // CASE expression at query time (see server.js's `expiryCase`), independent of this column.

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

    // ⭐️ Update — Offline POS sales: client-generated dedup key (separate from idempotency_key,
    // which is per-HTTP-request; this one survives across the whole offline→reconnect→batch-sync
    // round trip, generated once when the sale is captured offline and stored in IndexedDB) +
    // a flag marking which sales were captured while offline, for reporting/reconciliation.
    try {
      await connection.query(`ALTER TABLE sales ADD COLUMN client_offline_id VARCHAR(64) UNIQUE NULL`);
      console.log("🔧 เพิ่มคอลัมน์ sales.client_offline_id ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE sales (client_offline_id) ล้มเหลว:", alterErr.message);
    }
    try {
      await connection.query(`ALTER TABLE sales ADD COLUMN is_offline_sale TINYINT(1) DEFAULT 0`);
      console.log("🔧 เพิ่มคอลัมน์ sales.is_offline_sale ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE sales (is_offline_sale) ล้มเหลว:", alterErr.message);
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
      if (indexErr.code !== 'ER_DUP_KEYNAME') console.error("⚠️ ALTER TABLE audit_logs (idx_created_at) ล้มเหลว:", indexErr.message);
    }
    try {
      await connection.query(`ALTER TABLE audit_logs ADD INDEX idx_action (action)`);
      console.log("🔧 เพิ่ม index audit_logs.idx_action ที่ขาดไปให้แล้ว");
    } catch (indexErr) {
      if (indexErr.code !== 'ER_DUP_KEYNAME') console.error("⚠️ ALTER TABLE audit_logs (idx_action) ล้มเหลว:", indexErr.message);
    }
    try {
      await connection.query(`ALTER TABLE audit_logs ADD INDEX idx_user_id (user_id)`);
      console.log("🔧 เพิ่ม index audit_logs.idx_user_id ที่ขาดไปให้แล้ว");
    } catch (indexErr) {
      if (indexErr.code !== 'ER_DUP_KEYNAME') console.error("⚠️ ALTER TABLE audit_logs (idx_user_id) ล้มเหลว:", indexErr.message);
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

    // ⭐️ Update — offsite copy of each backup on Cloudinary (resource_type: raw), so a backup
    // survives Render's ephemeral disk being wiped on redeploy/restart, before backup_path
    // (local-disk-only) ever gets touched. See backup.js/config/cloudinary.js for the upload +
    // signed-download logic; restore now falls back to these columns when backup_path is gone.
    try {
      await connection.query(`ALTER TABLE backups ADD COLUMN cloud_public_id VARCHAR(255) DEFAULT NULL`);
      console.log("🔧 เพิ่มคอลัมน์ backups.cloud_public_id ที่ขาดไปให้แล้ว");
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE backups (cloud_public_id) ล้มเหลว:", err.message);
    }
    try {
      await connection.query(`ALTER TABLE backups ADD COLUMN cloud_url VARCHAR(500) DEFAULT NULL`);
      console.log("🔧 เพิ่มคอลัมน์ backups.cloud_url ที่ขาดไปให้แล้ว");
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE backups (cloud_url) ล้มเหลว:", err.message);
    }

    // ⭐️ Summary/Payroll feature — hourly wage per staff member, editable by ADMIN in the new
    // summary page. Defaults to 0 so nothing breaks for existing users until ADMIN sets a rate.
    try {
      await connection.query(`ALTER TABLE users ADD COLUMN hourly_rate DECIMAL(10,2) DEFAULT 0`);
      console.log("🔧 เพิ่มคอลัมน์ users.hourly_rate ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE users (hourly_rate) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Security remediation — must_change_password (weak default password enforcement)
    // and token_valid_after (bulk token invalidation on password/role change)
    // ⭐️ Home page feature — profile_image_url (รูปโปรไฟล์ผู้ใช้, เก็บ Cloudinary URL เหมือน field อื่น)
    for (const [col, ddl] of [
      ['must_change_password', 'ADD COLUMN must_change_password TINYINT(1) DEFAULT 0'],
      ['token_valid_after', 'ADD COLUMN token_valid_after DATETIME NULL'],
      ['profile_image_url', 'ADD COLUMN profile_image_url VARCHAR(500) NULL'],
    ]) {
      try {
        await connection.query(`ALTER TABLE users ${ddl}`);
        console.log(`🔧 เพิ่มคอลัมน์ users.${col} ที่ขาดไปให้แล้ว`);
      } catch (alterErr) {
        if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(`⚠️ ALTER TABLE users (${col}) ล้มเหลว:`, alterErr.message);
      }
    }

    // ⭐️ Security remediation — revoked_tokens (server-side JWT revocation on logout/password change)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        jti VARCHAR(64) UNIQUE NOT NULL,
        user_id INT NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        INDEX idx_jti (jti),
        INDEX idx_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ==========================================
    // ⭐️ Loyalty / RBAC / Member Groups / Rewards (feature: MANAGER role + group discounts + configurable loyalty)
    // ==========================================

    // ⭐️ เพิ่ม role 'MANAGER' (ผู้จัดการร้าน/อาจารย์ผู้ดูแล) คั่นระหว่าง CASHIER กับ ADMIN
    // MODIFY COLUMN ไม่มี error idempotency ให้ swallow (รันซ้ำได้ปลอดภัยอยู่แล้ว) log-on-failure เฉยๆ
    // ตามแบบ shifts.status enum-widen ด้านบน
    try {
      await connection.query(`ALTER TABLE users MODIFY COLUMN role ENUM('MEMBER','CASHIER','MANAGER','ADMIN') DEFAULT 'MEMBER'`);
      console.log("🔧 ขยาย enum users.role ให้มี MANAGER แล้ว");
    } catch (alterErr) {
      console.error("⚠️ ALTER TABLE users (role enum widen) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Part 2 — อัตราแต้มสะสมปรับได้ (เดิม hardcode /20 และ 1:1 ในโค้ด) ค่า default = พฤติกรรมเดิมเป๊ะ
    for (const [col, ddl] of [
      ['points_earn_amount_per_point', 'ADD COLUMN points_earn_amount_per_point INT DEFAULT 20'],
      ['points_redeem_value_per_point', 'ADD COLUMN points_redeem_value_per_point DECIMAL(10,2) DEFAULT 1.00'],
    ]) {
      try {
        await connection.query(`ALTER TABLE settings ${ddl}`);
        console.log(`🔧 เพิ่มคอลัมน์ settings.${col} ที่ขาดไปให้แล้ว`);
      } catch (alterErr) {
        if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(`⚠️ ALTER TABLE settings (${col}) ล้มเหลว:`, alterErr.message);
      }
    }

    // 🐛 FIX — DECIMAL(10,2) เก็บได้แค่ 2 ตำแหน่งทศนิยม อัตราแลกแต้มที่ละเอียดกว่านั้น (เช่น 0.001
    // สำหรับ "1000 แต้ม = 1 บาท") จะถูก MySQL ปัดลง "เงียบๆ" โดยไม่มี error ใดๆ กลับมา — ถ้าปัดจนเหลือ
    // 0.00 พอดี getLoyaltyRates() (ดู server.js) จะเห็นค่า <= 0 แล้วตกไปใช้ default (1 บาท/แต้ม) แทน
    // ทำให้ "ตั้งค่าหนึ่งแต่ระบบใช้จริงอีกค่า" แบบไม่มีสัญญาณเตือนใดๆ เลย — ขยายเป็น 4 ตำแหน่งกันปัดหาย
    // MODIFY COLUMN ไม่ error ตอนรันซ้ำ (ไม่ต้อง swallow ER_DUP_FIELDNAME เหมือน ADD COLUMN ด้านบน)
    try {
      await connection.query(`ALTER TABLE settings MODIFY COLUMN points_redeem_value_per_point DECIMAL(10,4) DEFAULT 1.0000`);
      console.log("🔧 ขยายความละเอียด settings.points_redeem_value_per_point เป็น 4 ตำแหน่งทศนิยมแล้ว");
    } catch (alterErr) {
      console.error("⚠️ ALTER TABLE settings (points_redeem_value_per_point precision) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Part 4 — สินค้าแลกของรางวัลด้วยแต้ม
    for (const [col, ddl] of [
      ['is_reward_item', 'ADD COLUMN is_reward_item TINYINT(1) DEFAULT 0'],
      ['points_required', 'ADD COLUMN points_required INT DEFAULT 0'],
    ]) {
      try {
        await connection.query(`ALTER TABLE products ${ddl}`);
        console.log(`🔧 เพิ่มคอลัมน์ products.${col} ที่ขาดไปให้แล้ว`);
      } catch (alterErr) {
        if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error(`⚠️ ALTER TABLE products (${col}) ล้มเหลว:`, alterErr.message);
      }
    }

    // ⭐️ Part 3 — กลุ่มสมาชิก (นักเรียน/อาจารย์/เจ้าหน้าที่) + ส่วนลดอัตโนมัติ
    await connection.query(`
      CREATE TABLE IF NOT EXISTS member_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        default_discount_percent DECIMAL(5,2) DEFAULT 0.00,
        description TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS group_discount_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id INT NOT NULL,
        category_id INT NOT NULL,
        discount_percent DECIMAL(5,2) NOT NULL,
        UNIQUE KEY uniq_group_category (group_id, category_id),
        FOREIGN KEY (group_id) REFERENCES member_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ⭐️ ผูกสมาชิกเข้ากลุ่ม (FK แยกเป็น ALTER เพราะ member_groups เพิ่งถูกสร้าง)
    try {
      await connection.query(`ALTER TABLE users ADD COLUMN group_id INT NULL`);
      console.log("🔧 เพิ่มคอลัมน์ users.group_id ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE users (group_id) ล้มเหลว:", alterErr.message);
    }
    try {
      await connection.query(`ALTER TABLE users ADD CONSTRAINT fk_users_group FOREIGN KEY (group_id) REFERENCES member_groups(id) ON DELETE SET NULL`);
      console.log("🔧 เพิ่ม FK users.group_id ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      // ER_FK_DUP_NAME / ER_DUP_KEY / already exists = ปล่อยผ่าน
      if (!/Duplicate|already exists|errno: 121|1826/i.test(alterErr.message)) {
        console.error("⚠️ ALTER TABLE users (fk group_id) ล้มเหลว:", alterErr.message);
      }
    }

    // ⭐️ ยอดส่วนลดกลุ่มที่เกิดในบิลนี้ (ไว้ทำรายงาน แยกจาก discount_amount ของโปรระดับบิล)
    try {
      await connection.query(`ALTER TABLE sales ADD COLUMN group_discount_amount DECIMAL(10,2) DEFAULT 0`);
      console.log("🔧 เพิ่มคอลัมน์ sales.group_discount_amount ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE sales (group_discount_amount) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Day 3 — เกณฑ์สต๊อกใกล้หมดต่อสินค้า (เดิม hardcode 10 ชิ้นทุกตัวใน notifyIfLowStock —
    // ตั้งค่า default เป็น 10 ให้พฤติกรรมเดิมไม่เปลี่ยนสำหรับสินค้าที่มีอยู่แล้ว) ใช้ตัดสินใจว่าจะส่ง
    // แจ้งเตือน LINE เมื่อไหร่ (ดู lineService.js sendLowStockAlert + server.js notifyIfLowStock)
    try {
      await connection.query(`ALTER TABLE products ADD COLUMN min_stock INT DEFAULT 10`);
      console.log("🔧 เพิ่มคอลัมน์ products.min_stock ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE products (min_stock) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ Day 3 — ผูกบัญชี LINE ของสมาชิกไว้ส่ง push notification ตรง (เช่น พรีออเดอร์พร้อมรับ)
    // NULL = ยังไม่ได้ผูกบัญชี LINE — ผูกได้ผ่าน POST /api/members/register-line (LIFF, memberController.js)
    try {
      await connection.query(`ALTER TABLE users ADD COLUMN line_user_id VARCHAR(64) DEFAULT NULL`);
      console.log("🔧 เพิ่มคอลัมน์ users.line_user_id ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.error("⚠️ ALTER TABLE users (line_user_id) ล้มเหลว:", alterErr.message);
    }
    // ⭐️ Update — UNIQUE กัน 1 บัญชี LINE ผูกซ้ำกับ user หลายคน (ไม่งั้น GET /check-line/:id จะงงว่า
    // ควรตอบ user คนไหนถ้ามีมากกว่า 1 แถวตรงกัน) NULL ซ้ำกันได้หลายแถวตามปกติของ MySQL UNIQUE INDEX
    // (คนที่ยังไม่ผูก LINE ไม่กระทบ) index ชื่อ idx_line_user_id กันชนกับ index อื่นที่อาจตั้งชื่อ users_line_user_id
    try {
      await connection.query(`ALTER TABLE users ADD UNIQUE INDEX idx_line_user_id (line_user_id)`);
      console.log("🔧 เพิ่ม UNIQUE index users.line_user_id ที่ขาดไปให้แล้ว");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_KEYNAME') console.error("⚠️ ALTER TABLE users (idx_line_user_id) ล้มเหลว:", alterErr.message);
    }

    // ⭐️ seed 3 กลุ่มเริ่มต้น — INSERT IGNORE บน code (UNIQUE) รันซ้ำได้ปลอดภัย
    await connection.query(`
      INSERT IGNORE INTO member_groups (name, code, default_discount_percent, description) VALUES
        ('นักเรียน/นักศึกษา', 'STUDENT', 0.00, 'สมาชิกทั่วไป — นักเรียนและนักศึกษา'),
        ('อาจารย์', 'TEACHER', 5.00, 'อาจารย์ผู้สอน'),
        ('เจ้าหน้าที่/บุคลากร', 'STAFF', 5.00, 'เจ้าหน้าที่และบุคลากรของสถาบัน')
    `);

    // ⭐️ Part 5 — บัญชีแยกประเภทแต้มสะสม (ledger) ตรวจสอบย้อนหลังได้ทุกการเคลื่อนไหว
    await connection.query(`
      CREATE TABLE IF NOT EXISTS point_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('EARN','REDEEM','REWARD','ADJUST') NOT NULL,
        points INT NOT NULL,                 -- + earn, - redeem/reward
        ref_sale_id INT NULL,
        ref_order_id INT NULL,
        performed_by INT NULL,               -- แคชเชียร์/แอดมินที่ทำรายการ
        note VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        INDEX idx_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log("✅ Ultimate Master Database Schema is Ready!");
    connection.release();
  } catch (err) {
    console.error("❌ Database Initialization Failed:", err);
  }
};

initDB();

module.exports = pool;