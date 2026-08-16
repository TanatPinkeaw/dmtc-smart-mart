// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/priceContract.test.js — กันสูตรราคาหลังส่วนลดระดับสินค้า (โปร/ใกล้หมดอายุ) หลุด sync
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร / ทำไมมีไฟล์นี้:
//   ราคาต่อชิ้นหลังหักส่วนลดระดับสินค้าคำนวณ 3 ที่: backend checkout + POST /api/orders +
//   /api/products enrichment (ปัดส่วนลดเป็น "บาทเต็ม": Math.round(price * pct / 100) แล้วหัก)
//   และ frontend helper กลาง utils/money.ts (effectiveUnitPrice) ที่ POS + หน้าจองใช้แสดงราคา
//   เคย drift กัน: frontend ปัดที่ตำแหน่งสตางค์ (Math.round(toSatang(price) * pct / 100)) ทำให้
//   ราคาที่โชว์บนการ์ด ≠ ราคาที่ backend คิดจริง (19.90 ลด 50% → โชว์ 9.95 แต่จ่าย 9.90)
//   ไฟล์นี้คือ "สัญญากลาง" ที่ล็อกสูตรให้ทุกฝั่งตรงกัน โดย:
//     ส่วน A) รันฟังก์ชันจาก source จริงของ frontend money.ts (ไม่ copy มา) เทียบกับค่าที่ล็อกไว้
//     ส่วน B) เช็คว่า backend ยังใช้สูตรปัดบาท + frontend ไม่กลับไปใช้ปัดสตางค์ (จับ drift กลับ)
//   ไม่ต้องต่อ DB — รันได้เร็ว ; รันด้วย: node tests/priceContract.test.js
//   ⚠️ ถ้าจะเปลี่ยน "สูตรราคา" ต้องแก้ให้ตรงกัน 3 ที่: server.js (checkout + /api/orders +
//      /api/products enrichment) + frontend utils/money.ts + ค่าล็อกในไฟล์นี้
// ═══════════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

// ── ส่วน A: frontend effectiveUnitPrice ต้องให้ผลตรงกับสัญญา (ปัดส่วนลดเป็นบาทเต็ม) ───────────
const moneyPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'money.ts');
if (!fs.existsSync(moneyPath)) {
  console.log('  (ข้ามส่วน A — ไม่พบไฟล์ frontend money.ts, น่าจะรันแยกเฉพาะ backend)');
} else {
  const src = fs.readFileSync(moneyPath, 'utf8');

  // Extract ฟังก์ชันจาก source จริง (ไม่ copy สูตรมา): หา signature `function ชื่อ(...)` แล้วจับคู่
  // ปีกกาให้ได้ body ทั้งก้อน — strip แค่ type `(product: any)` ของ 2 ฟังก์ชันนี้ (Node 20 ยัง strip
  // TS ไม่ได้); toSatang/fromSatang ที่ effectiveUnitPrice เรียกให้จาก harness ด้านล่าง (ฟังก์ชัน
  // ง่ายๆ ไม่ใช่จุดเสี่ยงของ contract)
  function extractFunction(src, name) {
    const sig = new RegExp(`function ${name}\\([^)]*\\)\\s*:\\s*[^{]+\\{`);
    const m = sig.exec(src);
    if (!m) throw new Error(`ไม่พบ function ${name} ใน money.ts`);
    let depth = 0, i = src.indexOf('{', m.index);
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(m.index, i + 1)
      .replace(/function (effectiveUnitPrice|itemLevelDiscountPercent)\(product: any\): number/, 'function $1(product)');
  }

  const fnSrc = [
    "function toSatang(baht) { const n = typeof baht === 'string' ? parseFloat(baht) : Number(baht); if (!Number.isFinite(n)) return 0; return Math.round(n * 100); }",
    'function fromSatang(satang) { return Math.round(satang) / 100; }',
    extractFunction(src, 'itemLevelDiscountPercent'),
    extractFunction(src, 'effectiveUnitPrice'),
    'return { effectiveUnitPrice, itemLevelDiscountPercent };',
  ].join('\n');
  const mod = new Function(fnSrc)();
  const { effectiveUnitPrice, itemLevelDiscountPercent } = mod;

  console.log('A) frontend utils/money.ts matches the baht-rounding price contract:');
  const cases = [
    // [ชื่อเคส, สินค้า, ราคาที่คาด, % ที่คาด]
    ['ใกล้หมดอายุ 50% ราคามีสตางค์ → 19.90 → 9.90 (ปัดบาท)', { price: 19.90, expiry_status: 'near_expiry', discount_percent: 50 }, 9.90, 50],
    ['ใกล้หมดอายุ 50% → 5.55 → 2.55', { price: 5.55, expiry_status: 'near_expiry', discount_percent: 50 }, 2.55, 50],
    ['ใกล้หมดอายุ 30% → 33.33 → 23.33', { price: 33.33, expiry_status: 'near_expiry', discount_percent: 30 }, 23.33, 30],
    ['โปร 25% → 100 → 75', { price: 100, promo_active: true, promo_percent: 25 }, 75, 25],
    ['ใกล้หมดอายุ 40% + โปร 50% → ใช้ BEST 50% → 19.90 → 9.90', { price: 19.90, expiry_status: 'near_expiry', discount_percent: 40, promo_active: true, promo_percent: 50 }, 9.90, 50],
    ['ไม่มีโปร/ใกล้หมดอายุ → ราคาเต็ม', { price: 45.5, expiry_status: 'ok' }, 45.5, 0],
    ['expired → ไม่มีส่วนลด (ราคาเต็ม)', { price: 20, expiry_status: 'expired', discount_percent: 40 }, 20, 0],
    ['near_expiry แต่ discount_percent=0 → ราคาเต็ม', { price: 20, expiry_status: 'near_expiry', discount_percent: 0 }, 20, 0],
  ];
  for (const [name, prod, expPrice, expPct] of cases) {
    const price = effectiveUnitPrice(prod);
    const pct = itemLevelDiscountPercent(prod);
    check(`${name} (ได้ ${price}, ${pct}%)`, price === expPrice && pct === expPct);
  }

  // ── ส่วน B: backend ยังใช้สูตรปัดบาท + frontend ไม่กลับไปปัดสตางค์ ─────────────────────────
  console.log('B) backend stays on baht-rounding, frontend does not drift back to satang-rounding:');
  const serverPath = path.join(__dirname, '..', 'server.js');
  const srv = fs.readFileSync(serverPath, 'utf8');
  check('checkout ใช้ Math.round(itemPrice * bestDiscPct / 100)', srv.includes('Math.round(itemPrice * bestDiscPct / 100)'));
  check('orders ใช้ Math.round(unitPrice * discPct / 100)', srv.includes('Math.round(unitPrice * discPct / 100)'));
  check('/api/products enrichment ใช้ Math.round(p.price * p.discount_percent / 100)', srv.includes('Math.round(p.price * p.discount_percent / 100)'));
  // จับ drift กลับ: ถ้ามีใครแก้ frontend กลับไปใช้ปัดสตางค์ (สาเหตุของบั๊กเดิม) เทสต์นี้ fail ทันที
  // ตัด comment ออกก่อนเช็ค (คอมเมนต์อ้างสูตรเก่าได้ แต่โค้ดจริงห้ามมี)
  const codeOnly = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  check('frontend ไม่มีสูตรปัดสตางค์แบบเก่า (Math.round(toSatang(price) * pct / 100))', !codeOnly.includes('Math.round(toSatang(price) * pct / 100)'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
