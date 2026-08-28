// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 controllers/lineWebhookController.js — รับ event จาก LINE (ปุ่ม Rich Menu / ข้อความ) แล้วตอบกลับ
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: handler ของ POST /api/line/webhook — LINE ยิง event เข้ามาเมื่อผู้ใช้กดเมนู/พิมพ์ข้อความ
//   แล้วไฟล์นี้ตอบกลับ (สถานะการจอง/โปร/บัตรสมาชิก/ลิงก์ประวัติซื้อ) — ต่างจาก lineService.js ที่ push อย่างเดียว
// จุดสำคัญ: (1) ตรวจ X-Line-Signature ด้วย CHANNEL_SECRET กัน request ปลอม (ใช้ req.rawBody)
//   (2) ตอบ HTTP 200 เร็วก่อน แล้วค่อยประมวลผล กัน LINE retry (3) ตอบด้วย replyToken ประหยัดโควตา
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ LINE Webhook receiver — ตอบกลับปุ่ม Rich Menu / ข้อความที่ผู้ใช้พิมพ์เข้ามาใน LINE OA
//
// ต่างจากส่วน push-only เดิม (lineService.js) ตรงที่ไฟล์นี้ "รับ" event เข้ามา จึงต้อง:
//   1) ตรวจ signature (X-Line-Signature) ด้วย LINE_CHANNEL_SECRET กัน request ปลอม — ต้องใช้ raw body
//      (ดู server.js: express.json({ verify }) เก็บ req.rawBody ไว้ให้)
//   2) ตอบ HTTP 200 กลับ LINE ให้เร็ว ไม่งั้น LINE จะ retry ซ้ำ — จึง res 200 ก่อน แล้วค่อยประมวลผล event
//   3) ตอบผู้ใช้ด้วย replyToken (replyLineMessage) ไม่ใช่ push (ประหยัดโควตา + ตอบได้ใน ~30 วิ)
//
// รองรับ: สถานะการจอง (pre-order), โปรโมชั่น, บัตรสมาชิก/แต้ม, ประวัติการซื้อ/ใบเสร็จ (ลิงก์ LIFF ไปหน้า
// ประวัติออเดอร์บนเว็บโดยตรง — ให้ผู้ใช้เลือกวันที่เองบนเว็บ แทนการทำ DateTimePicker ในแชท LINE ซึ่งมี
// ข้อจำกัดเรื่อง deep-link/cookie มากกว่า), ลิงก์สั่งจอง, ติดต่อแอดมิน
// หมายเหตุ: ระบบลงเวลาทำงาน (clock-in/out) ผ่าน LINE ถูกถอดออกแล้ว — จัดการผ่านเว็บแพลตฟอร์มแทน
// ⭐️ โทนคำตอบทั้งหมด: สุภาพแต่เป็นกันเอง (ลงท้ายด้วย "ครับ/น้า/น้าค้าบ" ผสมกัน) ตามที่ผู้ใช้ระบุไว้
const crypto = require('crypto');
// ⭐️ Multi-tenant: pool removed — use req.db (injected by tenantDB middleware)
const config = require('../config/config');
const { replyLineMessage } = require('../services/lineService');

// LIFF สมัคร/ผูกบัญชีสมาชิก (ตรงกับ richmenu-config.json ปุ่ม "สมัคร/บัตรสมาชิก") — คนละ liff app กับ
// ตัวหลัก (ของเดิมก่อนรวม liffId — เก็บไว้ตามที่เคย deploy จริงใน richmenu-config.json)
const LIFF_REGISTER_URL = 'https://liff.line.me/2010928001-YxK4Atjv';
const PREORDER_URL = `${config.FRONTEND_URL}/pre-order`;
// ⭐️ ลิงก์ประวัติการซื้อ — ผ่าน liff.line.me ตัวหลักเดียวกับ auto-login flow (utils/liff.ts ฝั่ง
// frontend ใช้ liffId นี้เป็นค่า default) พร้อม ?view=orders ต่อท้าย ?path=/pre-order ให้ Login.tsx
// forward ต่อไปเปิดโมดัลประวัติออเดอร์ทันที (ไม่ใช่หน้า /my-orders แยกต่างหาก — แอปนี้ไม่มีหน้านั้น
// ประวัติออเดอร์เป็นโมดัลใน /pre-order)
const MY_ORDERS_LIFF_URL = 'https://liff.line.me/2010928001-sEGaB0XN?path=/pre-order&view=orders';

// ⭐️ ออเดอร์ที่ถือว่า "จบแล้ว" (ไม่นับเป็นการจองที่กำลังดำเนินอยู่) — ที่เหลือถือเป็น active/pending
const ORDER_TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED', 'SLIP_REJECTED'];
const ORDER_STATUS_LABEL = {
  PENDING_VERIFY: 'รอตรวจสลิป',
  WAITING_CASH: 'รอชำระเงินสด',
  VERIFIED: 'ยืนยันการชำระแล้ว',
  PREPARING: 'กำลังเตรียมสินค้า',
  READY: 'พร้อมให้รับสินค้า',
  PENDING: 'รอดำเนินการ',
  PENDING_APPROVAL: 'รออนุมัติ',
  // 🐛 FIX — เดิมไม่มี label → โชว์โค้ดดิบ "REFUND_REQUESTED" ให้ลูกค้าในแชท LINE
  REFUND_REQUESTED: 'กำลังดำเนินการคืนเงิน',
};

function text(t) {
  return { type: 'text', text: t };
}

// ตรวจ signature: คืน true/false ถ้าตรวจได้, คืน null ถ้าไม่มี CHANNEL_SECRET (dev — ข้ามการตรวจ)
function verifySignature(rawBody, signature) {
  if (!config.LINE_CHANNEL_SECRET) return null;
  if (!rawBody || !signature) return false;
  const hash = crypto.createHmac('sha256', config.LINE_CHANNEL_SECRET).update(rawBody).digest('base64');
  // timingSafeEqual กัน timing attack — ความยาวต้องเท่ากันก่อน ไม่งั้น throw
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function findUserByLine(lineUserId, db) {
  if (!lineUserId) return null;
  const [rows] = await db.query(
    'SELECT id, student_id, full_name, role, points, line_user_id FROM users WHERE line_user_id = ? LIMIT 1',
    [lineUserId]
  );
  return rows[0] || null;
}

function notRegisteredReply() {
  return text(`ยังไม่ได้ผูกบัญชีสมาชิก 🙏\nกรุณาสมัคร/ผูกบัญชีที่นี่ก่อน แล้วลองใหม่อีกครั้ง:\n${LIFF_REGISTER_URL}`);
}

// ---- command handlers ----

function handleMemberCard(user) {
  if (!user) return notRegisteredReply();
  return text(
    `💳 บัตรสมาชิก DMTC Smart Mart\n\n👤 ${user.full_name}\n🆔 ${user.student_id}\n⭐ แต้มสะสม: ${Number(user.points || 0).toLocaleString()} แต้ม`
  );
}

function handlePoints(user) {
  if (!user) return notRegisteredReply();
  return text(`⭐ คุณ ${user.full_name}\nมีแต้มสะสมทั้งหมด ${Number(user.points || 0).toLocaleString()} แต้ม`);
}

// ⭐️ Feature 2 — เช็คสถานะการจอง (แทนที่ "เช็คยอดปันผล" เดิม) — ดึงออเดอร์ที่ยัง active/pending
// ⭐️ ข้อความตามสเปกใหม่ (สุภาพแต่เป็นกันเอง) เป็น template ต่อ "หนึ่ง" ออเดอร์ — ถ้ามีหลายออเดอร์
// พร้อมกัน ใช้ template เดิมซ้ำต่อรายการ คั่นด้วยบรรทัดว่าง (ไม่มีสเปกแยกสำหรับเคสหลายออเดอร์)
async function handlePreorderStatus(user, db) {
  if (!user) return notRegisteredReply();
  const placeholders = ORDER_TERMINAL_STATUSES.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT id, total_amount, status, created_at FROM orders
     WHERE user_id = ? AND status NOT IN (${placeholders})
     ORDER BY id DESC`,
    [user.id, ...ORDER_TERMINAL_STATUSES]
  );
  if (rows.length === 0) {
    return text('ตอนนี้คุณยังไม่มีออเดอร์ที่กำลังดำเนินการอยู่ครับผม แวะไปดูสินค้าที่หน้าร้าน หรือกดสั่งซื้อล่วงหน้า (Pre-Order) ก่อนได้เลยน้า 🛒✨');
  }
  const messages = rows.map(o => {
    const label = ORDER_STATUS_LABEL[o.status] || o.status;
    return `📦 ออเดอร์ #${o.id} ของคุณกำลังดำเนินการอยู่ครับ! (สถานะ: ${label}) ถ้าของพร้อมแล้วระบบจะรีบแจ้งเตือนให้มารับน้า`;
  });
  return text(messages.join('\n\n'));
}

// ⭐️ Feature 4 — ประวัติการซื้อ/ใบเสร็จ: เปลี่ยนจาก DateTimePicker ในแชท (เลือกวันที่ผ่าน postback)
// เป็นลิงก์ LIFF ไปหน้าเว็บโดยตรงแทน — ให้ผู้ใช้เลือกวันที่ได้เต็มรูปแบบบนเว็บ (โมดัลประวัติออเดอร์ใน
// /pre-order รองรับอยู่แล้ว) ไม่ต้องพึ่งความสามารถจำกัดของ UI ในแชท LINE
function handleOrderHistoryLink(user) {
  if (!user) return notRegisteredReply();
  return text(`🧾 สามารถตรวจสอบประวัติการซื้อและใบเสร็จย้อนหลังแบบเลือกวันที่ได้ ที่นี่เลยครับ 👉 ${MY_ORDERS_LIFF_URL}`);
}

// ⭐️ Feature 3 — โปรโมชั่น: อัปเดตคำตอบตามสเปกใหม่ (สุภาพแต่เป็นกันเอง) ทั้ง 2 กรณี
async function handlePromotions(db) {
  const [rows] = await db.query(
    `SELECT name, discount_type, discount_value FROM promotions
     WHERE is_active = 1
       AND (start_date IS NULL OR start_date <= CURDATE())
       AND (end_date IS NULL OR end_date >= CURDATE())
     ORDER BY id DESC LIMIT 10`
  );
  if (rows.length === 0) {
    return text('ช่วงนี้ยังไม่มีโปรโมชั่นใหม่เลยครับ แต่รอติดตามได้เลยนะ เดี๋ยวมีจัดเต็มแน่นอน! 🎁');
  }
  const promoList = rows.map(p => {
    const v = p.discount_type === 'PERCENT' ? `ลด ${Number(p.discount_value)}%`
      : p.discount_type === 'FIXED' ? `ลด ${Number(p.discount_value)} บาท`
      : 'ซื้อ 1 แถม 1';
    return `• ${p.name} — ${v}`;
  }).join('\n');
  return text(`🎉 โปรโมชั่นเด็ดมาแล้วครับ!\n${promoList}\n💡 หมายเหตุ: โปรโมชั่นนี้ต้องมาใช้ที่หน้าร้าน DMTC Mart เท่านั้นนะครับ แวะมาใช้สิทธิ์กันน้า!`);
}

// ⭐️ Feature 5A — ติดต่อขอความช่วยเหลือ (ข้อความตายตัวตามสเปกล่าสุด)
function handleContact() {
  return text('หากมีข้อสงสัยหรือต้องการความช่วยเหลือ ทักแชทคุยกับแอดมินโดยตรงได้ที่ LINE ID: tanatpinkeaw ได้เลยครับ ยินดีให้บริการเสมอครับผม! 💬👨‍💻');
}

// ⭐️ map ข้อความ (จาก Rich Menu หรือที่พิมพ์เอง) → handler. ลำดับสำคัญ: เช็คคำเฉพาะก่อนคำกว้าง
// (เช่น "สถานะการจอง" มีคำว่า "จอง" ต้องเข้าสถานะการจอง ไม่ใช่ลิงก์สั่งจอง — จึงเช็คสถานะก่อน)
async function routeIncoming(raw, user, db) {
  const t = (raw || '').trim();
  if (!t) return null;
  if (/(ประวัติการซื้อ|ใบเสร็จ|ประวัติ)/.test(t)) return handleOrderHistoryLink(user);
  if (/(สถานะการจอง|เช็คสถานะสินค้า|สถานะสินค้า|สถานะการสั่ง|สถานะ|ปันผล)/.test(t)) return handlePreorderStatus(user, db);
  if (/(บัตรสมาชิก|สมาชิก)/.test(t)) return handleMemberCard(user);
  if (/(แต้ม|คะแนน)/.test(t)) return handlePoints(user);
  if (/(โปรโมชั่น|โปรโมชัน|โปร)/.test(t)) return handlePromotions(db);
  if (/(จอง|สั่งซื้อล่วงหน้า|สั่งซื้อ|พรีออเดอร์|preorder|pre-order)/i.test(t)) {
    return text(`🛒 สั่งซื้อล่วงหน้า / จองสินค้า\nเปิดลิงก์นี้เพื่อสั่งได้เลยครับ:\n${PREORDER_URL}`);
  }
  if (/(ติดต่อ|เจ้าหน้าที่|ช่วยเหลือ|help)/i.test(t)) return handleContact();
  return null; // ข้อความอื่นๆ — ไม่ตอบ (กันสแปม/echo)
}

async function handleEvent(event, db) {
  const replyToken = event.replyToken;
  const lineUserId = event.source && event.source.userId;
  const user = await findUserByLine(lineUserId, db);

  if (event.type === 'follow') {
    return replyLineMessage(replyToken, [
      text(`ยินดีต้อนรับสู่ DMTC Smart Mart! 🎉\nสมัคร/ผูกบัญชีสมาชิกได้ที่:\n${LIFF_REGISTER_URL}`),
    ]);
  }

  if (event.type === 'postback') {
    // ⭐️ ไม่มี DateTimePicker แล้ว (เปลี่ยนเป็นลิงก์ LIFF ไปเว็บแทน) — postback ที่เหลือ (ถ้ามีปุ่มอื่น
    // ในอนาคตที่ส่ง data มา) ตีความเป็นคำสั่งข้อความปกติผ่าน routeIncoming เหมือนเดิม
    const data = (event.postback && event.postback.data) || '';
    const reply = await routeIncoming(data, user, db);
    if (reply) await replyLineMessage(replyToken, Array.isArray(reply) ? reply : [reply]);
    return;
  }

  if (event.type === 'message' && event.message && event.message.type === 'text') {
    const reply = await routeIncoming(event.message.text, user, db);
    if (reply) await replyLineMessage(replyToken, Array.isArray(reply) ? reply : [reply]);
  }
}

// POST /api/line/webhook — public (ดู PUBLIC_PATHS ใน server.js) ไม่ผ่าน JWT/CSRF
async function handleWebhook(req, res) {
  const signature = req.get('x-line-signature');
  const valid = verifySignature(req.rawBody, signature);
  if (valid === false) {
    console.warn('⚠️ LINE webhook: signature ไม่ตรง — ปฏิเสธ request');
    return res.status(401).end();
  }
  if (valid === null) {
    if (config.IS_PRODUCTION) {
      console.error('[LINE webhook] BLOCKED: LINE_CHANNEL_SECRET not configured in production');
      return res.status(503).end();
    }
    console.warn('⚠️ LINE webhook: ไม่ได้ตั้ง LINE_CHANNEL_SECRET — ข้ามการตรวจ signature (ใช้ได้เฉพาะ dev)');
  }

  // ⭐️ ตอบ 200 ให้ LINE เร็วที่สุด (LINE จะ retry ถ้ารอนาน) แล้วค่อยประมวลผล event แบบ async
  res.status(200).end();

  const events = Array.isArray(req.body && req.body.events) ? req.body.events : [];
  for (const event of events) {
    try {
      await handleEvent(event, req.db);
    } catch (err) {
      console.error('[LINE webhook] จัดการ event ล้มเหลว:', err.message);
    }
  }
}

module.exports = { handleWebhook };
