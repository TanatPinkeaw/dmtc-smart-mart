#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 scripts/run-all-tests.js — รันเทส backend ทั้ง 8 ชุดในคำสั่งเดียว (รองรับ 2 สไตล์)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำไมต้องมี: backend มีเทส 2 สไตล์ปนกัน — node:test (member-groups/reward/sync-offline/
//   richmenu) กับ custom harness เดิม (contract/price/cron/daily ที่นับ pass/fail เอง + ลงท้าย
//   process.exit(fail ? 1 : 0)) — ตัว runner นี้ครอบทั้งคู่โดย spawn แต่ละชุดเป็น process แล้ว
//   เช็ค exit code (node:test คืน 0/1 ถูกต้องอยู่แล้ว + harness ทุกตัวก็ exit 0/1 ตาม fail)
//   พร้อมสรุปท้าย + exit ตามผลรวม
//
// รันด้วย: npm run test:unit
//   ตัวเลือก: node scripts/run-all-tests.js price cron   (รันเฉพาะชุดที่ระบุ)
//            node scripts/run-all-tests.js --fail-fast    (หยุดทันทีเมื่อชุดแรก fail)
//   หมายเหตุ: smokeTest.js (E2E ต้องใช้ DB จริง) ไม่รวมในนี้ — รันแยกผ่าน `npm test`/CI job ของมัน
// ═══════════════════════════════════════════════════════════════════════════════════
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// ⭐️ รายการชุดเทส (name = อ้างอิงใน arg / script npm) — เพิ่มชุดใหม่แค่เติมบรรทัดเดียว
const SUITES = [
  { name: 'contract',     file: 'tests/checkoutContract.test.js' },
  { name: 'price',        file: 'tests/priceContract.test.js' },
  { name: 'cron',         file: 'tests/cronTimezone.test.js' },
  { name: 'daily',        file: 'tests/dailyReport.test.js' },
  { name: 'member-groups', file: 'tests/memberGroups.test.js' },
  { name: 'reward',       file: 'tests/rewardRedemption.test.js' },
  { name: 'sync-offline', file: 'tests/syncOfflineContract.test.js' },
  { name: 'preorder-policy', file: 'tests/preorderPolicy.test.js' },
  { name: 'order-realtime',  file: 'tests/orderRealtime.test.js' },
  { name: 'richmenu',     file: 'src/scripts/setup-richmenu.test.js' },
];

const args = process.argv.slice(2);
const failFast = args.includes('--fail-fast');
const requested = args.filter(a => !a.startsWith('--'));

// ตรวจชื่อชุดที่ระบุ — ถ้าไม่รู้จัก เตือนก่อน (กันพิมพ์ผิดแล้วรันน้อยกว่าที่คิด)
const unknown = requested.filter(name => !SUITES.some(s => s.name === name));
if (unknown.length > 0) {
  console.error(`❌ ไม่รู้จักชุดเทส: ${unknown.join(', ')}`);
  console.error(`   ชุดที่มี: ${SUITES.map(s => s.name).join(', ')}`);
  process.exit(2);
}

const suites = requested.length > 0
  ? SUITES.filter(s => requested.includes(s.name))
  : SUITES;

console.log(`▶ รัน ${suites.length} ชุด: ${suites.map(s => s.name).join(', ')}`);
console.log('══════════════════════════════════════════════');

const results = [];
for (const s of suites) {
  console.log(`\n━━━ ${s.name} (${s.file}) ━━━`);
  // stdio:'inherit' ให้ output ของแต่ละชุด (✓/✗ หรือ ℹ node:test) แสดงตรงๆ เหมือนรันเดี่ยว
  const r = spawnSync(process.execPath, [s.file], { cwd: ROOT, stdio: 'inherit' });
  const ok = r.status === 0;
  results.push({ name: s.name, ok, detail: r.status === null ? `signal ${r.signal}` : `exit ${r.status}` });
  if (!ok && failFast) {
    console.error(`\n⛔ fail-fast — หยุดที่ชุด ${s.name} ไม่รันชุดที่เหลือ`);
    break;
  }
}

const failed = results.filter(r => !r.ok);
console.log('\n════════ สรุปผล ════════');
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : ` (${r.detail})`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} ชุดผ่าน` + (failed.length ? ` — ล้มเหลว: ${failed.map(f => f.name).join(', ')}` : ''));
process.exit(failed.length ? 1 : 0);
