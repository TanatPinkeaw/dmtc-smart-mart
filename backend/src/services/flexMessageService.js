// ⭐️ LINE Flex Message — เวอร์ชันสวยของ 3 การแจ้งเตือนที่ lineService.js ส่งเป็น plain text อยู่แล้ว
// (sendPreOrderReadyNotification / sendLowStockAlert) บวกอันใหม่ (สรุปปิดกะ) ใช้ pushLineMessage()
// จาก lineService.js เป็นตัวส่งจริงตัวเดียวกัน — fail-soft/logging/LINE_ENABLED check ทั้งหมดอยู่
// ที่นั่นแล้ว ไฟล์นี้แค่ประกอบ JSON ของ Flex Message (Bubble container) แล้วส่งต่อ ไม่ยิง fetch เอง
//
// ⚠️ เหมือน pushLineMessage อื่นๆ — ห้ามเรียกจากในนี้ database transaction ยังเปิดอยู่ ต้องเรียกหลัง
// commit เสมอ (การแจ้งเตือน LINE ล่ม ไม่ควรทำให้ธุรกรรมขายของ/ปิดกะ/พรีออเดอร์ rollback ไปด้วย)
const { pushLineMessage } = require('./lineService');
const config = require('../config/config');

const BRAND_PINK = '#F12B6B';
const WARNING_RED = '#E53E3E';
const NAVY = '#2D3748';
const LIFF_URL = 'https://liff.line.me/2010928001-YxK4Atjv';

// ⭐️ ใช้ path เดียวกับที่ frontend มีจริง (App.tsx) — /inventory (RequireStaff) และ /summary (RequireManager)
const INVENTORY_URL = `${config.FRONTEND_URL}/inventory`;

function baht(value) {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return (Number.isFinite(n) ? n : 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function headerBox(bgColor, titleTh, titleEn) {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: bgColor,
    paddingAll: '16px',
    contents: [
      { type: 'text', text: titleTh, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
      { type: 'text', text: titleEn, color: '#FFFFFFCC', size: 'xs', margin: 'xs' },
    ],
  };
}

// label ซ้าย / value ขวา หนึ่งแถว — ใช้ซ้ำในทั้ง 3 flex message
function row(label, value, opts) {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#718096', flex: 2 },
      { type: 'text', text: String(value), size: 'sm', color: (opts && opts.color) || '#2D3748', weight: (opts && opts.bold) ? 'bold' : 'regular', flex: 3, align: 'end', wrap: true },
    ],
  };
}

function footerButton(uri, label, color) {
  return {
    type: 'box',
    layout: 'vertical',
    paddingAll: '12px',
    contents: [
      {
        type: 'button',
        style: 'primary',
        color,
        height: 'sm',
        action: { type: 'uri', label, uri },
      },
    ],
  };
}

// ⭐️ 1) แจ้งลูกค้า — พรีออเดอร์พร้อมรับแล้ว (staff เปลี่ยนสถานะเป็น READY_FOR_PICKUP)
// orderData: { id, items: [{ name, quantity }], pickup_location? }
async function sendPreOrderReadyFlex(lineUserId, orderData) {
  if (!orderData) return false;
  const items = orderData.items || [];
  const pickupLocation = orderData.pickup_location || 'ร้านสหกรณ์ DMTC Smart Mart';

  const itemRows = items.length > 0
    ? items.map(i => row(i.name, `x${i.quantity}`))
    : [{ type: 'text', text: '(ไม่มีรายการ)', size: 'sm', color: '#A0AEC0' }];

  const bubble = {
    type: 'bubble',
    header: headerBox(BRAND_PINK, '📦 สินค้าพรีออเดอร์พร้อมรับแล้ว!', 'Pre-order Ready'),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '20px',
      contents: [
        row('เลขที่ออเดอร์', `#${orderData.id}`, { bold: true }),
        { type: 'separator', margin: 'md' },
        { type: 'text', text: 'รายการสินค้า', weight: 'bold', size: 'sm', margin: 'md' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'sm', contents: itemRows },
        { type: 'separator', margin: 'md' },
        row('จุดรับสินค้า', pickupLocation, { bold: true, color: BRAND_PINK }),
      ],
    },
    footer: footerButton(LIFF_URL, 'ดูรายละเอียด / QR สมาชิก', BRAND_PINK),
  };

  return pushLineMessage(lineUserId, [
    { type: 'flex', altText: `📦 ออเดอร์ #${orderData.id} พร้อมรับแล้ว!`, contents: bubble },
  ]);
}

// ⭐️ 2) แจ้งผู้จัดการ — สินค้าใกล้หมด (สต๊อกต่ำกว่า min_stock หลังขาย/ปรับสต๊อก)
// productData: { name, barcode, stock, min_stock }
async function sendLowStockAlertFlex(managerLineUserId, productData) {
  if (!productData) return false;

  const bubble = {
    type: 'bubble',
    header: headerBox(WARNING_RED, '⚠️ แจ้งเตือนสินค้าใกล้หมด', 'Low Stock Alert'),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '20px',
      contents: [
        row('ชื่อสินค้า', productData.name, { bold: true }),
        row('บาร์โค้ด', productData.barcode || '-'),
        { type: 'separator', margin: 'md' },
        row('สต๊อกปัจจุบัน', `${productData.stock} ชิ้น`, { bold: true, color: WARNING_RED }),
        row('ขั้นต่ำที่ตั้งไว้', `${productData.min_stock} ชิ้น`),
      ],
    },
    footer: footerButton(INVENTORY_URL, 'ไปหน้าจัดการคลัง / Manage Inventory', WARNING_RED),
  };

  return pushLineMessage(managerLineUserId, [
    { type: 'flex', altText: `⚠️ ${productData.name} เหลือ ${productData.stock} ชิ้น (ต่ำกว่าขั้นต่ำ)`, contents: bubble },
  ]);
}

// ⭐️ 3) แจ้งผู้จัดการ — สรุปปิดกะ (แคชเชียร์ยื่นปิดกะ หรือผู้จัดการอนุมัติ)
// shiftData: { cashier_name, duration, total_sales, cash_received, promptpay_sales, discrepancy_amount? }
async function sendShiftClosedSummaryFlex(managerLineUserId, shiftData) {
  if (!shiftData) return false;
  const discrepancy = Number(shiftData.discrepancy_amount || 0);
  const hasDiscrepancy = discrepancy !== 0;

  const bodyContents = [
    row('แคชเชียร์', shiftData.cashier_name, { bold: true }),
    row('ระยะเวลากะ', shiftData.duration || '-'),
    { type: 'separator', margin: 'md' },
    row('ยอดขายรวม', `${baht(shiftData.total_sales)} บาท`, { bold: true }),
    row('รับเงินสด', `${baht(shiftData.cash_received)} บาท`),
    row('รับ PromptPay', `${baht(shiftData.promptpay_sales)} บาท`),
  ];

  if (hasDiscrepancy) {
    bodyContents.push({ type: 'separator', margin: 'md' });
    bodyContents.push(row(
      'ส่วนต่างเงินสด',
      `${discrepancy > 0 ? '+' : ''}${baht(discrepancy)} บาท`,
      { bold: true, color: discrepancy < 0 ? WARNING_RED : '#2F855A' }
    ));
  }

  const bubble = {
    type: 'bubble',
    header: headerBox(NAVY, '📊 สรุปรายงานการปิดกะ', 'Shift Summary Report'),
    body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px', contents: bodyContents },
  };

  return pushLineMessage(managerLineUserId, [
    { type: 'flex', altText: `📊 สรุปปิดกะ ${shiftData.cashier_name} — ยอดขาย ${baht(shiftData.total_sales)} บาท`, contents: bubble },
  ]);
}

module.exports = { sendPreOrderReadyFlex, sendLowStockAlertFlex, sendShiftClosedSummaryFlex };
