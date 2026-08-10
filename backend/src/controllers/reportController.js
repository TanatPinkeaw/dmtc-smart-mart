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

// GET /api/reports/attendance — เข้า-ออกงานเทียบตารางเวร (schedules) หา late_minutes
async function attendance(req, res) {
  try {
    const { month } = req.query; // 'YYYY-MM'
    const monthClause = month ? `AND DATE_FORMAT(work_date, '%Y-%m') = ?` : '';
    const params = month ? [month] : [];

    const [rows] = await pool.query(`
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
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/dashboard — ยอดขายวันนี้ (POS + พรีออเดอร์ที่มารับแล้ว) แยกช่องทางชำระ
async function dashboard(req, res) {
  try {
    // ⭐️ รวมยอดขายหน้าร้าน (sales) กับบิลจากการจองที่ลูกค้ามารับแล้ว (orders สถานะ COMPLETED)
    // นับ orders เข้าวันที่ "มารับจริง" (completed_at) ไม่ใช่วันที่จอง (created_at)
    const [rows] = await pool.query(`
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
      date: new Date().toISOString().split('T')[0],
      summary: rows[0]
    });
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/top-selling — สินค้าขายดี 10 อันดับ (POS + พรีออเดอร์ COMPLETED)
async function topSelling(req, res) {
  try {
    // ⭐️ รวมรายการจาก sale_items (ขายหน้าร้าน) กับ order_items (บิลจองที่ COMPLETED แล้ว)
    const [rows] = await pool.query(`
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
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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
        return res.status(403).json({ error: "ดูได้เฉพาะยอดฝากขายของตัวเองเท่านั้น" });
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

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/vendor-sales/detail — รายสินค้าของ vendor คนเดียว (self-scoped เหมือน vendor-sales)
async function vendorSalesDetail(req, res) {
  try {
    const { vendor_id } = req.query;
    if (!vendor_id) return res.status(400).json({ error: 'ต้องระบุ vendor_id' });

    if (req.user.role !== 'ADMIN' && Number(vendor_id) !== req.user.id) {
      return res.status(403).json({ error: "ดูได้เฉพาะยอดฝากขายของตัวเองเท่านั้น" });
    }

    const [rows] = await pool.query(`
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
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/void-summary — จำนวน/ยอดบิลที่ยกเลิกวันนี้
async function voidSummary(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT COUNT(id) as void_count, COALESCE(SUM(total_amount), 0) as void_amount
      FROM sales
      WHERE status = 'VOIDED' AND DATE(created_at) = CURDATE()
    `);
    res.json(rows[0]);
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/shift-anomalies — กะที่ปิดวันนี้แล้วเงินขาด/เกิน >20 บาท
async function shiftAnomalies(req, res) {
  try {
    // tolerance ±20 บาท ถือว่าปกติ เกินกว่านี้ = ผิดปกติ
    const [rows] = await pool.query(`
      SELECT sh.id, sh.difference, sh.closed_at, u.full_name as cashier_name
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      WHERE sh.status = 'CLOSED' AND DATE(sh.closed_at) = CURDATE() AND ABS(sh.difference) > 20
      ORDER BY ABS(sh.difference) DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/sales-comparison — ยอดวันนี้ เทียบเมื่อวาน/สัปดาห์ก่อน (%)
async function salesComparison(req, res) {
  try {
    // ยอดต่อวัน = sales (created_at) + orders COMPLETED (completed_at)
    const dayTotal = async (dateExpr) => {
      const [rows] = await pool.query(`
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
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/sales-by-cashier — ยอดขายต่อกะของวันนี้ แยกรายแคชเชียร์
async function salesByCashier(req, res) {
  try {
    // ⭐️ หมวด 6: JOIN sales.shift_id = shifts.id แม่นกว่าเทียบช่วงเวลา (รองรับเปิดกะซ้อนเวลากันหลายคน)
    // บิลเก่าก่อนมีคอลัมน์ shift_id จะไม่ถูกนับในรายงานนี้ (shift_id เป็น NULL)
    const [rows] = await pool.query(`
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
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/open-shifts — กะที่เปิดอยู่ตอนนี้ทั้งหมด
async function openShifts(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT sh.id, sh.opening_cash, sh.opened_at, u.full_name as cashier_name
      FROM shifts sh
      JOIN users u ON sh.cashier_id = u.id
      WHERE sh.status = 'OPEN'
      ORDER BY sh.opened_at ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/pending-orders — จำนวน/ยอดออเดอร์ที่ยังไม่จบ (ไม่ใช่ COMPLETED/CANCELLED) แยกตาม status
async function pendingOrders(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT status, COUNT(id) as count, COALESCE(SUM(total_amount),0) as total
      FROM orders
      WHERE status NOT IN ('COMPLETED', 'CANCELLED')
      GROUP BY status
    `);
    res.json(rows);
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/sales-channel — ยอดวันนี้ แยกหน้าร้าน vs พรีออเดอร์
async function salesChannel(req, res) {
  try {
    const [walkin] = await pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM sales WHERE status='COMPLETED' AND DATE(created_at)=CURDATE()`);
    const [preorder] = await pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM orders WHERE status='COMPLETED' AND DATE(completed_at)=CURDATE()`);
    res.json({ walkin_sales: Number(walkin[0].total), preorder_sales: Number(preorder[0].total) });
  } catch (error) {
    console.error('[500]', error.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/gross-profit — กำไรขั้นต้นวันนี้ (หัก GP คืน vendor แล้ว)
async function grossProfit(req, res) {
  try {
    // กำไรขั้นต้น = subtotal - (cost * qty) - GP ที่ต้องคืน vendor (เฉพาะสินค้าฝากขาย)
    // GP สหกรณ์ = subtotal * gp_rate/100 คือส่วนที่สหกรณ์ได้ ส่วน vendor_earnings คืน vendor
    // กำไรจริงของสหกรณ์: สินค้าปกติ = subtotal - cost*qty ; สินค้าฝากขาย = subtotal * gp_rate/100
    const [rows] = await pool.query(`
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
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
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
    const [rows] = await pool.query(`
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
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/dead-stock — สินค้าที่มีสต๊อกแต่ไม่ขายเลยใน 30 วันล่าสุด (top 20 by stock)
async function deadStock(req, res) {
  try {
    const [rows] = await pool.query(`
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
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

// GET /api/reports/vendor-summary — สรุปยอดฝากขายทุก vendor รวม (ADMIN/MANAGER เท่านั้น ไม่ scope ตัวเอง)
async function vendorSummary(req, res) {
  try {
    const [rows] = await pool.query(`
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
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ภายหลัง' });
  }
}

module.exports = {
  weeklySales, hourlySales,
  attendance, dashboard, topSelling, vendorSales, vendorSalesDetail,
  voidSummary, shiftAnomalies, salesComparison, salesByCashier, openShifts,
  pendingOrders, salesChannel, grossProfit, profitSummary, deadStock, vendorSummary,
};
