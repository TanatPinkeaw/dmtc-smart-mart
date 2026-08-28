// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/multiTenantContract.test.js — Multi-tenant system contract (static, no DB)
// ─────────────────────────────────────────────────────────────────────────────────
// รันด้วย: npm run test:unit
// ทำอะไร: ล็อกว่า tenantRegistry + provisionTenant + tenantDB + posAdminRoutes มี
//   ฟังก์ชัน/ฟีเจอร์ครบถ้วน ไม่ต้องต่อ DB — อ่าน source แล้วเช็ค pattern
// ═══════════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const tenantRegistrySrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'tenantRegistry.js'), 'utf8');
const provisionTenantSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'scripts', 'provisionTenant.js'), 'utf8');
const tenantDBSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware', 'tenantDB.js'), 'utf8');
const posAdminSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'posAdminRoutes.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

// ── Section A: tenantRegistry exports ──
console.log('A) tenantRegistry มีฟังก์ชันครบ:');
check('initMasterDB', /async function initMasterDB\(/.test(tenantRegistrySrc));
check('getTenantByDbName', /async function getTenantByDbName\(/.test(tenantRegistrySrc));
check('getAllTenants', /async function getAllTenants\(/.test(tenantRegistrySrc));
check('addTenant', /async function addTenant\(/.test(tenantRegistrySrc));
check('updateLastLogin', /async function updateLastLogin\(/.test(tenantRegistrySrc));
check('softDeleteTenant', /async function softDeleteTenant\(/.test(tenantRegistrySrc));
check('getTenantConnection', /async function getTenantConnection\(/.test(tenantRegistrySrc));
check('getMasterPool', /function getMasterPool\(/.test(tenantRegistrySrc));

// ── Section B: tenantRegistry schema (tenants table) ──
console.log('B) tenants table มีคอลัมน์ครบ:');
const requiredCols = ['shop_name', 'db_name', 'admin_username', 'plan', 'max_users', 'max_products', 'is_active', 'created_at', 'last_login', 'deleted_at'];
for (const col of requiredCols) {
  check(`คอลัมน์ ${col} อยู่ใน CREATE TABLE tenants`, tenantRegistrySrc.includes(col));
}
check('tenants table uses deleted_at (soft delete)', /deleted_at TIMESTAMP NULL/.test(tenantRegistrySrc));
check('tenants table uses plan ENUM', /plan ENUM\('free','basic','pro','enterprise'\)/.test(tenantRegistrySrc));

// ── Section C: tenantRegistry self-heal ──
console.log('C) tenantRegistry self-heal:');
check('masterBootstrapAttempted flag (กัน recursion)', /let masterBootstrapAttempted = false/.test(tenantRegistrySrc));
check('ensureDeletedAtColumn (lazy migration)', /async function ensureDeletedAtColumn\(/.test(tenantRegistrySrc));
check('ER_DUP_FIELDNAME guard (column มีอยู่แล้ว)', /ER_DUP_FIELDNAME/.test(tenantRegistrySrc));

// ── Section D: provisionTenant steps ──
console.log('D) provisionTenant มีครบทุกขั้นตอน:');
check('CREATE DATABASE', /CREATE DATABASE IF NOT EXISTS/.test(provisionTenantSrc));
check('CREATE TABLE (schema.sql)', /schema\.sql/.test(provisionTenantSrc));
check('INSERT INTO users (admin)', /INSERT INTO users \(student_id/.test(provisionTenantSrc));
check('INSERT INTO settings (store_name)', /INSERT INTO settings \(store_name/.test(provisionTenantSrc));
check('INSERT INTO categories (default)', /INSERT INTO categories \(name\)/.test(provisionTenantSrc));
check('bcrypt.hash (password hashing)', /bcrypt\.hash\(/.test(provisionTenantSrc));
check('exports provisionTenant function', /module\.exports.*provisionTenant/.test(provisionTenantSrc));
check('uses config module (ไม่อ่าน process.env ตรง)', /require\('\.\.\/config\/config'\)/.test(provisionTenantSrc));
check('SSL support', /sslOption/.test(provisionTenantSrc));

// ── Section E: tenantDB middleware ──
console.log('E) tenantDB middleware:');
check('exports tenantDB function', /module\.exports.*tenantDB/.test(tenantDBSrc));
check('exports getOrCreatePool', /module\.exports.*getOrCreatePool/.test(tenantDBSrc));
check('exports removePoolFromCache', /module\.exports.*removePoolFromCache/.test(tenantDBSrc));
check('pool cache (Map)', /new Map\(\)/.test(tenantDBSrc));
check('connectionLimit >= 10 (tenant pool)', /connectionLimit:\s*(?:1[0-9]|[2-9]\d)/.test(tenantDBSrc));
check('connectTimeout = 8000', /connectTimeout:\s*8000/.test(tenantDBSrc));
check('charset utf8mb4', /charset:\s*'utf8mb4'/.test(tenantDBSrc));
check('timezone +07:00', /timezone:\s*'\+07:00'/.test(tenantDBSrc));
check('SSL support', /sslOption/.test(tenantDBSrc));
check('sets req.db', /req\.db =/.test(tenantDBSrc));
check('sets req.dbName', /req\.dbName =/.test(tenantDBSrc));

// ── Section F: posAdminRoutes uses req.db ──
console.log('F) posAdminRoutes ใช้ req.db สำหรับทุก query:');
check('มี req.db อยู่จริง', /req\.db/.test(posAdminSrc));
check('ไม่ใช้ pool ตรงจาก config (ต้องผ่าน tenantDB)', !/require\('\.\.\/config\/config'\)/.test(posAdminSrc));
check('import logAudit จาก utils/auditLog', /require\('\.\.\/utils\/auditLog'\)/.test(posAdminSrc));
check('import validateRequest จาก middleware/guards', /validateRequest/.test(posAdminSrc));
check('import requireRole จาก middleware/guards', /requireRole/.test(posAdminSrc));

// ── Section G: server.js mounts all tenant routes ──
console.log('G) server.js mount tenant routes ครบ:');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('mount /api/pos-admin', /app\.use\('\/api\/pos-admin',\s*require\('.*posAdminRoutes'\)\)/.test(serverSrc));
check('mount /api/tenants', /app\.use\('\/api\/tenants',\s*require\('.*tenantRoutes'\)\)/.test(serverSrc));
check('mount tenantDB middleware', /app\.use\(tenantDB\)/.test(serverSrc));
check('pos-admin/login อยู่ใน PUBLIC_PATHS', /pos-admin\/login/.test(serverSrc));
check('pos-admin/ อยู่ใน CSRF_EXEMPT_PATHS', /pos-admin\//.test(serverSrc));

// ── Summary ──
console.log(`\n════════ สรุปผล ════════`);
if (fail > 0) {
  console.log(`❌ FAIL ${fail} จาก ${pass + fail} เช็ค`);
  process.exit(1);
} else {
  console.log(`✅ PASS ${pass}/${pass + fail} เช็ค`);
}
