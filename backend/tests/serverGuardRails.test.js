// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/serverGuardRails.test.js — กันบัคที่ล่าพบรอบ 2026-08-17 กลับมา (static contract)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร / ทำไมมีไฟล์นี้:
//   ล่าบัคพบ 3 จุดที่แก้ไปแล้วใน server.js — ไฟล์นี้ล็อกให้ไม่กลับมาเป็น regression:
//     A) MEDIUM — /api/sales/sync-offline ใช้ checkoutLimiter ตัวเดียวกับ /checkout (30 ครั้ง/นาที
//        prod): คิวออฟไลน์ replay บิลค้าง >30 ใบ โดน 429 → queueProcessor ตัดทิ้งถาวร = บิลหลุด.
//        ต้องใช้ limiter แยก (syncOfflineLimiter) + skipFailedRequests + max มากกว่า checkout
//     B) LOW — /api/audit-logs parseInt(page/limit) ไม่มี guard: ?page=abc → offset NaN → 500,
//        ?limit=100000000 → query ยักษ์. ต้อง clamp (page ≥ 1, limit 1–200)
//     C) NIT — socket.on('request_shift_report')  dead code (ไม่มีฝั่งไหน listen) + emit string
//        'error' แทน object — ต้องไม่มีกลับมา
//   ไม่ต้องต่อ DB — อ่าน source server.js แล้วเช็ค pattern (แบบเดียวกับ cronTimezone/undefinedIdentifiers)
// ═══════════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

console.log('A) sync-offline ใช้ limiter แยกจาก checkout:');
const syncRouteLine = serverSrc.split('\n').find(l => l.includes("'/api/sales/sync-offline'"));
check("route /api/sales/sync-offline มีอยู่", !!syncRouteLine);
check("ใช้ syncOfflineLimiter (ไม่ใช่ checkoutLimiter)", !!syncRouteLine && syncRouteLine.includes('syncOfflineLimiter') && !syncRouteLine.includes('checkoutLimiter'));
const checkoutRouteLine = serverSrc.split('\n').find(l => l.includes("'/api/sales/checkout'"));
check("route /api/sales/checkout ยังใช้ checkoutLimiter (ไม่เผลอสลับ)", !!checkoutRouteLine && checkoutRouteLine.includes('checkoutLimiter') && !checkoutRouteLine.includes('syncOfflineLimiter'));

const limiterBlock = serverSrc.slice(serverSrc.indexOf('const syncOfflineLimiter'), serverSrc.indexOf('const syncOfflineLimiter') + 900);
check('syncOfflineLimiter มี skipFailedRequests: true (fail แล้วไม่นับซ้ำ)', /skipFailedRequests:\s*true/.test(limiterBlock));
const syncMaxRaw = limiterBlock.match(/max:\s*([^,\r\n]+),/);
const checkoutBlock = serverSrc.slice(serverSrc.indexOf('const checkoutLimiter'), serverSrc.indexOf('const syncOfflineLimiter'));
const checkoutMaxRaw = checkoutBlock.match(/max:\s*([^,\r\n]+),/);
// เอาเลขตัวแรก (prod max) มาเทียบ: sync ต้องมากกว่า checkout (คิวออฟไลน์ replay ทั้งคิวต้องไม่ตัน)
const syncProdMax = syncMaxRaw ? Number((syncMaxRaw[1].match(/\d+/) || [])[0]) : NaN;
const checkoutProdMax = checkoutMaxRaw ? Number((checkoutMaxRaw[1].match(/\d+/) || [])[0]) : NaN;
check('syncOfflineLimiter.max > checkoutLimiter.max (replay ทั้งคิวต้องไม่ตัน)', Number.isFinite(syncProdMax) && Number.isFinite(checkoutProdMax) && syncProdMax > checkoutProdMax);

console.log('B) /api/audit-logs clamp page/limit:');
const auditLine = serverSrc.split('\n').findIndex(l => l.includes("'/api/audit-logs'"));
const auditBlock = serverSrc.split('\n').slice(auditLine, auditLine + 40).join('\n');
check('page clamp อยู่ (Math.max(1, parseInt(req.query.page', /Math\.max\(1,\s*parseInt\(req\.query\.page/.test(auditBlock));
check('limit clamp อยู่ (Math.min(200, Math.max(1, parseInt(req.query.limit', /Math\.min\(200,\s*Math\.max\(1,\s*parseInt\(req\.query\.limit/.test(auditBlock));
check('ไม่เหลือ parseInt(page) แบบเปล่า (NaN ได้)', !/parseInt\(page\)/.test(auditBlock));
check('ไม่เหลือ parseInt(limit) แบบเปล่า (NaN ได้)', !/parseInt\(limit\)/.test(auditBlock));
check('ไม่มี parseInt(limit) ใน params.push', !/params\.push\(parseInt\(limit\)/.test(auditBlock));

console.log('C) dead socket ถูกถอน:');
check("ไม่มี socket.on('request_shift_report')", !/socket\.on\('request_shift_report'/.test(serverSrc));
check("ไม่มี socket.emit('shift_report_ack')", !/socket\.emit\('shift_report_ack'/.test(serverSrc));

console.log(`\n${fail === 0 ? '✅' : '❌'} serverGuardRails: ${pass} ผ่าน, ${fail} ไม่ผ่าน`);
process.exit(fail ? 1 : 0);
