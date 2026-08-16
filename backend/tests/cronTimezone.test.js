// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 tests/cronTimezone.test.js — regression: cron schedules ใน server.js ต้องเขียนเป็นโซน
//    UTC (process รันโซน UTC บน Render) และยิงตรงเวลาไทยที่เจตนา
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร / ทำไมมีไฟล์นี้:
//   node-cron รันตาม local time ของ process — production รัน UTC ดังนั้น schedule จึงต้อง
//   เขียนเป็น UTC + comment ระบุเวลาไทย (convention เดียวกับ backup 19:00 UTC = ตี 2 ไทย,
//   low-stock 10:00 UTC = 17:00 ไทย) — แต่เคยมีบัค: daily report เขียน '0 6 * * *' (= 06:00
//   UTC = บ่ายโมงไทย) ทั้งที่เจตนา "ตี 6" รายงานไปถึงหลังร้านเปิด ไฟล์นี้กันบัคแบบนั้นกลับมา
//   โดย:
//     ส่วน A) ตาราง CRONS (schedule + เวลาไทยที่เจตนา) → เช็คว่าแปลง UTC→ไทยตรงกันทุกตัว
//     ส่วน B) อ่าน server.js จริง แยก cron.schedule(...) ทั้งหมด → ต้องตรงกับตารางครบทั้ง
//             สองทิศ (แก้ schedule แล้วลืมอัปเดตตาราง = fail ทันที)
//     ส่วน C) เช็คตรงๆ ว่า daily report ไม่กลับไปเป็น '0 6 * * *' (บัคเดิม)
//     ส่วน D) ทุก cron.schedule ต้องมี comment กำกับเวลาไทย ("เวลาไทย" / "ตี X" / "ทุกชั่วโมง")
//             อยู่เหนือตัว cron — กันเพิ่ม cron ใหม่โดยไม่ระบุเวลาจริง
//   ไม่ต้องต่อ DB — รันได้เร็ว ; รันด้วย: node tests/cronTimezone.test.js
//   ⚠️ ถ้าจะเพิ่ม/แก้ cron ใน server.js ต้องอัปเดตตาราง CRONS ที่นี่ด้วย (ส่วน B จะบังคับ)
// ═══════════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

// ── ตาราง cron ทั้งหมดใน server.js ─────────────────────────────────────────────────
// schedule = ค่าที่เขียนใน cron.schedule(...) (โซน UTC — process รัน UTC)
// thai     = เวลาไทยที่เจตนา ('HH:MM') หรือ null สำหรับ cron รายชั่วโมงที่ไม่มีเวลาตายตัว
const CRONS = [
  { key: 'backup',           schedule: '0 19 * * *',  thai: '02:00' }, // ตี 2 (วันถัดไป)
  { key: 'auto-checkout',    schedule: '5 0 * * *',   thai: '07:05' }, // เช้าก่อนร้านเปิด
  { key: 'daily-report',     schedule: '0 23 * * *',  thai: '06:00' }, // ตี 6 = 23:00 UTC วันก่อน
  { key: 'revoked-cleanup',  schedule: '30 19 * * *', thai: '02:30' }, // ตี 2 ครึ่ง
  { key: 'low-stock-line',   schedule: '0 10 * * *',  thai: '17:00' }, // บ่าย 5
  { key: 'expired-products', schedule: '0 * * * *',   thai: null },    // รายชั่วโมง
  { key: 'pickup-reminder',  schedule: '0 * * * *',   thai: null },    // รายชั่วโมง
];

// แปลง 'min hour * * *' (โซน UTC) → 'HH:MM' เวลาไทย (UTC+7 — ไทยไม่มี DST)
// ใช้ Date.UTC + ตัวเลขล้วน (ไม่มี locale เกี่ยวข้อง) กำหนดวันสมมติ 1 ม.ค. 2026
function cronToBangkok(expr) {
  const [min, hour] = expr.split(' ').map(Number);
  const utcMs = Date.UTC(2026, 0, 1, hour, min, 0) + 7 * 3600 * 1000;
  const d = new Date(utcMs);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// ── ส่วน A: schedule → เวลาไทยต้องตรงเจตนา ─────────────────────────────────────────
console.log('A) แปลง UTC → เวลาไทย ตรงกับที่เจตนา:');
for (const c of CRONS) {
  if (!c.thai) continue;
  check(`"${c.key}" '${c.schedule}' → ${c.thai} ไทย`, cronToBangkok(c.schedule) === c.thai);
}

// ── ส่วน A2: cron รายชั่วโมงต้องเป็น top-of-hour (นาที = 0) ─────────────────────────
for (const c of CRONS.filter(x => !x.thai)) {
  check(`"${c.key}" รายชั่วโมง top-of-hour (นาที=0)`, c.schedule.split(' ')[0] === '0');
}

// ── ส่วน B (regression หลัก): ทุก cron.schedule ใน server.js ต้องตรงตาราง ───────────
console.log('B) cron.schedule ใน server.js ตรงกับตาราง CRONS:');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const found = [...src.matchAll(/cron\.schedule\(\s*'([^']+)'/g)].map(m => m[1]);
  const foundSet = new Set(found);
  const mappedSet = new Set(CRONS.map(c => c.schedule));

  check(`server.js มี cron.schedule ${found.length} จุด`, found.length > 0);
  check('schedule ใน server.js ทุกตัวมีอยู่ในตาราง CRONS', [...foundSet].every(s => mappedSet.has(s)));
  check('schedule ในตาราง CRONS ทุกตัวมีอยู่ใน server.js', [...mappedSet].every(s => foundSet.has(s)));
}

// ── ส่วน C: กันบัค daily report กลับมา (เขียน '0 6 * * *' = 06:00 UTC = บ่ายโมงไทย) ──
// ⚠️ ต้องอ่านจาก server.js จริง ไม่ใช่จากตาราง (ตาราง self-consistent เสมอ แก้เองก็ผ่าน) —
// หา cron.schedule ตัวสุดท้ายก่อนบรรทัดที่เรียก sendDailyReport() = ตัว daily report พอดี
console.log('C) daily report ไม่กลับไปเป็น schedule ผิดโซนเดิม (อ่านจาก server.js):');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const callIdx = src.indexOf('sendDailyReport();');
  const match = [...src.slice(0, callIdx).matchAll(/cron\.schedule\(\s*'([^']+)'/g)].pop();
  const dailySchedule = match ? match[1] : null;
  check('พบ cron.schedule ที่เรียก sendDailyReport', !!dailySchedule);
  check('daily-report ไม่ใช่ "0 6 * * *" (บัคเดิม = 06:00 UTC = 13:00 ไทย)', dailySchedule !== '0 6 * * *');
  check('daily-report ยิงตอน 06:00 ไทยจริง', dailySchedule ? cronToBangkok(dailySchedule) === '06:00' : false);
}

// ── ส่วน D: ทุก cron.schedule ต้องมี comment กำกับเวลาไทย (กันเพิ่ม cron ใหม่แล้วไม่ระบุ
//    เวลาจริง — การ์ดเดียวกับที่จับ daily report เดิม แต่บังคับที่จุดเขียนโค้ดเลย) ───────────
// ตรวจเฉพาะ comment บรรทัด // ที่อยู่ "ระหว่าง cron ก่อนหน้ากับ cron นี้" (กันท้าย comment ของ cron
// ก่อนหน้าไหลเข้ามาเป็น false positive — ตัว cron แรกใช้ window 12 บรรทัดบนสุด) ว่ามีตัวบ่งชี้เวลาอย่างใดอย่างหนึ่ง:
//   • "เวลาไทย" (ครอบ "HH:MM น. เวลาไทย" / "ตี 2 เวลาไทย")
//   • "ตี \d" (ตี 2 / ตี 6)
//   • "ทุกชั่วโมง" / "รายชั่วโมง" (cron รายชั่วโมง — ไม่มีเวลาตายตัว)
//   • "HH:MM น." (เช่น "17:00 น.")
console.log('D) comment กำกับเวลาไทยข้างๆ cron.schedule ทุกตัว (อ่านจาก server.js):');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const lines = src.split('\n');
  const MARKER = /เวลาไทย|ตี \d|ทุกชั่วโมง|รายชั่วโมง|\d{1,2}:\d{2}\s*น\./;
  const matches = [...src.matchAll(/cron\.schedule\(\s*'([^']+)'/g)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const lineIdx = src.slice(0, m.index).split('\n').length - 1; // 0-based
    let startLine;
    if (i === 0) {
      startLine = Math.max(0, lineIdx - 12); // ตัวแรก: window บนสุด (ไม่มี cron ก่อนหน้า)
    } else {
      const prevLineIdx = src.slice(0, matches[i - 1].index).split('\n').length - 1;
      startLine = prevLineIdx + 1; // ตั้งแต่บรรทัดถัดจาก cron ก่อนหน้า (comment ของ cron ก่อนหน้าไม่ปน)
    }
    const windowLines = lines.slice(startLine, lineIdx);
    const commentLines = windowLines.filter(l => l.trim().startsWith('//'));
    const hasMarker = commentLines.some(l => MARKER.test(l));
    check(`cron '${m[1]}' (L${lineIdx + 1}) มี comment กำกับเวลาไทย`, hasMarker);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
