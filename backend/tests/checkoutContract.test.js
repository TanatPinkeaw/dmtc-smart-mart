// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/checkoutContract.test.js — กัน checkoutValidator ฝั่ง frontend/backend "หลุด sync" กัน
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร / ทำไมมีไฟล์นี้:
//   schema ตรวจ checkout ถูกเขียนซ้ำ 2 ที่ (backend/src/validators/index.js กับ
//   frontend/src/validators/checkoutValidator.ts) เพราะ frontend/backend deploy คนละ root
//   (Vercel=frontend/, Render=backend/) จะ import ไฟล์ข้ามกันไม่ได้ — ต้อง duplicate. ไฟล์นี้คือ
//   "สัญญากลาง" (contract) ที่กันสองฝั่งหลุดกัน โดย:
//     ส่วน A) ยิง payload ตัวอย่าง (ถูก/ผิด) ผ่าน backend checkoutValidator จริง เช็คว่าพฤติกรรมตรงสัญญา
//     ส่วน B) อ่านไฟล์ frontend checkoutValidator.ts (repo มีทั้งสองฝั่งตอนรัน CI) เช็คว่ากฎที่ "ต้อง
//             ตรงกัน" (payment_method, ฟิลด์บังคับ, ช่วง quantity ฯลฯ) ยังมีอยู่ครบ — ถ้าใครแก้ฝั่งเดียว
//             แล้วลืมอีกฝั่ง เทสนี้ fail ทันที
//   ไม่ต้องต่อ DB — รันได้เร็ว (ต่างจาก smokeTest) ; รันด้วย: node tests/checkoutContract.test.js
//   ⚠️ ถ้าจะเปลี่ยน "กฎ checkout" ต้องแก้ให้ครบ 3 ที่: validators/index.js + checkoutValidator.ts +
//      CANONICAL fixtures/tokens ในไฟล์นี้
// ═══════════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { checkoutValidator } = require('../src/validators');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

// ── ส่วน A: พฤติกรรมของ backend checkoutValidator ต้องตรงตามสัญญา ─────────────────────────
// payload ฐานที่ถูกต้อง แล้วดัดแปลงทีละเคส
const base = {
  cashier_id: 1,
  payment_method: 'CASH',
  amount_received: 100,
  items: [{ product_id: 1, quantity: 2 }],
};
const ok = (p) => !checkoutValidator.validate(p, { abortEarly: true }).error;

console.log('A) backend checkoutValidator behavior:');
check('payload ฐานถูกต้อง → ผ่าน', ok(base));
check('มี member_id/promotion_id/redeem_points → ผ่าน', ok({ ...base, member_id: 5, promotion_id: 3, redeem_points: 10 }));
check('member_id/promotion_id = null → ผ่าน', ok({ ...base, member_id: null, promotion_id: null }));
check("payment_method 'QR' → ผ่าน", ok({ ...base, payment_method: 'QR' }));
check("payment_method 'MIXED' → ผ่าน", ok({ ...base, payment_method: 'MIXED' }));
check('item มี redeem_reward → ผ่าน (backend รองรับ)', ok({ ...base, items: [{ product_id: 1, quantity: 1, redeem_reward: true }] }));

check("payment_method 'CARD' (ไม่มีในระบบ) → ต้องไม่ผ่าน", !ok({ ...base, payment_method: 'CARD' }));
check('ไม่มี cashier_id → ต้องไม่ผ่าน', !ok({ ...base, cashier_id: undefined }));
check('items ว่าง → ต้องไม่ผ่าน', !ok({ ...base, items: [] }));
check('quantity = 0 → ต้องไม่ผ่าน', !ok({ ...base, items: [{ product_id: 1, quantity: 0 }] }));
check('quantity = 1001 (เกิน max 1000) → ต้องไม่ผ่าน', !ok({ ...base, items: [{ product_id: 1, quantity: 1001 }] }));
check('amount_received ติดลบ → ต้องไม่ผ่าน', !ok({ ...base, amount_received: -1 }));
check('product_id ติดลบ → ต้องไม่ผ่าน', !ok({ ...base, items: [{ product_id: -1, quantity: 1 }] }));

// ── ส่วน B: frontend checkoutValidator.ts ต้องมีกฎ "shared" ครบ (จับ drift ข้ามไฟล์) ──────────
// repo มี frontend/ อยู่ตอนรัน CI (แยกเฉพาะตอน deploy) — อ่าน source มาเช็ค token ที่ต้องตรงกัน
console.log('B) frontend checkoutValidator.ts stays in sync:');
const feePath = path.join(__dirname, '..', '..', 'frontend', 'src', 'validators', 'checkoutValidator.ts');
if (!fs.existsSync(feePath)) {
  // ไม่เจอไฟล์ frontend (เช่นรันจาก backend อย่างเดียว) — ข้ามส่วน B ไม่ถือว่า fail
  console.log('  (ข้าม — ไม่พบไฟล์ frontend, น่าจะรันแยกเฉพาะ backend)');
} else {
  const fe = fs.readFileSync(feePath, 'utf8');

  // (1) payment_method: ต้องเป็น 3 ค่านี้ "เป๊ะ" ห้ามเพิ่ม/ลดข้างเดียว — ดึง enum จาก .valid(...) มาเทียบ
  //     ตรงๆ (substring include อย่างเดียวจับ "เพิ่มค่า" ไม่ได้ เช่น เผลอเติม 'CARD' ฝั่ง frontend)
  const m = fe.match(/payment_method:\s*Joi\.string\(\)\.valid\(([^)]*)\)/);
  const feEnum = m ? m[1].replace(/\s+/g, ' ').trim() : '(ไม่พบ payment_method enum)';
  const EXPECTED_ENUM = "'CASH', 'QR', 'MIXED'";
  check(`frontend payment_method enum ตรงเป๊ะ [${feEnum}]`, feEnum === EXPECTED_ENUM);

  // (2) ฟิลด์/กฎ shared อื่นๆ ต้อง "มีอยู่" (จับเคสลบทิ้งข้างเดียว) — presence check พอ เพราะการ "เพิ่ม"
  //     ฟิลด์เกินฝั่ง frontend backend จะ reject เองตอน runtime อยู่แล้ว
  const requiredTokens = [
    'cashier_id', 'member_id', 'promotion_id', 'redeem_points', 'amount_received', 'items',
    'product_id', 'quantity',
    '.max(1000)',              // เพดาน quantity ต่อรายการ
    '.min(1)',                 // items ต้องมีอย่างน้อย 1
  ];
  for (const tok of requiredTokens) {
    check(`frontend มี "${tok}"`, fe.includes(tok));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
