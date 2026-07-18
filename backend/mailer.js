// ⭐️ Sprint 1 — D4: shared SMTP mailer.
//
// This is the first feature in this codebase that needs to send real email (password reset
// uses phone-number verification, not email — see /api/auth/forgot-password in server.js).
// Config comes entirely from env vars (SMTP_HOST/PORT/USER/PASS/FROM) — none of these exist
// in .env.example yet, added there alongside this file.
//
// Fails soft on purpose: if SMTP isn't configured (e.g. local dev, or before the admin has
// set up a mailbox on production), sendMail() logs a warning and resolves false instead of
// throwing — a missing/broken mail config must never crash the cron job or take down a route
// that happens to trigger a report send.

const nodemailer = require('nodemailer');

let transporter = null;
let attemptedInit = false;

function getTransporter() {
  if (attemptedInit) return transporter;
  attemptedInit = true;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('⚠️ Mailer: SMTP_HOST/SMTP_USER/SMTP_PASS ยังไม่ได้ตั้งค่าใน .env — จะ log แทนการส่งอีเมลจริง');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465, // 465 = implicit TLS, อย่างอื่น (เช่น 587) = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

// Returns true if the mail was handed off to the SMTP server, false if skipped/failed
// (check the console for the reason — callers should treat false as "non-fatal, move on").
async function sendMail({ to, subject, html, text }) {
  if (!to) {
    console.warn('⚠️ Mailer: ไม่มีผู้รับ (to) — ข้ามการส่ง');
    return false;
  }

  const t = getTransporter();
  if (!t) {
    console.log(`📧 [DEV/ไม่มี SMTP] จะส่งอีเมลถึง ${to} — หัวข้อ: ${subject}`);
    return false;
  }

  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      text: text || undefined,
    });
    console.log(`📧 ส่งอีเมลถึง ${to} สำเร็จ — หัวข้อ: ${subject}`);
    return true;
  } catch (err) {
    console.error('❌ ส่งอีเมลล้มเหลว:', err.message);
    return false;
  }
}

module.exports = { sendMail };
