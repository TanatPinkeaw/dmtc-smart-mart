// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 services/reports-export.js — ดึงข้อมูล + สร้างไฟล์รายงาน Excel/CSV (สรุปผู้บริหาร/บัญชีสหกรณ์)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: fetchLineItems() ดึงรายการขายทั้งหมด (POS+พรีออเดอร์) ครั้งเดียว, aggregate() รวมเป็น KPI/
//   สินค้าขายดี/แยกหมวดหมู่, buildWorkbook()/buildAccountingWorkbook() สร้างไฟล์ .xlsx ด้วย exceljs,
//   buildCsv() สร้าง CSV — reportController.js เรียกใช้ที่ endpoint /reports/executive-export ฯลฯ
// จุดสำคัญ: คำนวณ KPI ใน JS จากผลลัพธ์ query เดียว (ไม่ยิง DB ซ้ำหลายรอบ) เหมาะกับสเกลสหกรณ์
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Phase 4 Part 2 — Executive Summary export (Excel + CSV).
//
// Reuses the same combined sales+orders query pattern already established in
// /api/reports/export/sales-csv (server.js) and the same gross-profit formula used in
// /api/reports/gross-profit / /api/reports/profit-summary: normal products earn
// subtotal - cost*qty, consigned (vendor) products earn subtotal * gp_rate/100 for the co-op,
// the rest goes to the vendor.
//
// One query fetches every line item in the date range; KPIs / top products / category summary
// are all aggregated from that same result set in JS rather than four separate queries — at this
// project's scale (a single school co-op) that's simpler and cheaper than round-tripping the DB
// four times for numbers that are all derived from the same rows.

const LOW_STOCK_THRESHOLD = 10; // ⭐️ matches server.js's LOW_STOCK_THRESHOLD / /api/inventory/low-stock

async function fetchLineItems(pool, startDate, endDate) {
  const hasRange = !!(startDate && endDate);
  const params = [];
  let wSale = "s.status = 'COMPLETED'";
  let wOrder = "o.status = 'COMPLETED'";
  if (hasRange) {
    wSale += ' AND DATE(s.created_at) BETWEEN ? AND ?';
    wOrder += ' AND DATE(o.completed_at) BETWEEN ? AND ?';
    params.push(startDate, endDate, startDate, endDate);
  }

  const profitExpr = `CASE WHEN p.vendor_id IS NOT NULL THEN it.subtotal * p.gp_rate/100 ELSE it.subtotal - p.cost*it.quantity END`;

  // 🐛 FIX (root cause) — created_at/completed_at เป็น TIMESTAMP + pool ตั้ง SET time_zone='+07:00'
  // ทุก connection แล้ว MySQL คืนเป็นเวลาไทยตั้งแต่อ่านแล้ว — CONVERT_TZ(...,'+00:00','+07:00') เดิม
  // แปลงซ้ำ บวก 7 ชม.เกิน ทำให้เวลาที่โชว์ใน Transaction Details ผิด (เหมือน bug ที่แก้ไปแล้วใน
  // weekly-sales/hourly-sales/export-sales-csv — ตัดออกให้ตรงกัน)
  const [rows] = await pool.query(
    `SELECT * FROM (
      SELECT s.created_at AS sort_at,
             DATE_FORMAT(s.created_at,'%Y-%m-%d %H:%i') AS dt,
             'POS' AS channel, s.id AS transaction_id,
             p.barcode, p.name AS product_name, c.name AS category_name, p.vendor_id,
             p.cost, it.price, it.quantity, it.subtotal,
             ${profitExpr} AS profit, s.payment_method
      FROM sale_items it
      JOIN sales s ON it.sale_id = s.id
      JOIN products p ON it.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${wSale}
      UNION ALL
      SELECT o.completed_at AS sort_at,
             DATE_FORMAT(o.completed_at,'%Y-%m-%d %H:%i') AS dt,
             'พรีออเดอร์' AS channel, o.id AS transaction_id,
             p.barcode, p.name AS product_name, c.name AS category_name, p.vendor_id,
             p.cost, it.price, it.quantity, it.subtotal,
             ${profitExpr} AS profit, o.payment_method
      FROM order_items it
      JOIN orders o ON it.order_id = o.id
      JOIN products p ON it.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${wOrder}
    ) t ORDER BY sort_at DESC`,
    params
  );
  return rows;
}

async function fetchInventorySummary(pool) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(stock * cost), 0) AS total_stock_value,
            SUM(CASE WHEN stock <= ? THEN 1 ELSE 0 END) AS low_stock_count
     FROM products WHERE is_active = TRUE`,
    [LOW_STOCK_THRESHOLD]
  );
  return {
    totalStockValue: Number(row.total_stock_value),
    lowStockCount: Number(row.low_stock_count),
  };
}

async function fetchStoreName(pool) {
  const [rows] = await pool.query('SELECT store_name FROM settings WHERE id = 1');
  return rows[0]?.store_name || 'สหกรณ์วิทยาลัย';
}

function aggregate(rows) {
  let totalRevenue = 0;
  let totalProfit = 0;
  const transactionKeys = new Set(); // channel+id, since sales.id and orders.id are separate sequences
  const byProduct = new Map();
  const byCategory = new Map();

  for (const r of rows) {
    const revenue = Number(r.subtotal);
    const profit = Number(r.profit);
    totalRevenue += revenue;
    totalProfit += profit;
    transactionKeys.add(`${r.channel}-${r.transaction_id}`);

    const product = byProduct.get(r.product_name) || {
      name: r.product_name,
      category: r.category_name || 'ไม่ระบุหมวดหมู่',
      qty: 0,
      revenue: 0,
      profit: 0,
    };
    product.qty += Number(r.quantity);
    product.revenue += revenue;
    product.profit += profit;
    byProduct.set(r.product_name, product);

    // ⭐️ Update — ต้นทุนต่อรายการ: สินค้าฝากขาย (vendor_id ไม่ null) ไม่มี "ต้นทุน" ในความหมายบัญชี
    // ของสหกรณ์ (ไม่ได้ซื้อมาเก็บสต๊อกเอง) — cost ที่ใช้คือส่วนที่ต้องจ่ายคืนผู้ฝากขาย (subtotal - profit,
    // เพราะ profit ของแถวนี้คือ GP ที่ coop ได้ ดู profitExpr ด้านบน) ส่วนสินค้าสหกรณ์เองใช้ cost*qty ตรงๆ
    const itemCost = r.vendor_id != null ? revenue - profit : Number(r.cost) * Number(r.quantity);

    const catKey = r.category_name || 'ไม่ระบุหมวดหมู่';
    const category = byCategory.get(catKey) || { name: catKey, sales: 0, cost: 0, profit: 0 };
    category.sales += revenue;
    category.cost += itemCost;
    category.profit += profit;
    byCategory.set(catKey, category);
  }

  const totalOrders = transactionKeys.size;
  // ⭐️ ผู้ใช้ขอ — รายงานสรุปบัญชีสหกรณ์ต้องบอกด้วยว่าขายสินค้าอะไรบ้าง (เดิมมีแค่สรุปตามหมวดหมู่)
  // เก็บ list เต็มไม่ตัด top 10 แบบ topProducts (ใช้เฉพาะ executive summary ที่เป็นรายงาน "ขายดี"
  // ไม่ใช่บัญชี — รายงานบัญชีต้องเห็นครบทุกตัวถึงจะกระทบยอดถูก) เรียงตามรายได้มากไปน้อยเหมือนกัน
  const allProductsByRevenue = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue);
  const topProducts = allProductsByRevenue.slice(0, 10);
  const categorySummary = [...byCategory.values()]
    .sort((a, b) => b.sales - a.sales)
    .map((c) => ({ ...c, percentage: totalRevenue > 0 ? (c.sales / totalRevenue) * 100 : 0 }));

  return {
    totalRevenue,
    totalProfit,
    totalOrders,
    aov: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    topProducts,
    productBreakdown: allProductsByRevenue,
    categorySummary,
  };
}

// ⭐️ Co-op Accounting Summary — ยอดที่ต้องจ่ายคืนผู้ฝากขายแต่ละราย ในช่วงวันที่เดียวกับรายงาน
// (ของเดิม /api/reports/vendor-summary ไม่มี date range และไม่รวมพรีออเดอร์ — คนละ query กับนี่
// ตั้งใจแยก ไม่แก้ของเดิมเพราะมีหน้าอื่นพึ่งพฤติกรรม all-time อยู่)
async function fetchVendorPayouts(pool, startDate, endDate) {
  const hasRange = !!(startDate && endDate);
  const params = [];
  let wSale = "s.status = 'COMPLETED'";
  let wOrder = "o.status = 'COMPLETED'";
  if (hasRange) {
    wSale += ' AND DATE(s.created_at) BETWEEN ? AND ?';
    wOrder += ' AND DATE(o.completed_at) BETWEEN ? AND ?';
    params.push(startDate, endDate, startDate, endDate);
  }

  const [rows] = await pool.query(
    `SELECT vendor_id, vendor_name,
            SUM(qty) AS total_items_sold,
            SUM(subtotal) AS total_sales,
            SUM(subtotal * gp_rate/100) AS coop_gp_earnings,
            SUM(subtotal - subtotal * gp_rate/100) AS vendor_payout
     FROM (
       SELECT p.vendor_id, u.full_name AS vendor_name, it.quantity AS qty, it.subtotal, p.gp_rate
       FROM sale_items it
       JOIN sales s ON it.sale_id = s.id
       JOIN products p ON it.product_id = p.id
       JOIN users u ON p.vendor_id = u.id
       WHERE p.vendor_id IS NOT NULL AND ${wSale}
       UNION ALL
       SELECT p.vendor_id, u.full_name AS vendor_name, it.quantity AS qty, it.subtotal, p.gp_rate
       FROM order_items it
       JOIN orders o ON it.order_id = o.id
       JOIN products p ON it.product_id = p.id
       JOIN users u ON p.vendor_id = u.id
       WHERE p.vendor_id IS NOT NULL AND ${wOrder}
     ) combined
     GROUP BY vendor_id, vendor_name
     ORDER BY vendor_payout DESC`,
    params
  );
  return rows.map(r => ({
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    total_items_sold: Number(r.total_items_sold),
    total_sales: Number(r.total_sales),
    coop_gp_earnings: Number(r.coop_gp_earnings),
    vendor_payout: Number(r.vendor_payout),
  }));
}

// ⭐️ ExcelJS has no true "auto-fit" — approximate it from the longest rendered value per column.
function autoFitColumns(sheet, headers, rows, minWidth = 10, maxWidth = 40) {
  headers.forEach((header, i) => {
    let maxLen = String(header).length;
    for (const row of rows) {
      const len = String(row[i] ?? '').length;
      if (len > maxLen) maxLen = len;
    }
    sheet.getColumn(i + 1).width = Math.min(Math.max(maxLen + 2, minWidth), maxWidth);
  });
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const THB_FORMAT = '#,##0.00 "฿"';
const THIN_BORDER = { style: 'thin', color: { argb: 'FFCCCCCC' } };

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
}

function addGridlines(sheet, fromRow, toRow, colCount) {
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = 1; c <= colCount; c++) {
      sheet.getCell(r, c).border = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };
    }
  }
}

async function buildWorkbook({ storeName, startDate, endDate, kpis, inventory, rows }) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DMTC Mart';
  workbook.created = new Date();

  // ===== Sheet 1: Executive Summary =====
  const summary = workbook.addWorksheet('Executive Summary');
  const rangeLabel = startDate && endDate ? `${startDate} ถึง ${endDate}` : 'ทั้งหมด (ไม่ระบุช่วงวันที่)';

  summary.mergeCells('A1:F1');
  summary.getCell('A1').value = storeName;
  summary.getCell('A1').font = { bold: true, size: 16 };

  summary.mergeCells('A2:F2');
  summary.getCell('A2').value = 'Executive Summary Report';
  summary.getCell('A2').font = { bold: true, size: 13, color: { argb: 'FF2E7D32' } };

  summary.getCell('A3').value = 'ช่วงวันที่:';
  summary.getCell('B3').value = rangeLabel;
  summary.getCell('A4').value = 'วันที่สร้างรายงาน:';
  summary.getCell('B4').value = new Date().toISOString().slice(0, 19).replace('T', ' ');

  let r = 6;
  summary.getCell(`A${r}`).value = 'ตัวชี้วัดหลัก (KPI)';
  summary.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  const kpiRows = [
    ['ยอดขายรวม (Total Sales Revenue)', kpis.totalRevenue],
    ['กำไรขั้นต้นรวม (Total Gross Profit)', kpis.totalProfit],
    ['จำนวนบิลทั้งหมด (Total Orders)', kpis.totalOrders],
    ['ยอดเฉลี่ยต่อบิล (AOV)', kpis.aov],
  ];
  for (const [label, value] of kpiRows) {
    summary.getCell(`A${r}`).value = label;
    const cell = summary.getCell(`B${r}`);
    cell.value = value;
    if (label !== 'จำนวนบิลทั้งหมด (Total Orders)') cell.numFmt = THB_FORMAT;
    r += 1;
  }

  r += 1;
  summary.getCell(`A${r}`).value = 'สินค้าขายดี 10 อันดับ (Top 10 Products)';
  summary.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  const topHeaderRow = r;
  const topHeaders = ['อันดับ', 'สินค้า', 'หมวดหมู่', 'จำนวนที่ขายได้', 'ยอดขายรวม', 'กำไรรวม'];
  summary.getRow(r).values = topHeaders;
  styleHeaderRow(summary.getRow(r));
  r += 1;
  const topStart = r;
  kpis.topProducts.forEach((p, i) => {
    summary.getRow(r).values = [i + 1, p.name, p.category, p.qty, p.revenue, p.profit];
    summary.getCell(`E${r}`).numFmt = THB_FORMAT;
    summary.getCell(`F${r}`).numFmt = THB_FORMAT;
    r += 1;
  });
  if (kpis.topProducts.length > 0) addGridlines(summary, topStart, r - 1, topHeaders.length);

  r += 1;
  summary.getCell(`A${r}`).value = 'สรุปยอดขายตามหมวดหมู่ (Category Summary)';
  summary.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  summary.getRow(r).values = ['หมวดหมู่', 'ยอดขายรวม', 'สัดส่วน (%)'];
  styleHeaderRow(summary.getRow(r));
  r += 1;
  const catStart = r;
  kpis.categorySummary.forEach((c) => {
    summary.getRow(r).values = [c.name, c.sales, c.percentage];
    summary.getCell(`B${r}`).numFmt = THB_FORMAT;
    summary.getCell(`C${r}`).numFmt = '0.0"%"';
    r += 1;
  });
  if (kpis.categorySummary.length > 0) addGridlines(summary, catStart, r - 1, 3);

  r += 1;
  summary.getCell(`A${r}`).value = 'สรุปคลังสินค้า (Inventory Summary)';
  summary.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  summary.getCell(`A${r}`).value = 'มูลค่าสต๊อกรวม (Total Stock Value)';
  summary.getCell(`B${r}`).value = inventory.totalStockValue;
  summary.getCell(`B${r}`).numFmt = THB_FORMAT;
  r += 1;
  summary.getCell(`A${r}`).value = `จำนวนสินค้าใกล้หมด (Low-stock Items, ≤${LOW_STOCK_THRESHOLD} ชิ้น)`;
  summary.getCell(`B${r}`).value = inventory.lowStockCount;

  summary.getColumn(1).width = 42;
  summary.getColumn(2).width = 22;
  summary.getColumn(3).width = 18;
  summary.getColumn(4).width = 16;
  summary.getColumn(5).width = 16;
  summary.getColumn(6).width = 16;

  // ===== Sheet 2: Transaction Details =====
  const detail = workbook.addWorksheet('Transaction Details');
  const detailHeaders = [
    'วันที่-เวลา', 'เลขที่ธุรกรรม', 'บาร์โค้ด/SKU', 'สินค้า', 'หมวดหมู่',
    'ต้นทุน', 'ราคา', 'จำนวน', 'ยอดรวม', 'ช่องทางชำระ',
  ];
  detail.getRow(1).values = detailHeaders;
  styleHeaderRow(detail.getRow(1));

  const detailRows = rows.map((row) => [
    row.dt,
    `${row.channel}-${row.transaction_id}`,
    row.barcode || '-',
    row.product_name,
    row.category_name || 'ไม่ระบุหมวดหมู่',
    Number(row.cost),
    Number(row.price),
    Number(row.quantity),
    Number(row.subtotal),
    row.payment_method === 'QR' ? 'โอน/QR' : row.payment_method === 'CASH' ? 'เงินสด' : row.payment_method,
  ]);
  detailRows.forEach((values, i) => {
    const rowIdx = i + 2;
    detail.getRow(rowIdx).values = values;
    detail.getCell(`F${rowIdx}`).numFmt = THB_FORMAT;
    detail.getCell(`G${rowIdx}`).numFmt = THB_FORMAT;
    detail.getCell(`I${rowIdx}`).numFmt = THB_FORMAT;
  });
  if (detailRows.length > 0) addGridlines(detail, 2, detailRows.length + 1, detailHeaders.length);
  autoFitColumns(detail, detailHeaders, detailRows);

  return workbook;
}

// ⭐️ Co-op Accounting Summary — workbook แยกจาก buildWorkbook (executive export) เพราะโครงสร้าง
// รายงานต่างกัน (นี่เน้นบัญชี: ต้นทุน/กำไรต่อหมวดหมู่ + ยอดต้องจ่ายคืนผู้ฝากขาย ไม่ใช่ top-products)
async function buildAccountingWorkbook({ storeName, startDate, endDate, kpis, categoryBreakdown, productBreakdown, supplierPayouts }) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DMTC Mart';
  workbook.created = new Date();
  const rangeLabel = startDate && endDate ? `${startDate} ถึง ${endDate}` : 'ทั้งหมด (ไม่ระบุช่วงวันที่)';

  // ===== Sheet 1: Summary =====
  const summary = workbook.addWorksheet('สรุปบัญชี');
  summary.mergeCells('A1:E1');
  summary.getCell('A1').value = storeName;
  summary.getCell('A1').font = { bold: true, size: 16 };
  summary.mergeCells('A2:E2');
  summary.getCell('A2').value = 'รายงานสรุปบัญชีสหกรณ์ (Co-op Accounting Summary)';
  summary.getCell('A2').font = { bold: true, size: 13, color: { argb: 'FF2E7D32' } };
  summary.getCell('A3').value = 'ช่วงวันที่:';
  summary.getCell('B3').value = rangeLabel;
  summary.getCell('A4').value = 'วันที่สร้างรายงาน:';
  summary.getCell('B4').value = new Date().toISOString().slice(0, 19).replace('T', ' ');

  let r = 6;
  summary.getCell(`A${r}`).value = 'ตัวชี้วัดหลัก';
  summary.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  const kpiRows = [
    ['รายได้รวม (Total Revenue)', kpis.totalRevenue],
    ['ต้นทุนรวม (Total Cost)', kpis.totalCost],
    ['กำไรขั้นต้นรวม (Total Gross Profit)', kpis.totalProfit],
    ['จำนวนบิลทั้งหมด', kpis.totalOrders],
  ];
  for (const [label, value] of kpiRows) {
    summary.getCell(`A${r}`).value = label;
    const cell = summary.getCell(`B${r}`);
    cell.value = value;
    if (label !== 'จำนวนบิลทั้งหมด') cell.numFmt = THB_FORMAT;
    r += 1;
  }

  r += 1;
  summary.getCell(`A${r}`).value = 'สรุปตามหมวดหมู่ (Category Breakdown)';
  summary.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  const catHeaders = ['หมวดหมู่', 'รายได้', 'ต้นทุน', 'กำไร', 'สัดส่วนรายได้ (%)'];
  summary.getRow(r).values = catHeaders;
  styleHeaderRow(summary.getRow(r));
  r += 1;
  const catStart = r;
  categoryBreakdown.forEach((c) => {
    summary.getRow(r).values = [c.name, c.sales, c.cost, c.profit, c.percentage];
    summary.getCell(`B${r}`).numFmt = THB_FORMAT;
    summary.getCell(`C${r}`).numFmt = THB_FORMAT;
    summary.getCell(`D${r}`).numFmt = THB_FORMAT;
    summary.getCell(`E${r}`).numFmt = '0.0"%"';
    r += 1;
  });
  if (categoryBreakdown.length > 0) addGridlines(summary, catStart, r - 1, catHeaders.length);

  summary.getColumn(1).width = 40;
  summary.getColumn(2).width = 20;
  summary.getColumn(3).width = 20;
  summary.getColumn(4).width = 20;
  summary.getColumn(5).width = 18;

  // ===== Sheet 2: Product Breakdown =====
  // ⭐️ ผู้ใช้ขอ — บอกด้วยว่าขายสินค้าอะไรบ้าง (ไม่ใช่แค่สรุปตามหมวดหมู่) ใส่ครบทุกตัว ไม่ตัด top 10
  // (ต่างจาก executive summary ที่เป็นรายงาน "ขายดี" — นี่คือรายงานบัญชีต้องเห็นครบ)
  const productSheet = workbook.addWorksheet('สินค้าที่ขาย');
  const prodHeaders = ['สินค้า', 'หมวดหมู่', 'จำนวนที่ขายได้', 'ยอดขายรวม', 'กำไรรวม'];
  productSheet.getRow(1).values = prodHeaders;
  styleHeaderRow(productSheet.getRow(1));
  const prodRows = productBreakdown.map((p) => [p.name, p.category, p.qty, p.revenue, p.profit]);
  prodRows.forEach((values, i) => {
    const rowIdx = i + 2;
    productSheet.getRow(rowIdx).values = values;
    productSheet.getCell(`D${rowIdx}`).numFmt = THB_FORMAT;
    productSheet.getCell(`E${rowIdx}`).numFmt = THB_FORMAT;
  });
  if (prodRows.length > 0) addGridlines(productSheet, 2, prodRows.length + 1, prodHeaders.length);
  autoFitColumns(productSheet, prodHeaders, prodRows);

  // ===== Sheet 3: Supplier GP Payouts =====
  const supplierSheet = workbook.addWorksheet('ยอดจ่ายคืนผู้ฝากขาย');
  const supHeaders = ['ผู้ฝากขาย', 'จำนวนที่ขายได้ (ชิ้น)', 'ยอดขายรวม', 'ส่วนแบ่ง GP ของสหกรณ์', 'ยอดต้องจ่ายคืนผู้ฝากขาย'];
  supplierSheet.getRow(1).values = supHeaders;
  styleHeaderRow(supplierSheet.getRow(1));
  const supRows = supplierPayouts.map((v) => [v.vendor_name, v.total_items_sold, v.total_sales, v.coop_gp_earnings, v.vendor_payout]);
  supRows.forEach((values, i) => {
    const rowIdx = i + 2;
    supplierSheet.getRow(rowIdx).values = values;
    supplierSheet.getCell(`C${rowIdx}`).numFmt = THB_FORMAT;
    supplierSheet.getCell(`D${rowIdx}`).numFmt = THB_FORMAT;
    supplierSheet.getCell(`E${rowIdx}`).numFmt = THB_FORMAT;
  });
  if (supRows.length > 0) addGridlines(supplierSheet, 2, supRows.length + 1, supHeaders.length);
  autoFitColumns(supplierSheet, supHeaders, supRows);

  return workbook;
}

function buildCsv(rows) {
  const headers = [
    'วันที่-เวลา', 'เลขที่ธุรกรรม', 'บาร์โค้ด/SKU', 'สินค้า', 'หมวดหมู่',
    'ต้นทุน', 'ราคา', 'จำนวน', 'ยอดรวม', 'ช่องทางชำระ',
  ];
  const dataRows = rows.map((row) => [
    row.dt,
    `${row.channel}-${row.transaction_id}`,
    row.barcode || '-',
    row.product_name,
    row.category_name || 'ไม่ระบุหมวดหมู่',
    Number(row.cost).toFixed(2),
    Number(row.price).toFixed(2),
    row.quantity,
    Number(row.subtotal).toFixed(2),
    row.payment_method === 'QR' ? 'โอน/QR' : row.payment_method === 'CASH' ? 'เงินสด' : row.payment_method,
  ]);
  const csv = [headers, ...dataRows]
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return '﻿' + csv; // BOM so Excel reads Thai text correctly
}

module.exports = {
  fetchLineItems,
  fetchInventorySummary,
  fetchStoreName,
  fetchVendorPayouts,
  aggregate,
  buildWorkbook,
  buildAccountingWorkbook,
  buildCsv,
};
