// ⭐️ LINE Webhook receiver — ตอบกลับปุ่ม Rich Menu / ข้อความที่ผู้ใช้พิมพ์เข้ามาใน LINE OA
//
// ต่างจากส่วน push-only เดิม (lineService.js) ตรงที่ไฟล์นี้ "รับ" event เข้ามา จึงต้อง:
//   1) ตรวจ signature (X-Line-Signature) ด้วย LINE_CHANNEL_SECRET กัน request ปลอม — ต้องใช้ raw body
//      (ดู server.js: express.json({ verify }) เก็บ req.rawBody ไว้ให้)
//   2) ตอบ HTTP 200 กลับ LINE ให้เร็ว ไม่งั้น LINE จะ retry ซ้ำ — จึง res 200 ก่อน แล้วค่อยประมวลผล event
//   3) ตอบผู้ใช้ด้วย replyToken (replyLineMessage) ไม่ใช่ push (ประหยัดโควตา + ตอบได้ใน ~30 วิ)
//
// รองรับ: สถานะการจอง (pre-order), โปรโมชั่น, บัตรสมาชิก/แต้ม, ประวัติการซื้อ (เลือกวันที่ผ่าน
// DateTimePicker → postback), ลิงก์สั่งจอง, ติดต่อแอดมิน
// หมายเหตุ: ระบบลงเวลาทำงาน (clock-in/out) ผ่าน LINE ถูกถอดออกแล้ว — จัดการผ่านเว็บแพลตฟอร์มแทน
const crypto = require('crypto');
const pool = require('../config/db');
const config = require('../config/config');
const { replyLineMessage } = require('../services/lineService');

// LIFF สมัคร/ผูกบัญชีสมาชิก (ตรงกับ richmenu-config.json ปุ่ม "สมัคร/บัตรสมาชิก")
const LIFF_REGISTER_URL = 'https://liff.line.me/2010928001-YxK4Atjv';
const PREORDER_URL = `${config.FRONTEND_URL}/pre-order`;

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

async function findUserByLine(lineUserId) {
  if (!lineUserId) return null;
  const [rows] = await pool.query(
    'SELECT id, student_id, full_name, role, points, line_user_id FROM users WHERE line_user_id = ? LIMIT 1',
    [lineUserId]
  );
  return rows[0] || null;
}

// แปลง 'YYYY-MM-DD' (จาก DateTimePicker) เป็นวันที่ไทยอ่านง่าย
function thaiDateLabel(isoDate) {
  const d = new Date(`${isoDate}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'long', day: 'numeric' });
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
async function handlePreorderStatus(user) {
  if (!user) return notRegisteredReply();
  const placeholders = ORDER_TERMINAL_STATUSES.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, total_amount, status, created_at FROM orders
     WHERE user_id = ? AND status NOT IN (${placeholders})
     ORDER BY id DESC`,
    [user.id, ...ORDER_TERMINAL_STATUSES]
  );
  if (rows.length === 0) return text('ไม่มีสินค้าที่กำลังจองอยู่ในขณะนี้');
  const lines = rows.map(o => {
    const label = ORDER_STATUS_LABEL[o.status] || o.status;
    return `• ออเดอร์ #${o.id} — ${label} — ${Number(o.total_amount || 0).toLocaleString()} บาท`;
  }).join('\n');
  return text(`📦 สถานะการจองของคุณ (${rows.length} รายการ)\n\n${lines}`);
}

// ⭐️ Feature 4 — ประวัติการซื้อ: ส่ง DateTimePicker ให้ผู้ใช้เลือกวันที่ก่อน (ไม่ตอบ list ทันที)
function handlePurchaseHistoryPicker(user) {
  if (!user) return notRegisteredReply();
  return {
    type: 'template',
    altText: 'โปรดเลือกวันที่ต้องการตรวจสอบประวัติการซื้อ',
    template: {
      type: 'buttons',
      text: 'โปรดเลือกวันที่ต้องการตรวจสอบประวัติการซื้อ',
      actions: [
        { type: 'datetimepicker', label: '📅 เลือกวันที่', data: 'action=purchase_history', mode: 'date' },
      ],
    },
  };
}

// ⭐️ Feature 4 — สรุปประวัติการซื้อของวันที่เลือก (เรียกจาก postback ของ DateTimePicker)
async function handlePurchaseHistoryForDate(user, isoDate) {
  if (!user) return notRegisteredReply();
  const [rows] = await pool.query(
    `SELECT id, total_amount, created_at FROM sales
     WHERE member_id = ? AND status = 'COMPLETED' AND DATE(created_at) = ?
     ORDER BY id DESC`,
    [user.id, isoDate]
  );
  const label = thaiDateLabel(isoDate);
  if (rows.length === 0) return text(`🧾 วันที่ ${label}\nไม่มีประวัติการซื้อ`);
  const total = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
  const lines = rows.map(r => `• #${r.id} — ${Number(r.total_amount || 0).toLocaleString()} บาท`).join('\n');
  return text(`🧾 ประวัติการซื้อ วันที่ ${label}\n\n${lines}\n\nรวม ${total.toLocaleString()} บาท (${rows.length} รายการ)`);
}

// ⭐️ Feature 3 — โปรโมชั่น: ถ้าไม่มีโปรที่ใช้งานอยู่ ตอบข้อความตายตัว "ไม่มีโปรโมชั่นในตอนนี้"
async function handlePromotions() {
  const [rows] = await pool.query(
    `SELECT name, discount_type, discount_value FROM promotions
     WHERE is_active = 1
       AND (start_date IS NULL OR start_date <= CURDATE())
       AND (end_date IS NULL OR end_date >= CURDATE())
     ORDER BY id DESC LIMIT 10`
  );
  if (rows.length === 0) return text('ไม่มีโปรโมชั่นในตอนนี้');
  const lines = rows.map(p => {
    const v = p.discount_type === 'PERCENT' ? `ลด ${Number(p.discount_value)}%`
      : p.discount_type === 'FIXED' ? `ลด ${Number(p.discount_value)} บาท`
      : 'ซื้อ 1 แถม 1';
    return `• ${p.name} — ${v}`;
  }).join('\n');
  return text(`🎁 โปรโมชั่นวันนี้\n\n${lines}`);
}

// ⭐️ Feature 5A — ติดต่อขอความช่วยเหลือ (ข้อความตายตัวตามสเปก)
function handleContact() {
  return text('ติดต่อขอความช่วยเหลือได้ที่แอดมินโดยตรง\nLINE ID: tanatpinkeaw\nเพิ่มเพื่อน: https://line.me/ti/p/~tanatpinkeaw');
}

// ⭐️ map ข้อความ (จาก Rich Menu หรือที่พิมพ์เอง) → handler. ลำดับสำคัญ: เช็คคำเฉพาะก่อนคำกว้าง
// (เช่น "สถานะการจอง" มีคำว่า "จอง" ต้องเข้าสถานะการจอง ไม่ใช่ลิงก์สั่งจอง — จึงเช็คสถานะก่อน)
async function routeIncoming(raw, user) {
  const t = (raw || '').trim();
  if (!t) return null;
  if (/(ประวัติการซื้อ|ประวัติ)/.test(t)) return handlePurchaseHistoryPicker(user);
  if (/(สถานะการจอง|เช็คสถานะสินค้า|สถานะสินค้า|สถานะการสั่ง|สถานะ|ปันผล)/.test(t)) return handlePreorderStatus(user);
  if (/(บัตรสมาชิก|สมาชิก)/.test(t)) return handleMemberCard(user);
  if (/(แต้ม|คะแนน)/.test(t)) return handlePoints(user);
  if (/(โปรโมชั่น|โปรโมชัน|โปร)/.test(t)) return handlePromotions();
  if (/(จอง|สั่งซื้อล่วงหน้า|สั่งซื้อ|พรีออเดอร์|preorder|pre-order)/i.test(t)) {
    return text(`🛒 สั่งซื้อล่วงหน้า / จองสินค้า\nเปิดลิงก์นี้เพื่อสั่งได้เลยครับ:\n${PREORDER_URL}`);
  }
  if (/(ติดต่อ|เจ้าหน้าที่|ช่วยเหลือ|help)/i.test(t)) return handleContact();
  return null; // ข้อความอื่นๆ — ไม่ตอบ (กันสแปม/echo)
}

async function handleEvent(event) {
  const replyToken = event.replyToken;
  const lineUserId = event.source && event.source.userId;
  const user = await findUserByLine(lineUserId);

  if (event.type === 'follow') {
    return replyLineMessage(replyToken, [
      text(`ยินดีต้อนรับสู่ DMTC Smart Mart! 🎉\nสมัคร/ผูกบัญชีสมาชิกได้ที่:\n${LIFF_REGISTER_URL}`),
    ]);
  }

  // ⭐️ Feature 4 — postback: DateTimePicker ส่งวันที่ที่เลือกมาใน event.postback.params.date
  if (event.type === 'postback') {
    const data = (event.postback && event.postback.data) || '';
    const pickedDate = event.postback && event.postback.params && event.postback.params.date;
    if (data.includes('purchase_history') && pickedDate) {
      const reply = await handlePurchaseHistoryForDate(user, pickedDate);
      if (reply) await replyLineMessage(replyToken, [reply]);
      return;
    }
    // postback อื่นๆ — ตีความ data เป็นคำสั่งข้อความปกติ
    const reply = await routeIncoming(data, user);
    if (reply) await replyLineMessage(replyToken, Array.isArray(reply) ? reply : [reply]);
    return;
  }

  if (event.type === 'message' && event.message && event.message.type === 'text') {
    const reply = await routeIncoming(event.message.text, user);
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
    console.warn('⚠️ LINE webhook: ไม่ได้ตั้ง LINE_CHANNEL_SECRET — ข้ามการตรวจ signature (ใช้ได้เฉพาะ dev)');
  }

  // ⭐️ ตอบ 200 ให้ LINE เร็วที่สุด (LINE จะ retry ถ้ารอนาน) แล้วค่อยประมวลผล event แบบ async
  res.status(200).end();

  const events = Array.isArray(req.body && req.body.events) ? req.body.events : [];
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error('[LINE webhook] จัดการ event ล้มเหลว:', err.message);
    }
  }
}

module.exports = { handleWebhook };
