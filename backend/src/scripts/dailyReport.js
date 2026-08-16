// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 scripts/dailyReport.js — สร้าง+ส่งอีเมลรายงานสรุปยอดประจำวัน (กระทบยอดเงินสด/กะ)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: sendDailyReport(date) รวมข้อมูลของวัน (กะที่ปิด, ยอดขายรวม, เงินสด, เงินขาด/เกิน) แล้วส่ง
//   อีเมลหา ADMIN_EMAIL ผ่าน mailer.js — รันอัตโนมัติทุกวัน 6 โมงเช้าผ่าน cron (ใน server.js) หรือกดยิงเอง
//   ผ่าน POST /api/reports/daily/send (ADMIN) เพื่อทดสอบโดยไม่ต้องรอ cron
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Sprint 1 — D4: daily reconciliation report — shifts closed, total sales, cash, variance.
// Runs via cron at 6am (server.js, before the shop opens) and mails ADMIN_EMAIL. Also reachable
// manually via POST /api/reports/daily/send (ADMIN only) for testing without waiting for 6am.

const pool = require('../config/db');
const { toSatang, fromSatang } = require('../utils/money');
const { sendMail } = require('../services/mailer');
const { ADMIN_EMAIL } = require('../config/config');

// ⭐️ Sprint 2 — B8: Timezone Constants (Bangkok UTC+7)
const TZ_BANGKOK = 'Asia/Bangkok';

// yyyy-mm-dd in Bangkok timezone
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Get yesterday's date in Bangkok timezone
// ⭐️ รับ now เป็น param ได้ (default = ตอนนี้) — ให้เทสหน่วยส่งวันที่จำลองได้โดยไม่ต้อง mock Date
function getYesterdayBangkok(now = new Date()) {
  const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: TZ_BANGKOK }));
  const yesterday = new Date(bangkokTime.getFullYear(), bangkokTime.getMonth(), bangkokTime.getDate());
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday;
}

// Pulls shifts closed + sales completed within [targetDateStr 00:00:00 Thai, next day 00:00:00 Thai).
// Defaults to "yesterday" (Bangkok time), matching the 6am-before-open use case.
async function generateDailyReportData(targetDateStr) {
  let dateStr = targetDateStr;
  if (!dateStr) {
    dateStr = toDateStr(getYesterdayBangkok());
  }

  // 🐛 FIX (root cause) — เดิมส่ง JS Date เป็น param แล้ว mysql2 (sql-escaper) แปลงตาม timezone config
  // ของ pool ('+07:00') → new Date('YYYY-MM-DDT00:00:00Z') กลายเป็น '... 07:00:00' ซึ่ง MySQL อ่านใน
  // session tz (+07:00) ได้หน้าต่าง [07:00 ของวัน, 07:00 ของวันถัดไป) = เที่ยงคืนไทยเพี้ยนไป 7 ชม.
  // (ยอดช่วง 00:00–07:00 ของวันรายงานหาย, ของวันถัดไปช่วงเดียวกันถูกนับเข้ามา) — ส่ง string เวลาไทย
  // ตรงๆ [วัน 00:00:00, วันถัดไป 00:00:00) ให้ตรงกับ session tz +07:00 (pattern เดียวกับ
  // DATE(created_at)=CURDATE() ที่ใช้ในรายงานอื่น)
  const startDateStr = `${dateStr} 00:00:00`;
  const nextDate = new Date(dateStr + 'T00:00:00Z');
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const endDateStr = `${nextDate.toISOString().slice(0, 10)} 00:00:00`;

  const [shifts] = await pool.query(
    `SELECT sh.id, sh.cashier_id, u.full_name AS cashier_name,
            sh.opening_cash, sh.expected_cash, sh.actual_cash, sh.difference,
            sh.discrepancy_flag, sh.discrepancy_category, sh.status,
            // 🐛 FIX (root cause) — closed_at เป็น TIMESTAMP + pool ตั้ง SET time_zone='+07:00' ทุก
            // connection แล้ว MySQL คืนเป็นเวลาไทยตั้งแต่อ่านแล้ว CONVERT_TZ เดิมแปลงซ้ำ บวก 7 ชม.เกิน
            // 🐛 FIX — enum เดิมเป็น 'PENDING_APPROVAL' ที่ไม่มีจริง (จริงคือ PENDING_CLOSE) → กะที่รอ
            // อนุมัติไม่เคยโชว์ในรายงาน + PENDING_CLOSE ยังไม่มี closed_at (ตั้งตอน approve) จึงนับวัน
            // ตาม opened_at และใช้ COALESCE สำหรับเรียง/แสดง
            DATE_FORMAT(COALESCE(sh.closed_at, sh.opened_at), '%Y-%m-%d %H:%i:%s') as closed_at_bkk
     FROM shifts sh
     JOIN users u ON u.id = sh.cashier_id
     WHERE sh.status IN ('CLOSED', 'PENDING_CLOSE')
       AND (
         (sh.status = 'CLOSED' AND sh.closed_at >= ? AND sh.closed_at < ?)
         OR (sh.status = 'PENDING_CLOSE' AND sh.opened_at >= ? AND sh.opened_at < ?)
       )
     ORDER BY COALESCE(sh.closed_at, sh.opened_at) ASC`,
    [startDateStr, endDateStr, startDateStr, endDateStr]
  );

  const [salesRows] = await pool.query(
    `SELECT
       COUNT(*) AS bill_count,
       COALESCE(SUM(total_amount), 0) AS total_sales,
       COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END), 0) AS cash_sales,
       COALESCE(SUM(CASE WHEN payment_method = 'QR' THEN total_amount ELSE 0 END), 0) AS qr_sales,
       COALESCE(SUM(CASE WHEN payment_method NOT IN ('CASH','QR') THEN total_amount ELSE 0 END), 0) AS other_sales
     FROM sales
     WHERE status = 'COMPLETED' AND created_at >= ? AND created_at < ?`,
    [startDateStr, endDateStr]
  );

  const [voidRows] = await pool.query(
    `SELECT COUNT(*) AS void_count, COALESCE(SUM(total_amount), 0) AS void_total
     FROM sales
     WHERE status = 'VOIDED' AND created_at >= ? AND created_at < ?`,
    [startDateStr, endDateStr]
  );

  const sales = salesRows[0];
  const voided = voidRows[0];

  // ⭐️ B3 — variance in satang space, same pattern as /api/shifts/close, to avoid float drift
  // when summing many shifts' differences together.
  const discrepantShifts = shifts.filter(s => Number(s.discrepancy_flag) === 1);
  const totalVarianceSatang = shifts.reduce((sum, s) => sum + Math.abs(toSatang(s.difference)), 0);

  return {
    date: dateStr,
    shifts,
    shift_count: shifts.length,
    discrepancy_count: discrepantShifts.length,
    total_variance: fromSatang(totalVarianceSatang),
    bill_count: Number(sales.bill_count),
    total_sales: Number(sales.total_sales),
    cash_sales: Number(sales.cash_sales),
    qr_sales: Number(sales.qr_sales),
    other_sales: Number(sales.other_sales),
    void_count: Number(voided.void_count),
    void_total: Number(voided.void_total),
  };
}

function baht(n) {
  return `฿${Number(n).toFixed(2)}`;
}

function buildReportHtml(data) {
  const shiftRows = data.shifts.length
    ? data.shifts.map(s => `
        <tr style="${Number(s.discrepancy_flag) === 1 ? 'background:#FFF5F5;' : ''}">
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${s.cashier_name}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${baht(s.expected_cash)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${baht(s.actual_cash)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:${Number(s.difference) < 0 ? '#DC2626' : Number(s.difference) > 0 ? '#059669' : '#666'};">
            ${Number(s.difference) > 0 ? '+' : ''}${Number(s.difference).toFixed(2)}
          </td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${s.discrepancy_category || (Number(s.discrepancy_flag) === 1 ? '(ไม่ระบุ)' : '-')}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${s.status === 'PENDING_CLOSE' ? '⚠️ รออนุมัติ' : 'ปิดแล้ว'}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" style="padding:12px;text-align:center;color:#999;">ไม่มีกะที่ปิด/รออนุมัติในวันนี้</td></tr>`;

  return `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#222;">
    <h2 style="color:#F12B6B;margin-bottom:4px;">รายงานสรุปยอดประจำวัน — DMTC Mart</h2>
    <p style="color:#666;margin-top:0;">วันที่ ${data.date}</p>

    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:4px 0;color:#666;">จำนวนบิลขาย</td><td style="text-align:right;font-weight:bold;">${data.bill_count} บิล</td></tr>
      <tr><td style="padding:4px 0;color:#666;">ยอดขายรวม</td><td style="text-align:right;font-weight:bold;">${baht(data.total_sales)}</td></tr>
      <tr><td style="padding:4px 0 4px 16px;color:#999;font-size:13px;">• เงินสด</td><td style="text-align:right;font-size:13px;">${baht(data.cash_sales)}</td></tr>
      <tr><td style="padding:4px 0 4px 16px;color:#999;font-size:13px;">• โอน/QR</td><td style="text-align:right;font-size:13px;">${baht(data.qr_sales)}</td></tr>
      ${Number(data.other_sales) !== 0 ? `<tr><td style="padding:4px 0 4px 16px;color:#999;font-size:13px;">• อื่นๆ</td><td style="text-align:right;font-size:13px;">${baht(data.other_sales)}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#666;">บิลที่ถูก void</td><td style="text-align:right;">${data.void_count} บิล (${baht(data.void_total)})</td></tr>
      <tr><td style="padding:8px 0 4px;color:#666;border-top:1px solid #eee;">กะที่ปิด/รออนุมัติวันนี้</td><td style="text-align:right;font-weight:bold;border-top:1px solid #eee;">${data.shift_count} กะ</td></tr>
      <tr><td style="padding:4px 0;color:${data.discrepancy_count > 0 ? '#DC2626' : '#666'};">กะที่มีส่วนต่างเกินเกณฑ์ (&gt;100 บาท)</td><td style="text-align:right;font-weight:bold;color:${data.discrepancy_count > 0 ? '#DC2626' : '#666'};">${data.discrepancy_count} กะ</td></tr>
      <tr><td style="padding:4px 0;color:#666;">ผลรวมส่วนต่างเงินสดทั้งหมด (absolute)</td><td style="text-align:right;">${baht(data.total_variance)}</td></tr>
    </table>

    <h3 style="font-size:14px;color:#444;margin-bottom:6px;">รายละเอียดการปิดกะ</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#FFF5F7;text-align:left;">
          <th style="padding:6px 10px;">แคชเชียร์</th>
          <th style="padding:6px 10px;text-align:right;">ควรมี</th>
          <th style="padding:6px 10px;text-align:right;">นับได้จริง</th>
          <th style="padding:6px 10px;text-align:right;">ส่วนต่าง</th>
          <th style="padding:6px 10px;">สาเหตุ</th>
          <th style="padding:6px 10px;">สถานะ</th>
        </tr>
      </thead>
      <tbody>${shiftRows}</tbody>
    </table>

    <p style="color:#aaa;font-size:11px;margin-top:20px;">อีเมลนี้ส่งอัตโนมัติทุกวันเวลา 06:00 น. — DMTC Mart</p>
  </div>`;
}

async function sendDailyReport(targetDateStr) {
  const data = await generateDailyReportData(targetDateStr);
  const to = ADMIN_EMAIL;
  if (!to) {
    console.warn('⚠️ Daily report: ไม่พบ ADMIN_EMAIL ใน .env — สร้างรายงานแล้วแต่ไม่ได้ส่ง');
    return { sent: false, data };
  }
  const sent = await sendMail({
    to,
    subject: `รายงานสรุปยอดประจำวัน ${data.date} — DMTC Mart`,
    html: buildReportHtml(data),
  });
  return { sent, data };
}

module.exports = { generateDailyReportData, buildReportHtml, sendDailyReport, getYesterdayBangkok, toDateStr };
