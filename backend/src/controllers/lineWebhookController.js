// ⭐️ LINE Webhook receiver — ตอบกลับปุ่ม Rich Menu / ข้อความที่ผู้ใช้พิมพ์เข้ามาใน LINE OA และรองรับ
// ระบบลงเวลาทำงาน (clock-in/out) ของพนักงานผ่าน LINE
//
// ต่างจากส่วน push-only เดิม (lineService.js) ตรงที่ไฟล์นี้ "รับ" event เข้ามา จึงต้อง:
//   1) ตรวจ signature (X-Line-Signature) ด้วย LINE_CHANNEL_SECRET กัน request ปลอม — ต้องใช้ raw body
//      (ดู server.js: express.json({ verify }) เก็บ req.rawBody ไว้ให้)
//   2) ตอบ HTTP 200 กลับ LINE ให้เร็ว ไม่งั้น LINE จะ retry ซ้ำ — จึง res 200 ก่อน แล้วค่อยประมวลผล event
//   3) ตอบผู้ใช้ด้วย replyToken (replyLineMessage) ไม่ใช่ push (ประหยัดโควตา + ตอบได้ใน ~30 วิ)
const crypto = require('crypto');
const pool = require('../config/db');
const config = require('../config/config');
const { replyLineMessage } = require('../services/lineService');

// LIFF สมัคร/ผูกบัญชีสมาชิก (ตรงกับ richmenu-config.json ปุ่ม "สมัคร/บัตรสมาชิก")
const LIFF_REGISTER_URL = 'https://liff.line.me/2010928001-YxK4Atjv';
const PREORDER_URL = `${config.FRONTEND_URL}/pre-order`;

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

function nowBangkok() {
  return new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
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

async function handlePurchaseHistory(user) {
  if (!user) return notRegisteredReply();
  const [rows] = await pool.query(
    "SELECT id, total_amount, created_at FROM sales WHERE member_id = ? AND status = 'COMPLETED' ORDER BY id DESC LIMIT 5",
    [user.id]
  );
  if (rows.length === 0) return text('🧾 ยังไม่มีประวัติการซื้อในระบบ');
  const lines = rows.map(r => {
    const d = new Date(r.created_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
    return `• #${r.id} — ${Number(r.total_amount).toLocaleString()} บาท (${d})`;
  }).join('\n');
  return text(`🧾 ประวัติการซื้อ 5 รายการล่าสุด\n\n${lines}`);
}

async function handlePromotions() {
  const [rows] = await pool.query(
    `SELECT name, discount_type, discount_value FROM promotions
     WHERE is_active = 1
       AND (start_date IS NULL OR start_date <= CURDATE())
       AND (end_date IS NULL OR end_date >= CURDATE())
     ORDER BY id DESC LIMIT 10`
  );
  if (rows.length === 0) return text('🎁 วันนี้ยังไม่มีโปรโมชั่นที่กำลังใช้งาน');
  const lines = rows.map(p => {
    const v = p.discount_type === 'PERCENT' ? `ลด ${Number(p.discount_value)}%`
      : p.discount_type === 'FIXED' ? `ลด ${Number(p.discount_value)} บาท`
      : 'ซื้อ 1 แถม 1';
    return `• ${p.name} — ${v}`;
  }).join('\n');
  return text(`🎁 โปรโมชั่นวันนี้\n\n${lines}`);
}

// ⭐️ Feature 3 — ลงเวลาเข้า-ออกงานผ่าน LINE (เฉพาะ MANAGER/CASHIER, MEMBER ใช้ไม่ได้)
async function handleClockInOut(user) {
  if (!user) {
    return text('⛔ ระบบลงเวลาทำงานใช้ได้เฉพาะพนักงานที่ผูกบัญชี LINE แล้วเท่านั้น');
  }
  if (user.role !== 'MANAGER' && user.role !== 'CASHIER') {
    return text('⛔ ระบบลงเวลาทำงานใช้ได้เฉพาะพนักงาน (แคชเชียร์/ผู้จัดการ) เท่านั้น');
  }
  // มีแถวที่ยังไม่ได้ลงเวลาออก (check_out IS NULL) = กำลังอยู่ในกะ → ครั้งนี้คือ "ออกงาน"
  const [openRows] = await pool.query(
    'SELECT id FROM attendance WHERE user_id = ? AND check_out IS NULL ORDER BY id DESC LIMIT 1',
    [user.id]
  );
  if (openRows.length > 0) {
    await pool.query('UPDATE attendance SET check_out = NOW() WHERE id = ?', [openRows[0].id]);
    return text(`✅ ลงเวลา "ออกงาน" เรียบร้อย\n👤 ${user.full_name}\n🕒 ${nowBangkok()}`);
  }
  await pool.query(
    "INSERT INTO attendance (user_id, check_in, note) VALUES (?, NOW(), 'ลงเวลาผ่าน LINE')",
    [user.id]
  );
  return text(`✅ ลงเวลา "เข้างาน" เรียบร้อย\n👤 ${user.full_name}\n🕒 ${nowBangkok()}`);
}

function handleContact() {
  return text('📞 ติดต่อเจ้าหน้าที่สหกรณ์\nกรุณาแจ้งเรื่องที่ต้องการ เจ้าหน้าที่จะติดต่อกลับโดยเร็วที่สุดครับ 🙏');
}

// ⭐️ Feature 4 — map ข้อความ (จาก Rich Menu หรือที่พิมพ์เอง) → handler. ลำดับสำคัญ: เช็คคำเฉพาะก่อน
// (ลงเวลา/ประวัติ) แล้วค่อยคำกว้าง กันชนกัน (เช่น "ประวัติการซื้อ" ต้องไม่ไปเข้า "สั่งซื้อ")
async function routeIncoming(raw, user) {
  const t = (raw || '').trim();
  if (!t) return null;
  if (/(ลงเวลา|เข้างาน|ออกงาน|clock)/i.test(t)) return handleClockInOut(user);
  if (/(ประวัติการซื้อ|ประวัติ)/.test(t)) return handlePurchaseHistory(user);
  if (/(บัตรสมาชิก|สมาชิก)/.test(t)) return handleMemberCard(user);
  if (/(แต้ม|ปันผล|คะแนน)/.test(t)) return handlePoints(user);
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

  if (event.type === 'follow') {
    return replyLineMessage(replyToken, [
      text(`ยินดีต้อนรับสู่ DMTC Smart Mart! 🎉\nสมัคร/ผูกบัญชีสมาชิกได้ที่:\n${LIFF_REGISTER_URL}`),
    ]);
  }

  let incoming = null;
  if (event.type === 'message' && event.message && event.message.type === 'text') {
    incoming = event.message.text;
  } else if (event.type === 'postback') {
    incoming = event.postback && event.postback.data;
  }
  if (!incoming) return; // sticker/image/อื่นๆ — ข้าม

  const user = await findUserByLine(lineUserId);
  const reply = await routeIncoming(incoming, user);
  if (reply) {
    await replyLineMessage(replyToken, Array.isArray(reply) ? reply : [reply]);
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
