// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 controllers/reportController.js — logic ของทุกหน้ารายงาน/สรุปยอด/ส่งออกไฟล์
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: รวม handler ของ endpoint /api/reports/* ทั้งหมด (~26 ตัว) เช่น dashboard, weekly-sales,
//   hourly-sales (Peak Hours), profit-summary, payroll, export CSV/Excel, สรุปบัญชีสหกรณ์ — ดู routes/reportRoutes.js
// จุดสำคัญ: created_at/completed_at เป็น TIMESTAMP + pool ตั้ง tz +07:00 → ใช้คอลัมน์/CURDATE ตรงๆ
//   "ห้าม" ใส่ CONVERT_TZ ซ้ำ (จะบวก 7 ชม.เกิน เพี้ยนวัน/ชั่วโมง — เคยเป็นบั๊กมาแล้ว)
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Phase A (refactor) — ย้าย report endpoints ออกจาก server.js (ที่โตเป็น ~6000 บรรทัด) มาเป็น
// โมดูลตามโดเมน ให้หาโค้ด/ดูแลง่ายขึ้น — ย้ายทีละ batch เล็ก ไม่เปลี่ยนพฤติกรรม/ไม่เปลี่ยน path ใดๆ
// (mount ที่ /api/reports ใน server.js) แต่ละ handler ยกมาจาก server.js ตรงๆ dependency require จาก
// module กลางเดียวกับที่ server.js ใช้ (pool, money utils) กัน logic เพี้ยนไปคนละแบบ
// ⭐️ Multi-tenant: pool removed — use req.db (injected by tenantDB middleware)
const { getStoreName } = require('../utils/storeConfig');
const { toSatang, fromSatang } = require('../utils/money');
const { serverError, badRequest, forbidden, notFound } = require('../utils/http');
const { sendDailyReport } = require('../scripts/dailyReport'); // ⭐️ Sprint 1 — D4
const reportsExport = require('../services/reports-export'); // ⭐️ Phase 4 Part 2 — executive summary export

// ⭐️ "วัน/เดือนตามเวลาไทย" — server cloud มักรันโซน UTC เดิม new Date().toISOString().slice() จะได้
// วัน/เดือนแบบ UTC: ช่วง 00:00–07:00 ไทย default ของ payroll/my-hours/monthly-overview + label รายงาน
// รายวันจะเพี้ยนเป็นเมื่อวาน/เดือนก่อนหน้า — pattern เดียวกับ toBangkokDateStr ใน server.js
const TZ_BANGKOK = 'Asia/Bangkok';
function bangkokDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_BANGKOK, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// เดือนจาก query (?month=YYYY-MM) — default เป็นเดือนปัจจุบัน (ไทย) — เดิม copy 3 จุด
function resolveMonth(query) {
  return query.month || bangkokDateStr().slice(0, 7);
}

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
    const [rows] = await req.db.query(`
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
    serverError(res);
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

    const [rows] = await req.db.query(`
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
    const [[{ active_days } = { active_days: 0 }]] = await req.db.query(`
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
    serverError(res);
  }
}

// GET /api/reports/attendance — เข้า-ออกงานเทียบตารางเวร (schedules) หา late_minutes
async function attendance(req, res) {
  try {
    const { month } = req.query; // 'YYYY-MM'
    const monthClause = month ? `AND DATE_FORMAT(work_date, '%Y-%m') = ?` : '';
    const params = month ? [month] : [];

    const [rows] = await req.db.query(`
      SELECT user_id, full_name, work_date, expected_start, actual_time,
        CASE WHEN actual_time IS NULL THEN NULL
             ELSE TIMESTAMPDIFF(MINUTE, CONCAT(work_date, ' ', expected_start), actual_time)
        END as late_minutes
      FROM (
        SELECT s.cashier_id as user_id, u.full_name, s.work_date, s.expected_start, sh.opened_at as actual_time
        FROM schedules s
        JOIN users u ON s.cashier_id = u.id AND u.role = 'CASHIER'
        LEFT JOIN shifts sh ON sh.cashier_id = s.cashier_id AND DATE(sh.opened_at) = s.work_date
        UNION ALL
        SELECT s.cashier_id as user_id, u.full_name, s.work_date, s.expected_start, att.check_in as actual_time
        FROM schedules s
        JOIN users u ON s.cashier_id = u.id AND u.role IN ('ADMIN', 'MANAGER')
        LEFT JOIN attendance att ON att.user_id = s.cashier_id AND DATE(att.check_in) = s.work_date
      ) combined
      WHERE work_date NOT IN (SELECT holiday_date FROM holidays)
      ${monthClause}
      ORDER BY work_date DESC, user_id
    `, params);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/dashboard — ยอดขายวันนี้ (POS + พรีออเดอร์ที่มารับแล้ว) แยกช่องทางชำระ
async function dashboard(req, res) {
  try {
    // ⭐️ รวมยอดขายหน้าร้าน (sales) กับบิลจากการจองที่ลูกค้ามารับแล้ว (orders สถานะ COMPLETED)
    // นับ orders เข้าวันที่ "มารับจริง" (completed_at) ไม่ใช่วันที่จอง (created_at)
    const [rows] = await req.db.query(`
      SELECT
        COALESCE(SUM(cnt), 0) as total_bills,
        COALESCE(SUM(total), 0) as total_sales,
        COALESCE(SUM(cash), 0) as cash_sales,
        COALESCE(SUM(qr), 0) as qr_sales,
        COALESCE(SUM(mixed), 0) as mixed_sales
      FROM (
        SELECT
          COUNT(id) as cnt,
          SUM(total_amount) as total,
          SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END) as cash,
          SUM(CASE WHEN payment_method = 'QR' THEN total_amount ELSE 0 END) as qr,
          SUM(CASE WHEN payment_method = 'MIXED' THEN total_amount ELSE 0 END) as mixed
        FROM sales
        WHERE DATE(created_at) = CURDATE() AND status = 'COMPLETED'
        UNION ALL
        SELECT
          COUNT(id),
          SUM(total_amount),
          SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END),
          SUM(CASE WHEN payment_method = 'QR' THEN total_amount ELSE 0 END),
          0
        FROM orders
        WHERE DATE(completed_at) = CURDATE() AND status = 'COMPLETED'
      ) combined
    `);

    res.json({
      date: bangkokDateStr(), // ⭐️ FIX — เดิมเป็นวันแบบ UTC (label กับข้อมูลที่ query ด้วย CURDATE() ไม่ตรงกันช่วง 00:00–07:00 ไทย)
      summary: rows[0]
    });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/top-selling — สินค้าขายดี 10 อันดับ (POS + พรีออเดอร์ COMPLETED)
async function topSelling(req, res) {
  try {
    // ⭐️ รวมรายการจาก sale_items (ขายหน้าร้าน) กับ order_items (บิลจองที่ COMPLETED แล้ว)
    const [rows] = await req.db.query(`
      SELECT product_id, name, SUM(quantity) as total_quantity, SUM(revenue) as total_revenue
      FROM (
        SELECT p.id as product_id, p.name as name, si.quantity as quantity, si.subtotal as revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        WHERE s.status = 'COMPLETED'
        UNION ALL
        SELECT p.id, p.name, oi.quantity, oi.subtotal
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE o.status = 'COMPLETED'
      ) combined
      GROUP BY product_id, name
      ORDER BY total_quantity DESC
      LIMIT 10
    `);

    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/vendor-sales — ยอดฝากขายรวมของ vendor (self-scoped, ADMIN ดูได้ทุกคน)
// 🐛 FIX (round 2, ยกมาทั้ง comment) — เดิมแก้รอบแรกเปิดแค่ requireRole('ADMIN','MEMBER') โดยลืมไปว่า
// CASHIER/ADMIN ก็เห็นลิงก์ "ยอดฝากขายของฉัน" ได้เหมือนกันตอนสลับเป็นโหมด "ซื้อของ/จองสินค้า"
// (sessionMode='shop' ใน Layout.tsx ทำให้ isStaff เป็น false แล้วโชว์ /my-sales ให้ CASHIER/ADMIN ด้วย)
// เจอจาก log จริง: role=CASHIER โดน 403 — วิธีแก้ที่ถูกคือเลิก enumerate role เป็นรายตัว เพราะ route นี้
// self-scoped อยู่แล้ว (ownership check ด้านล่าง) ต้องแค่ authenticateToken (มี global อยู่แล้ว) ก็พอ
// ไม่ต้องมี requireRole เลย — ใครก็ตามที่ login แล้วดูได้เฉพาะของตัวเอง ยกเว้น ADMIN ที่ดูของใครก็ได้
async function vendorSales(req, res) {
  try {
    // ⭐️ ถ้ามี ?vendor_id= ส่งมา ให้กรองเฉพาะของเจ้าของคนนั้น (ใช้กับหน้า "ยอดฝากขายของฉัน")
    // ไม่ส่งมา = ดึงสรุปทุกคน (ใช้กับ ADMIN เท่านั้น)
    const { vendor_id } = req.query;

    if (req.user.role !== 'ADMIN') {
      if (!vendor_id || Number(vendor_id) !== req.user.id) {
        return forbidden(res, "ดูได้เฉพาะยอดฝากขายของตัวเองเท่านั้น");
      }
    }

    let query = `
      SELECT
        u.id as vendor_id,
        u.student_id,
        u.full_name,
        SUM(si.quantity) as total_items_sold,
        SUM(si.subtotal) as total_sales,
        SUM(si.subtotal * (p.gp_rate / 100)) as coop_gp_earnings,
        SUM(si.subtotal - (si.subtotal * (p.gp_rate / 100))) as vendor_earnings
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      JOIN users u ON p.vendor_id = u.id
      WHERE s.status = 'COMPLETED'
    `;
    const params = [];
    if (vendor_id) {
      query += ` AND u.id = ?`;
      params.push(vendor_id);
    }
    query += ` GROUP BY u.id, u.student_id, u.full_name ORDER BY vendor_earnings DESC`;

    const [rows] = await req.db.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/vendor-sales/detail — รายสินค้าของ vendor คนเดียว (self-scoped เหมือน vendor-sales)
async function vendorSalesDetail(req, res) {
  try {
    const { vendor_id } = req.query;
    if (!vendor_id) return badRequest(res, 'ต้องระบุ vendor_id');

    if (req.user.role !== 'ADMIN' && Number(vendor_id) !== req.user.id) {
      return forbidden(res, "ดูได้เฉพาะยอดฝากขายของตัวเองเท่านั้น");
    }

    const [rows] = await req.db.query(`
      SELECT
        p.id as product_id,
        p.name as product_name,
        p.gp_rate,
        SUM(si.quantity) as quantity_sold,
        SUM(si.subtotal) as total_sales,
        SUM(si.subtotal * (p.gp_rate / 100)) as coop_gp_earnings,
        SUM(si.subtotal - (si.subtotal * (p.gp_rate / 100))) as vendor_earnings
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE s.status = 'COMPLETED' AND p.vendor_id = ?
      GROUP BY p.id, p.name, p.gp_rate
      ORDER BY vendor_earnings DESC
    `, [vendor_id]);

    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/void-summary — จำนวน/ยอดบิลที่ยกเลิกวันนี้
async function voidSummary(req, res) {
  try {
    const [rows] = await req.db.query(`
      SELECT COUNT(id) as void_count, COALESCE(SUM(total_amount), 0) as void_amount
      FROM sales
      WHERE status = 'VOIDED' AND DATE(created_at) = CURDATE()
    `);
    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/shift-anomalies — กะที่ปิดวันนี้แล้วเงินขาด/เกิน >20 บาท
async function shiftAnomalies(req, res) {
  try {
    // tolerance ±20 บาท ถือว่าปกติ เกินกว่านี้ = ผิดปกติ
    const [rows] = await req.db.query(`
      SELECT sh.id, sh.difference, sh.closed_at, u.full_name as cashier_name
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      WHERE sh.status = 'CLOSED' AND DATE(sh.closed_at) = CURDATE() AND ABS(sh.difference) > 20
      ORDER BY ABS(sh.difference) DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/sales-comparison — ยอดวันนี้ เทียบเมื่อวาน/สัปดาห์ก่อน (%)
async function salesComparison(req, res) {
  try {
    // ยอดต่อวัน = sales (created_at) + orders COMPLETED (completed_at)
    const dayTotal = async (dateExpr) => {
      const [rows] = await req.db.query(`
        SELECT
          (SELECT COALESCE(SUM(total_amount),0) FROM sales WHERE status='COMPLETED' AND DATE(created_at) = ${dateExpr})
          +
          (SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE status='COMPLETED' AND DATE(completed_at) = ${dateExpr})
          as total
      `);
      return Number(rows[0].total);
    };

    const today = await dayTotal('CURDATE()');
    const yesterday = await dayTotal('(CURDATE() - INTERVAL 1 DAY)');
    const lastWeek = await dayTotal('(CURDATE() - INTERVAL 7 DAY)');

    const pct = (base) => base > 0 ? Math.round(((today - base) / base) * 1000) / 10 : null;

    res.json({
      today, yesterday, last_week: lastWeek,
      pct_vs_yesterday: pct(yesterday),
      pct_vs_last_week: pct(lastWeek)
    });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/sales-by-cashier — ยอดขายต่อกะของวันนี้ แยกรายแคชเชียร์
async function salesByCashier(req, res) {
  try {
    // ⭐️ หมวด 6: JOIN sales.shift_id = shifts.id แม่นกว่าเทียบช่วงเวลา (รองรับเปิดกะซ้อนเวลากันหลายคน)
    // บิลเก่าก่อนมีคอลัมน์ shift_id จะไม่ถูกนับในรายงานนี้ (shift_id เป็น NULL)
    const [rows] = await req.db.query(`
      SELECT
        sh.id as shift_id, u.id as cashier_id, u.full_name as cashier_name,
        sh.opened_at, sh.closed_at, sh.status as shift_status,
        COUNT(s.id) as bill_count, COALESCE(SUM(s.total_amount), 0) as total_sales
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      LEFT JOIN sales s ON s.shift_id = sh.id AND s.status = 'COMPLETED'
      WHERE DATE(sh.opened_at) = CURDATE()
      GROUP BY sh.id, u.id, u.full_name, sh.opened_at, sh.closed_at, sh.status
      ORDER BY sh.opened_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/open-shifts — กะที่เปิดอยู่ตอนนี้ทั้งหมด
async function openShifts(req, res) {
  try {
    const [rows] = await req.db.query(`
      SELECT sh.id, sh.opening_cash, sh.opened_at, u.full_name as cashier_name
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      WHERE sh.status = 'OPEN'
      ORDER BY sh.opened_at ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/pending-orders — จำนวน/ยอดออเดอร์ที่ยังไม่จบ (ไม่ใช่ COMPLETED/CANCELLED) แยกตาม status
async function pendingOrders(req, res) {
  try {
    const [rows] = await req.db.query(`
      SELECT status, COUNT(id) as count, COALESCE(SUM(total_amount),0) as total
      FROM orders
      WHERE status NOT IN ('COMPLETED', 'CANCELLED')
      GROUP BY status
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/sales-channel — ยอดวันนี้ แยกหน้าร้าน vs พรีออเดอร์
async function salesChannel(req, res) {
  try {
    const [walkin] = await req.db.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM sales WHERE status='COMPLETED' AND DATE(created_at)=CURDATE()`);
    const [preorder] = await req.db.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM orders WHERE status='COMPLETED' AND DATE(completed_at)=CURDATE()`);
    res.json({ walkin_sales: Number(walkin[0].total), preorder_sales: Number(preorder[0].total) });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/gross-profit — กำไรขั้นต้นวันนี้ (หัก GP คืน vendor แล้ว)
async function grossProfit(req, res) {
  try {
    // กำไรขั้นต้น = subtotal - (cost * qty) - GP ที่ต้องคืน vendor (เฉพาะสินค้าฝากขาย)
    // GP สหกรณ์ = subtotal * gp_rate/100 คือส่วนที่สหกรณ์ได้ ส่วน vendor_earnings คืน vendor
    // กำไรจริงของสหกรณ์: สินค้าปกติ = subtotal - cost*qty ; สินค้าฝากขาย = subtotal * gp_rate/100
    const [rows] = await req.db.query(`
      SELECT COALESCE(SUM(
        CASE
          WHEN p.vendor_id IS NOT NULL THEN si.subtotal * (p.gp_rate / 100)
          ELSE si.subtotal - (p.cost * si.quantity)
        END
      ), 0) as gross_profit
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE s.status='COMPLETED' AND DATE(s.created_at)=CURDATE()
    `);
    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/profit-summary — กำไรแยกกำไรจาก GP (ฝากขาย) vs กำไรสินค้าสหกรณ์เอง รายเดือน+รวม
async function profitSummary(req, res) {
  try {
    // นิยาม (ต่อรายการสินค้า):
    //   รายได้ (revenue)      = subtotal ที่ขายได้
    //   ต้นทุนสินค้าสหกรณ์     = cost*qty (เฉพาะสินค้าสหกรณ์เอง vendor_id IS NULL)
    //   คืนผู้ฝากขาย          = subtotal - subtotal*gp% (เฉพาะสินค้าฝากขาย)
    //   กำไรสินค้าสหกรณ์เอง    = subtotal - cost*qty (vendor_id IS NULL)
    //   กำไรจาก GP ฝากขาย     = subtotal*gp% (vendor_id IS NOT NULL)
    const lineExpr = `
      it.subtotal AS revenue,
      CASE WHEN p.vendor_id IS NULL THEN p.cost*it.quantity ELSE 0 END AS cogs_own,
      CASE WHEN p.vendor_id IS NOT NULL THEN it.subtotal - it.subtotal*p.gp_rate/100 ELSE 0 END AS vendor_payout,
      CASE WHEN p.vendor_id IS NULL THEN it.subtotal - p.cost*it.quantity ELSE 0 END AS profit_own,
      CASE WHEN p.vendor_id IS NOT NULL THEN it.subtotal*p.gp_rate/100 ELSE 0 END AS profit_gp`;
    const [rows] = await req.db.query(`
      SELECT period,
             SUM(revenue) AS revenue,
             SUM(cogs_own) AS cogs_own,
             SUM(vendor_payout) AS vendor_payout,
             SUM(profit_own) AS profit_own,
             SUM(profit_gp) AS profit_gp,
             SUM(profit_own + profit_gp) AS profit_total
      FROM (
        SELECT DATE_FORMAT(s.created_at,'%Y-%m') AS period, ${lineExpr}
        FROM sale_items it JOIN sales s ON it.sale_id=s.id JOIN products p ON it.product_id=p.id
        WHERE s.status='COMPLETED'
        UNION ALL
        SELECT DATE_FORMAT(o.completed_at,'%Y-%m') AS period, ${lineExpr}
        FROM order_items it JOIN orders o ON it.order_id=o.id JOIN products p ON it.product_id=p.id
        WHERE o.status='COMPLETED'
      ) t
      GROUP BY period ORDER BY period DESC
    `);
    const num = (v) => Number(v || 0);
    const monthly = rows.map(r => ({
      period: r.period,
      revenue: num(r.revenue),
      cogs_own: num(r.cogs_own),
      vendor_payout: num(r.vendor_payout),
      profit_own: num(r.profit_own),
      profit_gp: num(r.profit_gp),
      profit_total: num(r.profit_total),
    }));
    const overall = monthly.reduce((a, m) => ({
      revenue: a.revenue + m.revenue,
      cogs_own: a.cogs_own + m.cogs_own,
      vendor_payout: a.vendor_payout + m.vendor_payout,
      profit_own: a.profit_own + m.profit_own,
      profit_gp: a.profit_gp + m.profit_gp,
      profit_total: a.profit_total + m.profit_total,
    }), { revenue: 0, cogs_own: 0, vendor_payout: 0, profit_own: 0, profit_gp: 0, profit_total: 0 });
    res.json({ overall, monthly });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/dead-stock — สินค้าที่มีสต๊อกแต่ไม่ขายเลยใน 30 วันล่าสุด (top 20 by stock)
async function deadStock(req, res) {
  try {
    const [rows] = await req.db.query(`
      SELECT p.id, p.name, p.stock
      FROM products p
      WHERE p.is_active = TRUE AND p.stock > 0
        AND p.id NOT IN (
          SELECT DISTINCT si.product_id
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.status='COMPLETED' AND s.created_at >= (CURDATE() - INTERVAL 30 DAY)
        )
      ORDER BY p.stock DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/vendor-summary — สรุปยอดฝากขายทุก vendor รวม (ADMIN/MANAGER เท่านั้น ไม่ scope ตัวเอง)
async function vendorSummary(req, res) {
  try {
    const [rows] = await req.db.query(`
      SELECT
        u.id as vendor_id, u.full_name as vendor_name,
        SUM(si.quantity) as total_items_sold,
        SUM(si.subtotal) as total_sales,
        SUM(si.subtotal * (p.gp_rate / 100)) as coop_gp_earnings,
        SUM(si.subtotal - (si.subtotal * (p.gp_rate / 100))) as vendor_earnings
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      JOIN users u ON p.vendor_id = u.id
      WHERE s.status='COMPLETED' AND p.vendor_id IS NOT NULL
      GROUP BY u.id, u.full_name
      ORDER BY vendor_earnings DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/payroll — ค่าจ้างพนักงานทั้งหมดตามเดือน (ชั่วโมงทำงาน × อัตราค่าจ้าง, ADMIN เท่านั้น)
async function payroll(req, res) {
  try {
    // 🐛 FIX — เดิม new Date().toISOString().slice(0,7) เป็นเดือนแบบ UTC: ช่วง 00:00–07:00 ไทย default
    // จะเป็นเดือนก่อนหน้า (รายงานโชว์เดือนผิด) — ใช้ bangkokDateStr() (เดือนตามเวลาไทย)
    const month = resolveMonth(req.query); // 'YYYY-MM'

    // พนักงานทั้งหมด (CASHIER + MANAGER + ADMIN) พร้อมอัตราค่าจ้างต่อชั่วโมงปัจจุบัน
    // ⭐️ Update — เพิ่ม MANAGER (ผู้ใช้ attendance clock-in/out ตัวจริงตอนนี้แทน ADMIN) คง ADMIN ไว้
    //   เผื่อมีข้อมูลชั่วโมงเก่าก่อนเปลี่ยนสิทธิ์ (ไม่งั้นประวัติค่าจ้างเดือนที่ผ่านมาของ ADMIN จะหายจากตาราง)
    const [staff] = await req.db.query(
      `SELECT id, full_name, role, hourly_rate FROM users WHERE role IN ('CASHIER','MANAGER','ADMIN') AND is_active = TRUE ORDER BY full_name`
    );

    // ชั่วโมงทำงาน: CASHIER นับจาก shifts ที่ปิดสมบูรณ์แล้ว (status='CLOSED'), MANAGER/ADMIN นับจาก attendance
    const [shiftMinutes] = await req.db.query(
      `SELECT cashier_id as user_id, SUM(TIMESTAMPDIFF(MINUTE, opened_at, closed_at)) as total_minutes
       FROM shifts
       WHERE status = 'CLOSED' AND closed_at IS NOT NULL AND DATE_FORMAT(opened_at, '%Y-%m') = ?
       GROUP BY cashier_id`,
      [month]
    );
    const [attendanceMinutes] = await req.db.query(
      `SELECT user_id, SUM(TIMESTAMPDIFF(MINUTE, check_in, check_out)) as total_minutes
       FROM attendance
       WHERE check_out IS NOT NULL AND DATE_FORMAT(check_in, '%Y-%m') = ?
       GROUP BY user_id`,
      [month]
    );

    // มาสาย: ใช้ตรรกะเดียวกับ /api/reports/attendance (เทียบ schedules.expected_start กับเวลาจริง) ยกเว้นวันหยุด
    const [lateRows] = await req.db.query(
      `SELECT user_id, work_date, actual_time,
         CASE WHEN actual_time IS NULL THEN NULL
              ELSE TIMESTAMPDIFF(MINUTE, CONCAT(work_date, ' ', expected_start), actual_time)
         END as late_minutes
       FROM (
         SELECT s.cashier_id as user_id, s.work_date, s.expected_start, sh.opened_at as actual_time
         FROM schedules s
         JOIN users u ON s.cashier_id = u.id AND u.role = 'CASHIER'
         LEFT JOIN shifts sh ON sh.cashier_id = s.cashier_id AND DATE(sh.opened_at) = s.work_date
         UNION ALL
         SELECT s.cashier_id as user_id, s.work_date, s.expected_start, att.check_in as actual_time
         FROM schedules s
         JOIN users u ON s.cashier_id = u.id AND u.role IN ('ADMIN', 'MANAGER')
         LEFT JOIN attendance att ON att.user_id = s.cashier_id AND DATE(att.check_in) = s.work_date
       ) combined
       WHERE work_date NOT IN (SELECT holiday_date FROM holidays)
         AND DATE_FORMAT(work_date, '%Y-%m') = ?`,
      [month]
    );

    const minutesByUser = {};
    for (const r of shiftMinutes) minutesByUser[r.user_id] = (minutesByUser[r.user_id] || 0) + Number(r.total_minutes || 0);
    for (const r of attendanceMinutes) minutesByUser[r.user_id] = (minutesByUser[r.user_id] || 0) + Number(r.total_minutes || 0);

    const lateMinutesByUser = {};
    for (const r of lateRows) {
      if (r.late_minutes && r.late_minutes > 0) {
        lateMinutesByUser[r.user_id] = (lateMinutesByUser[r.user_id] || 0) + r.late_minutes;
      }
    }

    const result = staff.map(u => {
      const totalMinutes = minutesByUser[u.id] || 0;
      const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
      const lateMinutes = lateMinutesByUser[u.id] || 0;
      const lateHours = Math.round((lateMinutes / 60) * 100) / 100;
      const hourlyRate = Number(u.hourly_rate) || 0;
      const calculatedPay = Math.round(totalHours * hourlyRate * 100) / 100;
      return {
        user_id: u.id,
        full_name: u.full_name,
        role: u.role,
        hourly_rate: hourlyRate,
        total_hours: totalHours,
        late_minutes: lateMinutes,
        late_hours: lateHours,
        calculated_pay: calculatedPay,
      };
    });

    res.json({ month, staff: result });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/my-hours — เวอร์ชัน self-service ของ payroll (ดูได้แค่ของตัวเอง, ไม่ต้องเป็น ADMIN)
async function myHours(req, res) {
  try {
    // 🐛 FIX — เดิม new Date().toISOString().slice(0,7) เป็นเดือนแบบ UTC: ช่วง 00:00–07:00 ไทย default
    // จะเป็นเดือนก่อนหน้า (รายงานโชว์เดือนผิด) — ใช้ bangkokDateStr() (เดือนตามเวลาไทย)
    const month = resolveMonth(req.query); // 'YYYY-MM'
    const userId = req.user.id;

    const [users] = await req.db.query('SELECT full_name, role, hourly_rate FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return notFound(res, 'ไม่พบข้อมูลผู้ใช้');
    const me = users[0];

    const [[shiftRow]] = await req.db.query(
      `SELECT SUM(TIMESTAMPDIFF(MINUTE, opened_at, closed_at)) as total_minutes
       FROM shifts
       WHERE cashier_id = ? AND status = 'CLOSED' AND closed_at IS NOT NULL AND DATE_FORMAT(opened_at, '%Y-%m') = ?`,
      [userId, month]
    );
    const [[attendanceRow]] = await req.db.query(
      `SELECT SUM(TIMESTAMPDIFF(MINUTE, check_in, check_out)) as total_minutes
       FROM attendance
       WHERE user_id = ? AND check_out IS NOT NULL AND DATE_FORMAT(check_in, '%Y-%m') = ?`,
      [userId, month]
    );

    const totalMinutes = Number(shiftRow?.total_minutes || 0) + Number(attendanceRow?.total_minutes || 0);
    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    const hourlyRate = Number(me.hourly_rate) || 0;
    const calculatedPay = Math.round(totalHours * hourlyRate * 100) / 100;

    res.json({
      month,
      full_name: me.full_name,
      role: me.role,
      hourly_rate: hourlyRate,
      total_hours: totalHours,
      calculated_pay: calculatedPay,
    });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/monthly-overview — ยอดขาย/สมาชิก/สต๊อกใกล้หมด/ออเดอร์ค้าง/บิลยกเลิก ของเดือนที่เลือก
async function monthlyOverview(req, res) {
  try {
    // 🐛 FIX — เดิม new Date().toISOString().slice(0,7) เป็นเดือนแบบ UTC: ช่วง 00:00–07:00 ไทย default
    // จะเป็นเดือนก่อนหน้า (รายงานโชว์เดือนผิด) — ใช้ bangkokDateStr() (เดือนตามเวลาไทย)
    const month = resolveMonth(req.query);

    // ยอดขายรวมเดือนนี้ (sales หน้าร้าน + orders จองที่มารับแล้ว)
    const [salesRows] = await req.db.query(
      `SELECT COALESCE(SUM(cnt), 0) as total_bills, COALESCE(SUM(total), 0) as total_sales
       FROM (
         SELECT COUNT(id) as cnt, SUM(total_amount) as total
         FROM sales WHERE status = 'COMPLETED' AND DATE_FORMAT(created_at, '%Y-%m') = ?
         UNION ALL
         SELECT COUNT(id), SUM(total_amount)
         FROM orders WHERE status = 'COMPLETED' AND DATE_FORMAT(completed_at, '%Y-%m') = ?
       ) combined`,
      [month, month]
    );

    // สมาชิก: รวมทั้งหมด + สมัครใหม่เดือนนี้
    const [memberRows] = await req.db.query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role = 'MEMBER') as total_members,
         (SELECT COUNT(*) FROM users WHERE role = 'MEMBER' AND DATE_FORMAT(created_at, '%Y-%m') = ?) as new_members`,
      [month]
    );

    // สต๊อกใกล้หมด (ข้อมูลปัจจุบัน ไม่ผูกกับเดือนที่เลือก)
    const [lowStockRows] = await req.db.query(
      `SELECT COUNT(*) as count FROM products WHERE is_active = TRUE AND stock <= 5`
    );

    // ออเดอร์จองที่ยังค้างอยู่ (ข้อมูลปัจจุบัน)
    const [pendingOrderRows] = await req.db.query(
      `SELECT COUNT(*) as count FROM orders WHERE status NOT IN ('COMPLETED', 'CANCELLED')`
    );

    // บิลยกเลิกเดือนนี้
    const [voidRows] = await req.db.query(
      `SELECT COUNT(*) as void_count, COALESCE(SUM(total_amount), 0) as void_amount
       FROM sales WHERE status = 'VOIDED' AND DATE_FORMAT(created_at, '%Y-%m') = ?`,
      [month]
    );

    res.json({
      month,
      total_bills: Number(salesRows[0].total_bills),
      total_sales: Number(salesRows[0].total_sales),
      total_members: Number(memberRows[0].total_members),
      new_members: Number(memberRows[0].new_members),
      low_stock_count: Number(lowStockRows[0].count),
      pending_orders_count: Number(pendingOrderRows[0].count),
      void_count: Number(voidRows[0].void_count),
      void_amount: Number(voidRows[0].void_amount),
    });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// POST /api/reports/daily/send — สั่งส่งรายงานสรุปยอดประจำวันทางอีเมลทันที (ปกติรันเองผ่าน cron)
async function dailySend(req, res) {
  try {
    const result = await sendDailyReport(req.query.date);
    res.json({
      message: result.sent ? "ส่งรายงานสรุปยอดประจำวันสำเร็จ" : "สร้างรายงานสำเร็จ แต่ไม่ได้ส่งอีเมล (ตรวจ ADMIN_EMAIL / SMTP ใน .env)",
      sent: result.sent,
      report: result.data,
    });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/export/sales-csv — export ยอดขายรวม 3 ระดับ (รายชิ้น/รายบิล/สรุปรายวัน) ไฟล์เดียว
// format=excel (3 ชีท) หรือ csv (3 ส่วนคั่นหัวข้อ) — ดู ExportImportButtons/handleExportCsv ฝั่ง frontend
async function exportSalesCsv(req, res) {
  const { start_date, end_date, format = 'csv' } = req.query;
  if (format !== 'excel' && format !== 'csv') {
    return badRequest(res, 'format ต้องเป็น excel หรือ csv เท่านั้น');
  }

  // แปลง array-of-rows -> CSV string (ใส่ " ครอบทุกช่อง กัน , ในข้อมูล)
  const toCsv = (headers, rows) =>
    [headers, ...rows]
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

  // WHERE ช่วงวันที่ (ถ้าไม่ส่งมา = ทั้งหมด)
  const hasRange = !!(start_date && end_date);

  try {
    const sections = {}; // { daily: {headers, rows}, bill: {...}, item: {...} }

    {
      // สรุปรายวัน: รวมทั้ง POS + พรีออเดอร์ต่อวัน
      const params = [];
      let wSale = "s.status = 'COMPLETED'";
      let wOrder = "o.status = 'COMPLETED'";
      if (hasRange) {
        wSale += ' AND DATE(s.created_at) BETWEEN ? AND ?';
        wOrder += ' AND DATE(o.completed_at) BETWEEN ? AND ?';
        params.push(start_date, end_date, start_date, end_date);
      }
      // 🐛 FIX (root cause — same as weekly-sales/hourly-sales/monthly-overview) — created_at/
      // completed_at เป็น TIMESTAMP และ pool ตั้ง SET time_zone='+07:00' ทุก connection แล้ว MySQL
      // คืนเป็นเวลาไทยตั้งแต่อ่านแล้ว ใช้คอลัมน์ตรงๆ ได้เลย ไม่ต้องแปลงซ้ำ. เดิม DATE(...) คืน DATE
      // type ที่ mysql2 parse เป็น JS Date object แล้วโค้ด JS อ่านด้วย .toISOString() (UTC) อีกที
      // เพี้ยนได้ถ้า Node process ไม่ได้รันที่ UTC พอดี — เปลี่ยนเป็น DATE_FORMAT คืน string ตรงๆ
      // ตัด JS Date object ออกจากสมการทั้งหมด (เหมือน weekly-sales)
      const [rows] = await req.db.query(`
        SELECT day, SUM(bill_count) AS bills, SUM(total_sales) AS total_sales,
               SUM(cash_sales) AS cash_sales, SUM(qr_sales) AS qr_sales
        FROM (
          SELECT DATE_FORMAT(s.created_at, '%Y-%m-%d') AS day, COUNT(*) AS bill_count,
                 SUM(s.total_amount) AS total_sales,
                 SUM(CASE WHEN s.payment_method='CASH' THEN s.total_amount ELSE 0 END) AS cash_sales,
                 SUM(CASE WHEN s.payment_method='QR' THEN s.total_amount ELSE 0 END) AS qr_sales
          FROM sales s WHERE ${wSale} GROUP BY DATE_FORMAT(s.created_at, '%Y-%m-%d')
          UNION ALL
          SELECT DATE_FORMAT(o.completed_at, '%Y-%m-%d') AS day, COUNT(*) AS bill_count,
                 SUM(o.total_amount) AS total_sales,
                 SUM(CASE WHEN o.payment_method='CASH' THEN o.total_amount ELSE 0 END) AS cash_sales,
                 SUM(CASE WHEN o.payment_method='QR' THEN o.total_amount ELSE 0 END) AS qr_sales
          FROM orders o WHERE ${wOrder} GROUP BY DATE_FORMAT(o.completed_at, '%Y-%m-%d')
        ) t
        GROUP BY day ORDER BY day DESC
      `, params);
      sections.daily = {
        title: 'สรุปรายวัน', sheetName: 'สรุปรายวัน',
        headers: ['วันที่', 'จำนวนบิล', 'ยอดขายรวม', 'เงินสด', 'โอน/QR'],
        rows: rows.map(r => [
          r.day, r.bills, Number(r.total_sales).toFixed(2),
          Number(r.cash_sales).toFixed(2), Number(r.qr_sales).toFixed(2),
        ]),
      };
    }

    {
      // รายบิล
      const params = [];
      let wSale = "s.status = 'COMPLETED'";
      let wOrder = "o.status = 'COMPLETED'";
      if (hasRange) {
        wSale += ' AND DATE(s.created_at) BETWEEN ? AND ?';
        wOrder += ' AND DATE(o.completed_at) BETWEEN ? AND ?';
        params.push(start_date, end_date, start_date, end_date);
      }
      // 🐛 FIX (root cause) — เดิม CONVERT_TZ(...,'+00:00','+07:00') แปลงเวลาซ้ำ (session tz +07:00
      // จัดการให้แล้ว) บวก 7 ชม.เกิน ตัดออกให้ตรงกับจุดอื่นที่แก้ไปแล้ว
      const [rows] = await req.db.query(`
        SELECT * FROM (
          SELECT DATE_FORMAT(s.created_at,'%Y-%m-%d %H:%i') AS dt,
                 'POS' AS channel, s.id AS bill_no,
                 (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id) AS item_count,
                 s.discount_amount, s.total_amount, s.payment_method,
                 cs.full_name AS party, s.created_at AS sort_at
          FROM sales s LEFT JOIN users cs ON s.cashier_id=cs.id
          WHERE ${wSale}
          UNION ALL
          SELECT DATE_FORMAT(o.completed_at,'%Y-%m-%d %H:%i') AS dt,
                 'พรีออเดอร์' AS channel, o.id AS bill_no,
                 (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS item_count,
                 0 AS discount_amount, o.total_amount, o.payment_method,
                 cust.full_name AS party, o.completed_at AS sort_at
          FROM orders o LEFT JOIN users cust ON o.user_id=cust.id
          WHERE ${wOrder}
        ) t ORDER BY sort_at DESC
      `, params);
      sections.bill = {
        title: 'รายบิล', sheetName: 'รายบิล',
        headers: ['วันที่-เวลา', 'ช่องทาง', 'เลขบิล', 'จำนวนรายการ', 'ส่วนลด', 'ยอดสุทธิ', 'ชำระโดย', 'แคชเชียร์/ลูกค้า'],
        rows: rows.map(r => [
          r.dt, r.channel, r.bill_no, r.item_count,
          Number(r.discount_amount).toFixed(2), Number(r.total_amount).toFixed(2),
          r.payment_method === 'QR' ? 'โอน/QR' : r.payment_method === 'CASH' ? 'เงินสด' : r.payment_method,
          r.party || '-',
        ]),
      };
    }

    {
      // รายชิ้น ละเอียดสุด พร้อมคอลัมน์ช่วยคำนวณรายได้สหกรณ์
      const params = [];
      let wSale = "s.status = 'COMPLETED'";
      let wOrder = "o.status = 'COMPLETED'";
      if (hasRange) {
        wSale += ' AND DATE(s.created_at) BETWEEN ? AND ?';
        wOrder += ' AND DATE(o.completed_at) BETWEEN ? AND ?';
        params.push(start_date, end_date, start_date, end_date);
      }
      // coop_income: สินค้าฝากขาย = subtotal*gp% ; สินค้าสหกรณ์เอง = subtotal - ทุน
      const coopIncome = `CASE WHEN p.vendor_id IS NOT NULL THEN it.subtotal * p.gp_rate/100 ELSE it.subtotal - p.cost*it.quantity END`;
      const vendorEarn = `CASE WHEN p.vendor_id IS NOT NULL THEN it.subtotal - it.subtotal*p.gp_rate/100 ELSE 0 END`;
      // 🐛 FIX (root cause) — เดิม CONVERT_TZ(...,'+00:00','+07:00') แปลงเวลาซ้ำ ตัดออกเหมือนด้านบน
      const [rows] = await req.db.query(`
        SELECT * FROM (
          SELECT DATE_FORMAT(s.created_at,'%Y-%m-%d %H:%i') AS dt,
                 'POS' AS channel, s.id AS bill_no, p.name AS product, c.name AS category,
                 it.quantity, it.price, it.subtotal, (p.cost*it.quantity) AS cost_total,
                 p.gp_rate, ${coopIncome} AS coop_income,
                 COALESCE(v.full_name,'สหกรณ์') AS vendor, ${vendorEarn} AS vendor_earn,
                 s.payment_method, s.created_at AS sort_at
          FROM sale_items it
          JOIN sales s ON it.sale_id=s.id
          JOIN products p ON it.product_id=p.id
          LEFT JOIN categories c ON p.category_id=c.id
          LEFT JOIN users v ON p.vendor_id=v.id
          WHERE ${wSale}
          UNION ALL
          SELECT DATE_FORMAT(o.completed_at,'%Y-%m-%d %H:%i') AS dt,
                 'พรีออเดอร์' AS channel, o.id AS bill_no, p.name AS product, c.name AS category,
                 it.quantity, it.price, it.subtotal, (p.cost*it.quantity) AS cost_total,
                 p.gp_rate, ${coopIncome} AS coop_income,
                 COALESCE(v.full_name,'สหกรณ์') AS vendor, ${vendorEarn} AS vendor_earn,
                 o.payment_method, o.completed_at AS sort_at
          FROM order_items it
          JOIN orders o ON it.order_id=o.id
          JOIN products p ON it.product_id=p.id
          LEFT JOIN categories c ON p.category_id=c.id
          LEFT JOIN users v ON p.vendor_id=v.id
          WHERE ${wOrder}
        ) t ORDER BY sort_at DESC
      `, params);
      sections.item = {
        title: 'รายชิ้น', sheetName: 'รายชิ้น',
        headers: ['วันที่-เวลา', 'ช่องทาง', 'เลขบิล', 'สินค้า', 'หมวดหมู่', 'จำนวน', 'ราคา/ชิ้น',
          'ยอดรวมรายการ', 'ทุนรวม', 'GP%', 'รายได้สหกรณ์(ประมาณ)', 'เจ้าของฝากขาย', 'ยอดเจ้าของได้', 'ชำระโดย'],
        rows: rows.map(r => [
          r.dt, r.channel, r.bill_no, r.product, r.category || '-', r.quantity,
          Number(r.price).toFixed(2), Number(r.subtotal).toFixed(2), Number(r.cost_total).toFixed(2),
          Number(r.gp_rate).toFixed(2), Number(r.coop_income).toFixed(2), r.vendor,
          Number(r.vendor_earn).toFixed(2),
          r.payment_method === 'QR' ? 'โอน/QR' : r.payment_method === 'CASH' ? 'เงินสด' : r.payment_method,
        ]),
      };
    }

    const range = hasRange ? `_${start_date}_to_${end_date}` : ''; // ⭐️ HTTP header ต้อง ASCII ห้ามมีไทย
    const sectionOrder = [sections.item, sections.bill, sections.daily]; // ละเอียดสุด → สรุปสุด

    if (format === 'excel') {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = await getStoreName(req.user?.tenant_id);
      workbook.created = new Date();
      for (const sec of sectionOrder) {
        const sheet = workbook.addWorksheet(sec.sheetName);
        sheet.addRow(sec.headers);
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
        sec.rows.forEach(r => sheet.addRow(r));
        sheet.columns.forEach((col, i) => {
          let maxLen = String(sec.headers[i] ?? '').length;
          for (const r of sec.rows) { const len = String(r[i] ?? '').length; if (len > maxLen) maxLen = len; }
          col.width = Math.min(Math.max(maxLen + 2, 10), 40);
        });
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="sales-export${range}.xlsx"`);
      await workbook.xlsx.write(res);
      return res.end();
    }

    // ⭐️ CSV รวม 3 ส่วนในไฟล์เดียว — คั่นด้วยบรรทัดว่าง + หัวข้อ === ชื่อส่วน === (convention ทั่วไป
    // สำหรับ multi-table CSV, Excel/Google Sheets เปิดอ่านได้ปกติ เห็นเป็น text แทรกอยู่ระหว่างตาราง)
    const combined = sectionOrder.map(sec => `=== ${sec.title} ===\n${toCsv(sec.headers, sec.rows)}`).join('\n\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-export${range}.csv"`);
    res.send('﻿' + combined); // BOM ให้ Excel อ่านภาษาไทยถูก
  } catch (err) {
    console.error('[sales-csv export] ERROR:', err.code || '', err.sqlMessage || err.message);
    serverError(res);
  }
}

// GET /api/reports/executive-export — Excel (KPI/top-products/category/inventory + full transaction
// detail) หรือ CSV fallback (แค่ transaction detail)
async function executiveExport(req, res) {
  const { startDate, endDate, format = 'excel' } = req.query;
  if (format !== 'excel' && format !== 'csv') {
    return badRequest(res, 'format ต้องเป็น excel หรือ csv เท่านั้น');
  }
  try {
    const rows = await reportsExport.fetchLineItems(pool, startDate, endDate);
    const range = startDate && endDate ? `_${startDate}_to_${endDate}` : ''; // ⭐️ ASCII เท่านั้นใน HTTP header

    if (format === 'csv') {
      const csv = reportsExport.buildCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="executive-summary${range}.csv"`);
      return res.send(csv);
    }

    const [storeName, inventory] = await Promise.all([
      reportsExport.fetchStoreName(pool),
      reportsExport.fetchInventorySummary(pool),
    ]);
    const kpis = reportsExport.aggregate(rows);
    const workbook = await reportsExport.buildWorkbook({ storeName, startDate, endDate, kpis, inventory, rows });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="executive-summary${range}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[executive-export] ERROR:', err.code || '', err.sqlMessage || err.message);
    serverError(res);
  }
}

// GET /api/reports/accounting-summary — สรุปบัญชีสหกรณ์ (JSON: หมวดหมู่+สินค้า+ยอดจ่ายคืนผู้ฝากขาย)
// ⭐️ Co-op Accounting Summary — ใช้ query เดียวกับ executive-export (fetchLineItems) มา aggregate ต่อ
// ไม่ต้อง round-trip DB ซ้ำ
async function accountingSummary(req, res) {
  const { start_date, end_date } = req.query;
  try {
    const [rows, supplierPayouts] = await Promise.all([
      reportsExport.fetchLineItems(pool, start_date, end_date),
      reportsExport.fetchVendorPayouts(pool, start_date, end_date),
    ]);
    const kpis = reportsExport.aggregate(rows);
    const totalCost = kpis.categorySummary.reduce((sum, c) => sum + c.cost, 0);

    res.json({
      period: { start_date: start_date || null, end_date: end_date || null },
      kpis: {
        totalRevenue: kpis.totalRevenue,
        totalCost,
        totalProfit: kpis.totalProfit,
        totalOrders: kpis.totalOrders,
        aov: kpis.aov,
      },
      categoryBreakdown: kpis.categorySummary,
      productBreakdown: kpis.productBreakdown,
      supplierPayouts,
    });
  } catch (error) {
    console.error('[500]', error.message);
    serverError(res);
  }
}

// GET /api/reports/accounting-summary/export — Excel ของ accountingSummary (3 ชีท)
async function accountingSummaryExport(req, res) {
  const { start_date, end_date } = req.query;
  try {
    const [rows, supplierPayouts, storeName] = await Promise.all([
      reportsExport.fetchLineItems(pool, start_date, end_date),
      reportsExport.fetchVendorPayouts(pool, start_date, end_date),
      reportsExport.fetchStoreName(pool),
    ]);
    const kpis = reportsExport.aggregate(rows);
    const totalCost = kpis.categorySummary.reduce((sum, c) => sum + c.cost, 0);
    const workbook = await reportsExport.buildAccountingWorkbook({
      storeName,
      startDate: start_date,
      endDate: end_date,
      kpis: { totalRevenue: kpis.totalRevenue, totalCost, totalProfit: kpis.totalProfit, totalOrders: kpis.totalOrders },
      categoryBreakdown: kpis.categorySummary,
      productBreakdown: kpis.productBreakdown,
      supplierPayouts,
    });

    const range = start_date && end_date ? `_${start_date}_to_${end_date}` : ''; // ⭐️ ASCII เท่านั้นใน HTTP header
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="accounting-summary${range}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[accounting-summary/export] ERROR:', err.code || '', err.sqlMessage || err.message);
    serverError(res);
  }
}

module.exports = {
  weeklySales, hourlySales,
  attendance, dashboard, topSelling, vendorSales, vendorSalesDetail,
  voidSummary, shiftAnomalies, salesComparison, salesByCashier, openShifts,
  pendingOrders, salesChannel, grossProfit, profitSummary, deadStock, vendorSummary,
  payroll, myHours, monthlyOverview, dailySend, exportSalesCsv,
  executiveExport, accountingSummary, accountingSummaryExport,
};
