// ⭐️ Phase A (refactor) — router รวม report endpoints (mount ที่ /api/reports ใน server.js)
// ย้ายออกจาก server.js ทีละ batch เล็ก ไม่เปลี่ยน path/พฤติกรรม — endpoint เดิม /api/reports/xxx
// ยังตอบเหมือนเดิมทุกอย่าง (เพราะ mount prefix /api/reports + path ในนี้เป็น /xxx)
const express = require('express');
const reportController = require('../controllers/reportController');

const router = express.Router();

// ⭐️ requireRole ใน server.js เป็น local function เรียกข้ามไฟล์ไม่ได้ — เขียนซ้ำแบบเดียวกับ
// adminRoutes.js/memberRoutes.js (ไม่ใช่ public path จึงผ่าน authenticateToken/requireCsrf ของ
// server.js มาก่อนแล้ว req.user จึงพร้อมใช้เสมอ)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอสำหรับการดำเนินการนี้' });
    }
    next();
  };
}

router.get('/weekly-sales', requireRole('ADMIN', 'MANAGER'), reportController.weeklySales);
router.get('/hourly-sales', requireRole('ADMIN', 'MANAGER'), reportController.hourlySales);

router.get('/attendance', requireRole('ADMIN', 'MANAGER'), reportController.attendance);
router.get('/dashboard', requireRole('CASHIER', 'ADMIN', 'MANAGER'), reportController.dashboard);
router.get('/top-selling', requireRole('CASHIER', 'ADMIN', 'MANAGER'), reportController.topSelling);
// ⭐️ ไม่มี requireRole ตั้งใจ — self-scoped ด้วย ownership check ในตัว handler เอง (ดู comment ใน
// reportController.js) authenticateToken (global middleware) รับรอง req.user อยู่แล้ว
router.get('/vendor-sales', reportController.vendorSales);
router.get('/vendor-sales/detail', reportController.vendorSalesDetail);
router.get('/void-summary', requireRole('ADMIN', 'MANAGER'), reportController.voidSummary);
router.get('/shift-anomalies', requireRole('ADMIN', 'MANAGER'), reportController.shiftAnomalies);
router.get('/sales-comparison', requireRole('ADMIN', 'MANAGER'), reportController.salesComparison);
router.get('/sales-by-cashier', requireRole('ADMIN', 'MANAGER'), reportController.salesByCashier);
router.get('/open-shifts', requireRole('ADMIN', 'MANAGER'), reportController.openShifts);
router.get('/pending-orders', requireRole('ADMIN', 'MANAGER'), reportController.pendingOrders);
router.get('/sales-channel', requireRole('ADMIN', 'MANAGER'), reportController.salesChannel);
router.get('/gross-profit', requireRole('ADMIN', 'MANAGER'), reportController.grossProfit);
router.get('/profit-summary', requireRole('ADMIN', 'MANAGER'), reportController.profitSummary);
router.get('/dead-stock', requireRole('ADMIN', 'MANAGER'), reportController.deadStock);
router.get('/vendor-summary', requireRole('ADMIN', 'MANAGER'), reportController.vendorSummary);

router.get('/payroll', requireRole('ADMIN'), reportController.payroll);
router.get('/my-hours', requireRole('ADMIN', 'CASHIER', 'MANAGER'), reportController.myHours);
router.get('/monthly-overview', requireRole('ADMIN', 'MANAGER'), reportController.monthlyOverview);
router.post('/daily/send', requireRole('ADMIN'), reportController.dailySend);
router.get('/export/sales-csv', requireRole('ADMIN', 'MANAGER'), reportController.exportSalesCsv);
router.get('/executive-export', requireRole('ADMIN', 'MANAGER'), reportController.executiveExport);
router.get('/accounting-summary', requireRole('ADMIN', 'MANAGER'), reportController.accountingSummary);
router.get('/accounting-summary/export', requireRole('ADMIN', 'MANAGER'), reportController.accountingSummaryExport);

module.exports = router;
