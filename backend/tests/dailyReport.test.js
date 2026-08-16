// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/dailyReport.test.js — unit test ของ getYesterdayBangkok (วันรายงานของ daily report)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร / ทำไมมีไฟล์นี้:
//   dailyReport คำนวณ "เมื่อวาน" ด้วย getYesterdayBangkok() (ตอน cron 06:00 ไทย) — ถ้าคำนวณผิด
//   วัน รายงานสรุปยอดประจำวันจะสรุปคนละวันกับที่ควร (เช่น ต้นเดือน/ข้ามปี/เช้ามืดที่ UTC ยังเป็น
//   เมื่อวาน) ไฟล์นี้ยิงวันที่จำลองผ่าน param `now` (เพิ่มให้เทสได้ ไม่ต้อง mock Date) ครอบ
//   edge cases ที่เคยเสี่ยง:
//     • เช้ามืด 06:00 BKK (= 23:00 UTC ของวันก่อน) — ต้องยังเป็น "เมื่อวาน" ตามปฏิทินไทย ไม่ใช่
//       วันก่อนหน้านั้น (กรณีนี้แหละที่บัค toISOString แบบ UTC เคยเพี้ยน)
//     • ต้นเดือน / ต้นปี — ต้องข้ามเดือน/ข้ามปีถูกต้อง
//     • ปีอธิกสุรทิน (ก.พ. 29 วัน)
//   ไม่ต้องต่อ DB — รันได้เร็ว ; รันด้วย: node tests/dailyReport.test.js
//   หมายเหตุ: ผลลัพธ์เป็นวันปฏิทินไทยล้วน (ไม่ขึ้นกับ timezone ของ process ที่รันเทส)
// ═══════════════════════════════════════════════════════════════════════════════════
const { getYesterdayBangkok, toDateStr } = require('../src/scripts/dailyReport');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

// สร้าง "ตอนนี้" จำลองเป็นเวลาไทย (เขียนด้วย offset +07:00 ให้ชัด ไม่ขึ้นกับ TZ ของ process)
const at = (iso) => new Date(iso);
const y = (now) => toDateStr(getYesterdayBangkok(now));

console.log('A) เช้ามืด (UTC ยังเป็นวันก่อน — จุดที่เคยเพี้ยน):');
check('16 ส.ค. 06:00 BKK (= 15 ส.ค. 23:00 UTC) → เมื่อวาน = 2026-08-15', y(at('2026-08-16T06:00:00+07:00')) === '2026-08-15');
check('16 ส.ค. 00:30 BKK (หลังเที่ยงคืนไทย) → เมื่อวาน = 2026-08-15', y(at('2026-08-16T00:30:00+07:00')) === '2026-08-15');

console.log('B) กลางวันปกติ:');
check('16 ส.ค. 10:00 BKK → เมื่อวาน = 2026-08-15', y(at('2026-08-16T10:00:00+07:00')) === '2026-08-15');
check('16 ส.ค. 23:59 BKK → เมื่อวาน = 2026-08-15', y(at('2026-08-16T23:59:00+07:00')) === '2026-08-15');

console.log('C) ต้นเดือน (ข้ามเดือน):');
check('1 ส.ค. 08:00 BKK → เมื่อวาน = 2026-07-31', y(at('2026-08-01T08:00:00+07:00')) === '2026-07-31');
check('1 ส.ค. 00:30 BKK → เมื่อวาน = 2026-07-31', y(at('2026-08-01T00:30:00+07:00')) === '2026-07-31');

console.log('D) ต้นปี (ข้ามปี):');
check('1 ม.ค. 08:00 BKK → เมื่อวาน = 2025-12-31', y(at('2026-01-01T08:00:00+07:00')) === '2025-12-31');
check('1 ม.ค. 00:30 BKK → เมื่อวาน = 2025-12-31', y(at('2026-01-01T00:30:00+07:00')) === '2025-12-31');

console.log('E) ปีอธิกสุรทิน (ก.พ. 29 วัน):');
check('1 มี.ค. 2024 08:00 BKK → เมื่อวาน = 2024-02-29', y(at('2024-03-01T08:00:00+07:00')) === '2024-02-29');
check('29 ก.พ. 2024 08:00 BKK → เมื่อวาน = 2024-02-28', y(at('2024-02-29T08:00:00+07:00')) === '2024-02-28');

console.log('F) คืนค่าเป็น Date + รูปแบบ YYYY-MM-DD:');
check('ผลลัพธ์เป็น Date ที่ถูกต้อง', !isNaN(getYesterdayBangkok(at('2026-08-16T06:00:00+07:00')).getTime()));
check('toDateStr ให้ YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(toDateStr(getYesterdayBangkok(at('2026-08-16T06:00:00+07:00')))));

console.log('G) เรียกแบบไม่ส่ง arg (production path — ใช้เวลาจริง):');
{
  const nowBKK = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const expected = new Date(nowBKK.getFullYear(), nowBKK.getMonth(), nowBKK.getDate());
  expected.setDate(expected.getDate() - 1);
  check('ไม่ส่ง arg → เป็นเมื่อวานตามเวลาไทยจริง', toDateStr(getYesterdayBangkok()) === toDateStr(expected));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
