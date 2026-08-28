// scripts/provisionTenant.js — สร้าง database + admin user ให้ customer ใหม่
// ใช้: node src/scripts/provisionTenant.js <shop_name> <admin_username> <admin_password>
// ตัวอย่าง: node src/scripts/provisionTenant.js "ร้าน ABC" admin abc123

const mysql = require('mysql2/promise');
// ⭐️ FIX — เดิม require('bcrypt') ซึ่งไม่ได้อยู่ใน dependencies (โปรเจกต์นี้ใช้ bcryptjs ตัวเดียว)
//   ทำให้ backend crash ตอน boot (MODULE_NOT_FOUND) เพราะ adminDashboard.js require ไฟล์นี้ตั้งแต่ต้น
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// ⭐️ Use config module (single source of truth) instead of reading process.env directly
const config = require('../config/config');

// ⭐️ SSL support for cloud databases (e.g. Aiven) — same pattern as config/db.js
let sslOption;
if (config.DB_SSL) {
  if (config.DB_SSL_CA) {
    const ca = config.DB_SSL_CA.includes('BEGIN CERTIFICATE')
      ? config.DB_SSL_CA
      : Buffer.from(config.DB_SSL_CA, 'base64').toString('utf8');
    sslOption = { ca, rejectUnauthorized: true };
  } else {
    sslOption = { rejectUnauthorized: false };
  }
}

// ⭐️ Accept optional pool parameter — reuse existing connections when available (Aiven limits new TCP connections)
async function provisionTenant(shopName, adminUsername, adminPassword, existingPool) {
  // Generate DB name from shop name (safe for MySQL)
  const dbName = 'pos_' + shopName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 30);
  
  console.log(`📦 กำลังสร้างระบบสำหรับ: ${shopName}`);
  console.log(`   Database: ${dbName}`);
  
  // Use existing pool if provided, otherwise create standalone connection
  let conn, usePool = false;
  if (existingPool) {
    conn = await existingPool.getConnection();
    usePool = true;
  } else {
    conn = await mysql.createConnection({
      host: config.DB_HOST,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      multipleStatements: true,
      connectTimeout: 10000,
      ...(sslOption ? { ssl: sslOption } : {})
    });
  }
  
  try {
    // 1. Create database
    console.log(`1️⃣ สร้าง database ${dbName}...`);
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    
    // 2. Switch to new database
    await conn.query(`USE \`${dbName}\``);
    
    // 3. Read and execute schema
    console.log(`2️⃣ สร้าง tables...`);
    const schemaPath = path.join(__dirname, '../../schema.sql');
    console.log('[PROVISION] Schema path:', schemaPath, 'exists:', fs.existsSync(schemaPath));
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      // Split by semicolons and execute each statement
      const statements = schema.split(';').filter(s => s.trim());
    console.log('[PROVISION] Parsed', statements.length, 'statements from schema.sql');
      var successCount = 0, failCount = 0;
      for (var si = 0; si < statements.length; si++) {
        // Strip all -- comments (line comments) and collapse whitespace
        var stmt = statements[si].replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
        if (!stmt) continue;
        // Find first SQL keyword (CREATE/ALTER/INSERT/DROP) and extract from there
        // This skips non-SQL text like comment fragments from schema.sql
        var kwMatch = stmt.match(/\b(CREATE|ALTER|INSERT|DROP|SET|UPDATE|DELETE)\b/i);
        if (!kwMatch) continue;
        stmt = stmt.substring(kwMatch.index);
        try {
          await conn.query(stmt);
          successCount++;
        } catch (err) {
          failCount++;
          if (err.code !== "ER_TABLE_EXISTS_OK") {
            console.warn("   Warning: #" + (si+1) + " (" + err.code + "): " + err.message);
            console.warn("   SQL: " + stmt.substring(0, 300));
          }
        }
      }
      console.log("[PROVISION] Schema: " + successCount + " OK, " + failCount + " failed");
      var [tableRows] = await conn.query("SHOW TABLES");
      console.log("[PROVISION] Tables created:", tableRows.map(function(r) { return Object.values(r)[0]; }).join(", "));
      var [dbRows] = await conn.query("SELECT DATABASE() as db");
      console.log("[PROVISION] Current database:", dbRows[0].db);
    }
    
    // 4. Create admin user
    console.log(`3️⃣ สร้าง admin user... (checking users table exists)`);
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await conn.query(
      'INSERT INTO users (student_id, password, full_name, role, is_active) VALUES (?, ?, ?, ?, 1)',
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
    if (usePool) { conn.release(); } else { await conn.end(); }
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
