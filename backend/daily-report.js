// ⭐️ Sprint 1 — D4: daily reconciliation report — shifts closed, total sales, cash, variance.
// Runs via cron at 6am (server.js, before the shop opens) and mails ADMIN_EMAIL. Also reachable
// manually via POST /api/reports/daily/send (ADMIN only) for testing without waiting for 6am.

const pool = require('./db');
const { toSatang, fromSatang } = require('./money');
const { sendMail } = require('./mailer');

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
function getYesterdayBangkok() {
  const now = new Date();
  const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: TZ_BANGKOK }));
  const yesterday = new Date(bangkokTime.getFullYear(), bangkokTime.getMonth(), bangkokTime.getDate());
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday;
}

// Pulls shifts closed + sales completed within [targetDateStr 00:00 UTC, +1 day 00:00 UTC).
// Defaults to "yesterday" (Bangkok time), matching the 6am-before-open use case.
async function generateDailyReportData(targetDateStr) {
  let dateStr = targetDateStr;
  if (!dateStr) {
    dateStr = toDateStr(getYesterdayBangkok());
  }

  // Convert Bangkok date to UTC range for database query
  const reportDateUTC = new Date(dateStr + 'T00:00:00Z');
  const nextDateUTC = new Date(dateStr);
  nextDateUTC.setDate(nextDateUTC.getDate() + 1);
  const nextDateUTCStr = nextDateUTC.toISOString();

  const [shifts] = await pool.query(
    `SELECT sh.id, sh.cashier_id, u.full_name AS cashier_name,
            sh.opening_cash, sh.expected_cash, sh.actual_cash, sh.difference,
            sh.discrepancy_flag, sh.discrepancy_category, sh.status,
            DATE_FORMAT(CONVERT_TZ(sh.closed_at, '+00:00', '+07:00'), '%Y-%m-%d %H:%i:%s') as closed_at_bkk
     FROM shifts sh
     JOIN users u ON u.id = sh.cashier_id
     WHERE sh.status IN ('CLOSED', 'PENDING_APPROVAL')
       AND sh.closed_at >= ? AND sh.closed_at < ?
     ORDER BY sh.closed_at ASC`,
    [reportDateUTC, nextDateUTC]
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
    [reportDateUTC, nextDateUTC]
  );

  const [voidRows] = await pool.query(
    `SELECT COUNT(*) AS void_count, COALESCE(SUM(total_amount), 0) AS void_total
     FROM sales
     WHERE status = 'VOIDED' AND created_at >= ? AND created_at < ?`,
    [reportDateUTC, nextDateUTC]
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
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${s.status === 'PENDING_APPROVAL' ? '⚠️ รออนุมัติ' : 'ปิดแล้ว'}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" style="padding:12px;text-align:center;color:#999;">ไม่มีกะที่ปิดในวันนี้</td></tr>`;

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
      <tr><td style="padding:8px 0 4px;color:#666;border-top:1px solid #eee;">กะที่ปิดวันนี้</td><td style="text-align:right;font-weight:bold;border-top:1px solid #eee;">${data.shift_count} กะ</td></tr>
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
  const to = process.env.ADMIN_EMAIL;
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

module.exports = { generateDailyReportData, buildReportHtml, sendDailyReport };
