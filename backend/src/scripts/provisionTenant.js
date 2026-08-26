// scripts/provisionTenant.js — สร้าง database + admin user ให้ customer ใหม่
// ใช้: node src/scripts/provisionTenant.js <shop_name> <admin_username> <admin_password>
// ตัวอย่าง: node src/scripts/provisionTenant.js "ร้าน ABC" admin abc123

const mysql = require('mysql2/promise');
// ⭐️ FIX — เดิม require('bcrypt') ซึ่งไม่ได้อยู่ใน dependencies (โปรเจกต์นี้ใช้ bcryptjs ตัวเดียว)
//   ทำให้ backend crash ตอน boot (MODULE_NOT_FOUND) เพราะ adminDashboard.js require ไฟล์นี้ตั้งแต่ต้น
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Config from env or defaults
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';

async function provisionTenant(shopName, adminUsername, adminPassword) {
  // Generate DB name from shop name (safe for MySQL)
  const dbName = 'pos_' + shopName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 30);
  
  console.log(`📦 กำลังสร้างระบบสำหรับ: ${shopName}`);
  console.log(`   Database: ${dbName}`);
  
  // Connect to MySQL (no database selected)
  const conn = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true
  });
  
  try {
    // 1. Create database
    console.log(`1️⃣ สร้าง database ${dbName}...`);
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    
    // 2. Switch to new database
    await conn.query(`USE \`${dbName}\``);
    
    // 3. Read and execute schema
    console.log(`2️⃣ สร้าง tables...`);
    const schemaPath = path.join(__dirname, '../schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      // Split by semicolons and execute each statement
      const statements = schema.split(';').filter(s => s.trim());
      for (const stmt of statements) {
        if (stmt.trim() && !stmt.trim().startsWith('--')) {
          try {
            await conn.query(stmt);
          } catch (err) {
            // Skip duplicate table errors
            if (err.code !== 'ER_TABLE_EXISTS_OK') {
              console.warn(`   ⚠️ Statement skipped: ${err.message}`);
            }
          }
        }
      }
    }
    
    // 4. Create admin user
    console.log(`3️⃣ สร้าง admin user...`);
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await conn.query(
      'INSERT INTO users (student_id, password, full_name, role) VALUES (?, ?, ?, ?)',
      [adminUsername, hashedPassword, `Admin ${shopName}`, 'ADMIN']
    );
    
    // 5. Create default settings
    console.log(`4️⃣ ตั้งค่าร้าน...`);
    await conn.query(
      'INSERT INTO settings (store_name, tax_id, address, receipt_footer) VALUES (?, ?, ?, ?)',
      [shopName, '', '', 'ขอบคุณที่ใช้บริการ']
    );
    
    // 6. Create default categories
    const defaultCategories = ['อาหาร', 'เครื่องดื่ม', 'ของว่าง', 'อื่นๆ'];
    for (const cat of defaultCategories) {
      await conn.query('INSERT INTO categories (name) VALUES (?)', [cat]);
    }
    
    console.log(`\n✅ สร้างระบบสำหรับ "${shopName}" เรียบร้อย!`);
    console.log(`   Database: ${dbName}`);
    console.log(`   Admin: ${adminUsername} / ${adminPassword}`);
    console.log(`\n📌 บันทึกข้อมูลนี้ไว้:`);
    console.log(`   DB_NAME=${dbName}`);
    
    return { dbName, adminUsername, adminPassword };
  } finally {
    await conn.end();
  }
}

// Run if called directly
if (require.main === module) {
  const [shopName, adminUsername, adminPassword] = process.argv.slice(2);
  if (!shopName || !adminUsername || !adminPassword) {
    console.error('Usage: node provisionTenant.js <shop_name> <admin_username> <admin_password>');
    process.exit(1);
  }
  provisionTenant(shopName, adminUsername, adminPassword)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error:', err.message);
      process.exit(1);
    });
}

module.exports = { provisionTenant };
