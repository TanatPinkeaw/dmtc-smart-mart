const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'rootpassword', // เปลี่ยนตามที่นายตั้งใน docker-compose
  database: 'pos_coop',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

const initDB = async () => {
  try {
    const connection = await pool.getConnection();
    
    // ==========================================
    // MODULE 1, 3, 6, 9, 10: Master Data (ข้อมูลหลัก)
    // ==========================================

    // 1. ตารางพนักงาน (Users)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role ENUM('ADMIN', 'CASHIER') DEFAULT 'CASHIER',
        is_active BOOLEAN DEFAULT TRUE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. ตารางสมาชิก (Members) - ใช้รหัสนักศึกษาเป็น PK
    await connection.query(`
      CREATE TABLE IF NOT EXISTS members (
        student_id VARCHAR(20) PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        points INT DEFAULT 0
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

    // 7. ตารางสินค้า (Products) - เพิ่ม cost (ต้นทุน) เพื่อเอาไปคำนวณกำไรใน Reports
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        barcode VARCHAR(50) UNIQUE,
        name VARCHAR(255) NOT NULL,
        category_id INT,
        cost DECIMAL(10, 2) NOT NULL DEFAULT 0, -- ต้นทุนรับเข้า
        price DECIMAL(10, 2) NOT NULL,          -- ราคาขายออก
        stock INT NOT NULL DEFAULT 0,
        image_url VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
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

    // 9. ตารางบิลขาย (Sales) - ผูกโปรโมชั่น
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cashier_id INT,
        member_id VARCHAR(20),
        promotion_id INT, -- โปรโมชั่นที่ใช้ในบิลนี้
        payment_method ENUM('CASH', 'QR', 'MIXED') DEFAULT 'CASH',
        total_amount DECIMAL(10, 2) NOT NULL, -- ยอดหลังหักส่วนลด
        discount_amount DECIMAL(10, 2) DEFAULT 0, -- ยอดที่ลดไป
        amount_received DECIMAL(10, 2) NOT NULL,
        change_amount DECIMAL(10, 2) NOT NULL,
        status ENUM('COMPLETED', 'VOIDED', 'HOLD') DEFAULT 'COMPLETED',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cashier_id) REFERENCES users(id),
        FOREIGN KEY (member_id) REFERENCES members(student_id),
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

    console.log("✅ Ultimate Master Database Schema is Ready!");
    connection.release();
  } catch (err) {
    console.error("❌ Database Initialization Failed:", err);
  }
};

initDB();

module.exports = pool;