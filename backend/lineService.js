// ⭐️ Day 3 — LINE Messaging API integration. Push-only (no webhook receiver in this app), so this
// uses plain `fetch` against LINE's REST push endpoint directly rather than pulling in
// @line/bot-sdk as a dependency for a single call — same "don't add a package for one HTTP call"
// judgment already used elsewhere in this backend (e.g. Cloudinary raw fetch in cloudinary-config.js).
//
// Fails soft on purpose, same pattern as mailer.js: if LINE isn't configured (no access token —
// e.g. local dev before the manager sets up a channel), these functions log and return instead of
// throwing — a missing/misconfigured LINE channel must never break a checkout, an offline sync
// batch, a shift close, or an order-status update. Never call this from inside a DB transaction —
// always after commit, since a network call to LINE's API has no business holding a DB connection
// or blocking a legitimate sale on a notification failure.
const config = require('./config');

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

// ⭐️ ใช้เช็คจากภายนอกไฟล์นี้ได้ (เช่น log ตอน boot ว่า LINE เปิดใช้งานอยู่ไหม) โดยไม่ต้อง export ทุกอย่าง
const LINE_ENABLED = !!config.LINE_CHANNEL_ACCESS_TOKEN;
if (LINE_ENABLED) {
  console.log('💬 LINE Messaging API: ENABLED');
} else {
  console.log('💬 LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า — จะ log แทนการส่ง LINE message จริง');
}

// ส่ง push message ไปยัง userId/groupId ที่ระบุ — คืน true ถ้าส่งสำเร็จ, false ถ้าข้าม/ล้มเหลว
// (ไม่ throw — ผู้เรียกไม่ต้องดัก try/catch เอง เหมือน mailer.js's sendMail())
async function pushLineMessage(to, messages) {
  if (!LINE_ENABLED) {
    console.log(`💬 [DEV/ไม่มี LINE token] จะส่ง LINE message ถึง ${to}:`, JSON.stringify(messages));
    return false;
  }
  if (!to) {
    console.warn('⚠️ LINE: ไม่มีปลายทาง (to) — ข้ามการส่ง');
    return false;
  }

  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ to, messages }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`❌ ส่ง LINE message ล้มเหลว: ${res.status} ${res.statusText} — ${errBody}`);
      return false;
    }
    console.log(`💬 ส่ง LINE message ถึง ${to} สำเร็จ`);
    return true;
  } catch (err) {
    console.error('❌ ส่ง LINE message ล้มเหลว (network):', err.message);
    return false;
  }
}

// ⭐️ Low stock alert — ส่งรายการสินค้าใกล้หมดแบบรวมเป็นข้อความเดียว (ไม่ยิงทีละชิ้น กันสแปมกลุ่ม LINE
// ถ้าบิลเดียวมีของใกล้หมดหลายรายการพร้อมกัน) ไปยัง LINE_MANAGER_GROUP_ID
// lowStockProducts: [{ name, stock, min_stock }]
async function sendLowStockAlert(lowStockProducts) {
  if (!lowStockProducts || lowStockProducts.length === 0) return false;
  if (!config.LINE_MANAGER_GROUP_ID) {
    console.log(`💬 LINE_MANAGER_GROUP_ID ยังไม่ได้ตั้งค่า — ข้ามแจ้งเตือนสต๊อกใกล้หมด (${lowStockProducts.length} รายการ) ผ่าน LINE`);
    return false;
  }

  const lines = lowStockProducts
    .map(p => `• ${p.name} — เหลือ ${p.stock} ชิ้น (ขั้นต่ำ ${p.min_stock})`)
    .join('\n');
  const text = `⚠️ แจ้งเตือนสต๊อกใกล้หมด (${lowStockProducts.length} รายการ)\n\n${lines}`;

  return pushLineMessage(config.LINE_MANAGER_GROUP_ID, [{ type: 'text', text }]);
}

// ⭐️ PreOrder ready alert — แจ้งลูกค้าตรงตัวผ่าน LINE ว่าออเดอร์พร้อมรับแล้ว
// preorder: { id, line_user_id, items: [{ name, quantity }] }
async function sendPreOrderReadyNotification(preorder) {
  if (!preorder) return false;
  if (!preorder.line_user_id) {
    console.log(`💬 ออเดอร์ #${preorder.id} ไม่มี line_user_id ผูกไว้กับบัญชี — ข้ามแจ้งเตือน LINE (แจ้งผ่านระบบแจ้งเตือนในแอปแทน)`);
    return false;
  }

  const itemsList = (preorder.items || []).map(i => `• ${i.name} x${i.quantity}`).join('\n');
  const text = [
    `📦 ออเดอร์ #${preorder.id} ของคุณพร้อมรับแล้ว!`,
    itemsList,
    'กรุณามารับที่ร้านสหกรณ์ได้เลยค่ะ',
  ].filter(Boolean).join('\n\n');

  return pushLineMessage(preorder.line_user_id, [{ type: 'text', text }]);
}

module.exports = { pushLineMessage, sendLowStockAlert, sendPreOrderReadyNotification, LINE_ENABLED };
