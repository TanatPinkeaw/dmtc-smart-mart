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
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
// ⭐️ Rich Menu — สร้าง/ตั้งค่าเมนูใช้ api.line.me ปกติ แต่ "อัปโหลดรูปกราฟิก" ต้องยิงไปคนละโดเมน
// (api-data.line.me) ตามที่ LINE Messaging API กำหนดไว้ — พลาดจุดนี้จุดเดียวจะได้ 404 งงๆ
const LINE_RICHMENU_URL = 'https://api.line.me/v2/bot/richmenu';
const LINE_RICHMENU_CONTENT_URL = 'https://api-data.line.me/v2/bot/richmenu';
const LINE_RICHMENU_DEFAULT_URL = 'https://api.line.me/v2/bot/user/all/richmenu';
const RICHMENU_MIME_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

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

// ⭐️ Reply message — ตอบกลับ event จาก webhook ด้วย replyToken (ต่างจาก push ตรงที่ไม่คิดโควตา
// message และตอบได้เฉพาะภายใน ~30 วิหลังรับ event) ใช้กับ Rich Menu / ข้อความที่ผู้ใช้พิมพ์เข้ามา
// fail-soft เหมือน pushLineMessage — ไม่ throw, คืน true/false
async function replyLineMessage(replyToken, messages) {
  if (!LINE_ENABLED) {
    console.log(`💬 [DEV/ไม่มี LINE token] จะตอบกลับ (reply) ด้วย:`, JSON.stringify(messages));
    return false;
  }
  if (!replyToken) {
    console.warn('⚠️ LINE reply: ไม่มี replyToken — ข้าม');
    return false;
  }
  try {
    const res = await fetch(LINE_REPLY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`❌ ตอบกลับ LINE (reply) ล้มเหลว: ${res.status} ${res.statusText} — ${errBody}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('❌ ตอบกลับ LINE (reply) ล้มเหลว (network):', err.message);
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

// ⭐️ Rich Menu setup — สร้าง + อัปโหลดรูป + ตั้งเป็นเมนูเริ่มต้นของทุกคน (3 เรียก API ต่อกัน)
// ต่างจาก pushLineMessage/sendLowStockAlert ตรงที่ฟังก์ชันนี้ตั้งใจ throw จริงถ้าพัง (ไม่ fail-soft)
// เพราะเป็นคำสั่ง manual setup ที่รันครั้งเดียวผ่าน CLI (src/scripts/setup-richmenu.js) ไม่ใช่ auto
// trigger จาก transaction ขายของ — ถ้าพังกลางทาง ผู้รันต้องเห็น error ทันทีเพื่อไปเคลียร์ rich menu
// ที่ค้างสร้างไปแล้วบางส่วน (เช่น สร้างสำเร็จแต่ upload รูปพัง) ด้วยตัวเอง ไม่ใช่ปล่อยเงียบ
//
// ⚠️ คำเตือน — ฟังก์ชันนี้เปลี่ยนเมนูจริงที่ผู้ใช้ LINE OA "ทุกคน" เห็นทันทีที่ตั้งเป็น default สำเร็จ
// (ไม่ใช่แค่ dev/test) ต้องรันด้วยความตั้งใจเท่านั้น ไม่ควรเรียกจากโค้ดที่ทำงานอัตโนมัติ/ทดสอบ
//
// imagePath: path ไปยังไฟล์รูป .jpg/.jpeg/.png ขนาด 2500x1686px (คนละไฟล์กับ richmenu-config.json
// ซึ่งเป็นแค่โครงสร้างปุ่ม/พิกัด — ไฟล์รูปกราฟิกต้องออกแบบแยกต่างหากให้ตรงเลย์เอาต์เดียวกัน)
// richMenuConfig: object ตาม schema ของ POST /v2/bot/richmenu (default: richmenu-config.json ในโฟลเดอร์นี้)
async function createAndSetDefaultRichMenu(imagePath, richMenuConfig) {
  if (!config.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่าใน .env — ตั้ง Rich Menu ไม่ได้');
  }
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error(`ไม่พบไฟล์รูป Rich Menu: ${imagePath} — ต้องเตรียมไฟล์ .jpg/.png ขนาด 2500x1686px ก่อน`);
  }
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = RICHMENU_MIME_TYPES[ext];
  if (!mimeType) {
    throw new Error(`นามสกุลไฟล์รูปไม่รองรับ: ${ext} — LINE Rich Menu รับเฉพาะ .jpg/.jpeg/.png เท่านั้น`);
  }

  const menuBody = richMenuConfig || require('../config/richmenu-config.json');
  const authHeaders = { 'Authorization': `Bearer ${config.LINE_CHANNEL_ACCESS_TOKEN}` };

  // 1) สร้าง Rich Menu (โครงสร้างปุ่ม/พิกัด/action) — ได้ richMenuId กลับมา
  console.log('💬 [Rich Menu] กำลังสร้าง Rich Menu...');
  const createRes = await fetch(LINE_RICHMENU_URL, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(menuBody),
  });
  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => '');
    throw new Error(`สร้าง Rich Menu ไม่สำเร็จ: ${createRes.status} ${createRes.statusText} — ${errBody}`);
  }
  const { richMenuId } = await createRes.json();
  console.log(`💬 [Rich Menu] สร้างสำเร็จ richMenuId=${richMenuId}`);

  // 2) อัปโหลดรูปกราฟิก — ยิงไป api-data.line.me (คนละโดเมนจากขั้นตอนอื่น) body เป็น raw binary
  console.log('💬 [Rich Menu] กำลังอัปโหลดรูปภาพ...');
  const imageBuffer = fs.readFileSync(imagePath);
  const uploadRes = await fetch(`${LINE_RICHMENU_CONTENT_URL}/${richMenuId}/content`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': mimeType },
    body: imageBuffer,
  });
  if (!uploadRes.ok) {
    const errBody = await uploadRes.text().catch(() => '');
    throw new Error(
      `อัปโหลดรูป Rich Menu ไม่สำเร็จ: ${uploadRes.status} ${uploadRes.statusText} — ${errBody}\n` +
      `หมายเหตุ: Rich Menu id=${richMenuId} ถูกสร้างไปแล้วแต่ยังไม่มีรูป — ลบทิ้งเองด้วย DELETE ${LINE_RICHMENU_URL}/${richMenuId} ถ้าจะสร้างใหม่`
    );
  }
  console.log('💬 [Rich Menu] อัปโหลดรูปสำเร็จ');

  // 3) ตั้งเป็นเมนูเริ่มต้นของผู้ใช้ทุกคน — มีผลทันที
  console.log('💬 [Rich Menu] กำลังตั้งเป็นเมนูเริ่มต้น...');
  const defaultRes = await fetch(`${LINE_RICHMENU_DEFAULT_URL}/${richMenuId}`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!defaultRes.ok) {
    const errBody = await defaultRes.text().catch(() => '');
    throw new Error(
      `ตั้งเป็น Default Rich Menu ไม่สำเร็จ: ${defaultRes.status} ${defaultRes.statusText} — ${errBody}\n` +
      `หมายเหตุ: Rich Menu id=${richMenuId} สร้าง+อัปโหลดรูปสำเร็จแล้ว แค่ยังไม่ได้ตั้งเป็น default — ลองตั้งเองด้วย POST ${LINE_RICHMENU_DEFAULT_URL}/${richMenuId}`
    );
  }
  console.log(`💬 [Rich Menu] ✅ ตั้งเป็นเมนูเริ่มต้นสำเร็จ — ผู้ใช้ LINE OA ทุกคนจะเห็นเมนูใหม่นี้ทันที (richMenuId=${richMenuId})`);

  return { richMenuId };
}

module.exports = {
  pushLineMessage, replyLineMessage, sendLowStockAlert, sendPreOrderReadyNotification,
  createAndSetDefaultRichMenu, LINE_ENABLED,
};
