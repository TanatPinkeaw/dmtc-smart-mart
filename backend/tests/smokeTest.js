// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/smokeTest.js — เทสภาพรวมขั้นต่ำ (พิสูจน์ว่า flow ขายหลักยังทำงาน) รันใน CI
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: รันจริงกับ server + DB จริง (ไม่ mock) ไล่ flow: login → checkout ตอนไม่เปิดกะต้องโดนบล็อก →
//   เปิดกะ → checkout ผ่าน → ปิดกะ — ถ้าใครแก้โค้ดแล้วเผลอทำ flow นี้พัง จะ fail ที่นี่แทนที่จะไปพังหน้าร้าน
// รันด้วย: node tests/smokeTest.js (GitHub Actions รันให้อัตโนมัติทุก push — ดู .github/workflows/ci.yml)
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Minimal end-to-end smoke test — Phase 3 (foundational safety net).
//
// Proves the core cashier flow works against a REAL server + REAL database (not mocks):
// login -> checkout blocked with no open shift -> open shift -> checkout succeeds -> close shift.
// This is exactly the rule set this project's shift-gate / admin-can't-sell work depends on —
// a future change that quietly breaks it now fails here instead of at the register.
//
// Not a full test suite. Deliberately narrow: proves the one flow that was previously only
// verified by hand. Runs against whatever DB the DB_* env vars point to (see .github/workflows
// for how CI wires this up to a throwaway MySQL service loaded from schema.sql).
//
// Usage: node tests/smokeTest.js   (run from backend/; needs config.js's required env vars already set)

require('dotenv').config({ quiet: true });
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const BACKEND_ROOT = path.resolve(__dirname, '..');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_STUDENT_ID = '__smoke_test_cashier__';
const TEST_PASSWORD = 'SmokeTest123!';
const TEST_BARCODE = '__SMOKE_TEST_SKU__';

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

async function seedTestData() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  await conn.query(
    `INSERT INTO users (student_id, password, full_name, role, is_active, must_change_password)
     VALUES (?, ?, 'Smoke Test Cashier', 'CASHIER', 1, 0)
     ON DUPLICATE KEY UPDATE password = VALUES(password), role = 'CASHIER', is_active = 1, must_change_password = 0`,
    [TEST_STUDENT_ID, hash]
  );
  const [[cashier]] = await conn.query('SELECT id FROM users WHERE student_id = ?', [TEST_STUDENT_ID]);

  // Leftover OPEN shift from a previous failed run would make /api/shifts/open 400 — clear it.
  await conn.query(
    `UPDATE shifts SET status = 'CLOSED', closed_at = NOW() WHERE cashier_id = ? AND status IN ('OPEN', 'PENDING_CLOSE')`,
    [cashier.id]
  );

  await conn.query(
    `INSERT INTO products (barcode, name, category_id, price, cost, stock, is_active)
     VALUES (?, 'Smoke Test Product', NULL, 10.00, 5.00, 999, 1)
     ON DUPLICATE KEY UPDATE price = 10.00, stock = 999, is_active = 1`,
    [TEST_BARCODE]
  );
  const [[product]] = await conn.query('SELECT id FROM products WHERE barcode = ?', [TEST_BARCODE]);

  await conn.end();
  return { cashierId: cashier.id, productId: product.id };
}

function waitForHealth(retries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = async (n) => {
      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.ok) return resolve();
      } catch (e) {
        // server not up yet, keep polling
      }
      if (n <= 0) return reject(new Error('server did not become healthy in time'));
      setTimeout(() => attempt(n - 1), 500);
    };
    attempt(retries);
  });
}

function cookieHeaderFrom(res) {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  const { cashierId, productId } = await seedTestData();
  log('seeded test cashier + test product');

  const serverProc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  serverProc.stdout.on('data', (d) => { serverOutput += d; });
  serverProc.stderr.on('data', (d) => { serverOutput += d; });

  const cleanup = () => { try { serverProc.kill(); } catch (e) { /* already dead */ } };
  process.on('exit', cleanup);

  try {
    await waitForHealth();
    log('server healthy');

    let res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_STUDENT_ID, password: TEST_PASSWORD }),
    });
    if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
    const loginBody = await res.json();
    const cookies = cookieHeaderFrom(res);
    const csrfToken = loginBody.csrfToken;
    if (!csrfToken) throw new Error('login response missing csrfToken');
    log('login OK');

    const authedHeaders = () => ({
      'Content-Type': 'application/json',
      Cookie: cookies,
      'X-CSRF-Token': csrfToken,
    });

    // Checkout with no open shift must be rejected — this is the exact rule this session added.
    res = await fetch(`${BASE_URL}/api/sales/checkout`, {
      method: 'POST',
      headers: authedHeaders(),
      body: JSON.stringify({
        cashier_id: cashierId,
        payment_method: 'CASH',
        amount_received: 10,
        items: [{ product_id: productId, quantity: 1 }],
      }),
    });
    const preShiftBody = await res.json();
    if (res.status !== 400 || preShiftBody.code !== 'NO_OPEN_SHIFT') {
      throw new Error(
        `expected checkout to be rejected with NO_OPEN_SHIFT before opening a shift, got ${res.status} ${JSON.stringify(preShiftBody)}`
      );
    }
    log('checkout correctly blocked with no open shift (NO_OPEN_SHIFT gate holds)');

    res = await fetch(`${BASE_URL}/api/shifts/open`, {
      method: 'POST',
      headers: authedHeaders(),
      body: JSON.stringify({ cashier_id: cashierId, opening_cash: 500, open_photo: 'smoke-test-photo.jpg' }),
    });
    if (!res.ok) throw new Error(`open shift failed: ${res.status} ${await res.text()}`);
    const openBody = await res.json();
    log(`shift opened (id ${openBody.shift_id})`);

    res = await fetch(`${BASE_URL}/api/sales/checkout`, {
      method: 'POST',
      headers: authedHeaders(),
      body: JSON.stringify({
        cashier_id: cashierId,
        payment_method: 'CASH',
        amount_received: 10,
        items: [{ product_id: productId, quantity: 1 }],
      }),
    });
    if (!res.ok) throw new Error(`checkout failed: ${res.status} ${await res.text()}`);
    log('checkout OK with shift open');

    // Close-shift initiation only — dual-approval (admin approve/reject) is out of scope here.
    res = await fetch(`${BASE_URL}/api/shifts/close`, {
      method: 'POST',
      headers: authedHeaders(),
      body: JSON.stringify({ cashier_id: cashierId, actual_cash: 510, close_photo: 'smoke-test-close-photo.jpg' }),
    });
    if (!res.ok) throw new Error(`close shift failed: ${res.status} ${await res.text()}`);
    log('close shift OK');

    log('ALL SMOKE TESTS PASSED');
    process.exitCode = 0;
  } catch (err) {
    console.error(`[smoke] FAILED: ${err.message}`);
    console.error('--- server output (last 4000 chars) ---');
    console.error(serverOutput.slice(-4000));
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}

main();
