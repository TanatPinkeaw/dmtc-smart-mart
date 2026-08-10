// ⭐️ Phase A (refactor) — ย้าย report endpoints ออกจาก server.js (ที่โตเป็น ~6000 บรรทัด) มาเป็น
// โมดูลตามโดเมน ให้หาโค้ด/ดูแลง่ายขึ้น — ย้ายทีละ batch เล็ก ไม่เปลี่ยนพฤติกรรม/ไม่เปลี่ยน path ใดๆ
// (mount ที่ /api/reports ใน server.js) แต่ละ handler ยกมาจาก server.js ตรงๆ dependency require จาก
// module กลางเดียวกับที่ server.js ใช้ (pool, money utils) กัน logic เพี้ยนไปคนละแบบ
const pool = require('../config/db');
const { toSatang, fromSatang } = require('../utils/money');

// GET /api/reports/weekly-sales — ยอดขายรวม (POS + พรีออเดอร์) รายวัน ย้อนหลัง 7 วัน
async function weeklySales(req, res) {
  try {
    // 🐛 FIX (round 3 — root cause) — created_at/completed_at เป็น TIMESTAMP และ db.js บังคับ
    // SET time_zone='+07:00' ทุก connection แล้ว → MySQL คืนค่าเป็นเวลาไทยตั้งแต่ตอนอ่านอยู่แล้ว
    // การใส่ CONVERT_TZ(...,'+00:00','+07:00') ซ้ำ (round 1-2) = แปลงเวลาซ้ำ บวก 7 ชม.เกิน ทำให้บิล
    // ช่วงเย็นเลื่อนไปนับเป็นวันถัดไป (กราฟเพี้ยน 1 วัน) และ Peak Hours โชว์ 22:00 แทน 15:00
    // ควรใช้ created_at ตรงๆ ให้ตรงกับ query อื่นในไฟล์นี้ที่ทำถูกอยู่แล้ว (dashboard วันนี้/sales-channel/
    // comparison ล้วนใช้ DATE(created_at)=CURDATE() ไม่มี CONVERT_TZ) — CURDATE()/NOW() ก็เป็นเวลาไทยแล้ว
    // DATE_FORMAT คืน string ตรงๆ (ไม่ผ่าน JS Date object) key จึงตรงกับฝั่ง "7 วันล่าสุด" ที่สร้างเป็น string
    const [rows] = await pool.query(`
      SELECT d, COALESCE(SUM(total), 0) as total FROM (
        SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as d, total_amount as total FROM sales
          WHERE status = 'COMPLETED' AND created_at >= CURDATE() - INTERVAL 7 DAY
        UNION ALL
        SELECT DATE_FORMAT(completed_at, '%Y-%m-%d') as d, total_amount as total FROM orders
          WHERE status = 'COMPLETED' AND completed_at >= CURDATE() - INTERVAL 7 DAY
      ) combined
      GROUP BY d
    `);
    const map = {};
    rows.forEach(r => { map[String(r.d)] = Number(r.total); });
    const DAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    // ⭐️ "วันนี้" อิงเวลาไทย (server อาจรันที่ UTC) ไม่งั้นช่วงเที่ยงคืน–06:59 ไทย จะคำนวณ "วันนี้" ผิด
    // เป็นเมื่อวานของ UTC แล้วกราฟ 7 วันจะเลื่อนวันไปอีกจุดหนึ่ง
    const nowTH = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(nowTH); d.setUTCDate(d.getUTCDate() - i);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      result.push({ date: key, day: DAY_LABELS[d.getUTCDay()], total: map[key] || 0 });
    }
    res.json(result);
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/hourly-sales — Peak Hours: ยอดขายรายชั่วโมง (today/7d/30d, ช่วงหลายวันเฉลี่ยต่อวัน)
async function hourlySales(req, res) {
  try {
    const period = ['today', '7d', '30d'].includes(req.query.period) ? req.query.period : 'today';
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 1;

    // 🐛 FIX (root cause) — created_at/completed_at เป็น TIMESTAMP + db.js บังคับ SET time_zone='+07:00'
    // ทุก connection → MySQL คืนเป็นเวลาไทยตั้งแต่อ่านแล้ว, NOW()/CURDATE() ก็เป็นเวลาไทย ใช้คอลัมน์ตรงๆ
    // ได้เลย เดิมใส่ CONVERT_TZ(...,'+00:00','+07:00') = แปลงซ้ำ บวก 7 ชม.เกิน ทำให้ Peak โชว์ 22:00 แทน
    // 15:00 (บ่าย+7=สี่ทุ่ม) — ตรงกับ dashboard วันนี้/sales-channel ที่ใช้ DATE(created_at)=CURDATE() ถูกอยู่แล้ว
    const dateClauseSales = period === 'today'
      ? `DATE(created_at) = CURDATE()`
      : `created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
    const dateClauseOrders = period === 'today'
      ? `DATE(completed_at) = CURDATE()`
      : `completed_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`;

    const [rows] = await pool.query(`
      SELECT hour, SUM(total) as total, COUNT(DISTINCT day) as day_count
      FROM (
        SELECT HOUR(created_at) as hour,
               DATE(created_at) as day,
               total_amount as total
        FROM sales
        WHERE status='COMPLETED' AND ${dateClauseSales}
        UNION ALL
        SELECT HOUR(completed_at) as hour,
               DATE(completed_at) as day,
               total_amount as total
        FROM orders
        WHERE status='COMPLETED' AND ${dateClauseOrders}
      ) combined
      GROUP BY hour
    `);

    // ⭐️ หารด้วยจำนวนวันที่มีข้อมูลจริงทั้งช่วง (ไม่ใช่จำนวนวันที่ชั่วโมงนั้นมียอด) กันเฉลี่ยเพี้ยน
    // ถ้าช่วงนั้นมีแค่บางวันที่ขายของช่วงเช้า — ใช้จำนวนวันที่ "มีบิลอย่างน้อย 1 ใบทั้งวัน" เป็นตัวหาร
    const [[{ active_days } = { active_days: 0 }]] = await pool.query(`
      SELECT COUNT(DISTINCT day) as active_days FROM (
        SELECT DATE(created_at) as day FROM sales WHERE status='COMPLETED' AND ${dateClauseSales}
        UNION
        SELECT DATE(completed_at) as day FROM orders WHERE status='COMPLETED' AND ${dateClauseOrders}
      ) d
    `);
    const divisor = period === 'today' ? 1 : Math.max(1, Number(active_days));

    const map = {};
    rows.forEach(r => { map[r.hour] = Number(r.total); });
    const result = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: fromSatang(Math.round(toSatang(map[h] || 0) / divisor)) }));
    const peakHour = result.reduce((peak, cur) => (cur.total > peak.total ? cur : peak), result[0]).hour;

    res.json({ period, hourly: result, peak_hour: peakHour, averaged_over_days: divisor });
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

module.exports = { weeklySales, hourlySales };
