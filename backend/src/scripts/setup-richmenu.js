// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 scripts/setup-richmenu.js — สคริปต์ CLI ตั้งค่า Rich Menu ของ LINE OA (รันมือครั้งคราว)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: รับพาธรูปเมนู → สร้าง Rich Menu + อัปโหลดรูป + ตั้งเป็นเมนูเริ่มต้นให้ผู้ใช้ LINE OA ทุกคน
//   (ไม่ใช่ส่วนของ server ปกติ — รันแยกด้วย `npm run line:richmenu -- ./รูป.png`)
// ⚠️ กระทบผู้ใช้จริงทุกคนทันที — รันด้วยความตั้งใจเท่านั้น (ดูคำเตือนด้านล่าง)
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ CLI สั่งสร้าง + อัปโหลดรูป + ตั้งเป็น Rich Menu เริ่มต้นของ LINE OA — รันด้วย `npm run line:richmenu`
//
// ⚠️ คำเตือน — สคริปต์นี้เปลี่ยนเมนูจริงที่ผู้ใช้ LINE OA "ทุกคน" เห็นทันทีที่รันสำเร็จ ไม่ใช่แค่ dev/test
// รันด้วยความตั้งใจเท่านั้น อย่ารันเพื่อทดสอบ/ดู error โดยไม่ได้ตรวจสอบว่ารูป/ข้อความพร้อมจริงก่อน
//
// Usage: npm run line:richmenu -- ./path/to/richmenu-2500x1686.png
//   หรือ: node src/scripts/setup-richmenu.js ./path/to/richmenu-2500x1686.png
//
// หมายเหตุสำหรับ dev: main(argv, deps) แยกเป็นฟังก์ชัน + DI ให้ setup-richmenu.test.js เทสต์ได้
// โดยไม่ต้องยิง LINE จริง (ส่ง createRichMenu/log/exit จำลองเข้าไป) — CLI จริงเรียกผ่าน guard
// require.main === module เหมือน pattern ของ check-strict (frontend)
// ═══════════════════════════════════════════════════════════════════════════════════
require('dotenv').config({ quiet: true });
const path = require('path');
const { createAndSetDefaultRichMenu } = require('../services/lineService');

// main(argv, deps) — ลอจิกหลัก (testable ผ่าน DI: deps = { createRichMenu, log, exit })
// คืนผลลัพธ์เป็น object เสมอ (สะดวกตรวจในเทส) + เรียก exit(code) ตาม path
async function main(argv, deps) {
  const {
    createRichMenu = createAndSetDefaultRichMenu,
    log = console,
    exit = (code) => { process.exitCode = code; },
  } = deps || {};

  const imagePath = argv[2];

  if (!imagePath) {
    log.error('❌ ไม่ได้ระบุ path ไฟล์รูป Rich Menu');
    log.error('   Usage: npm run line:richmenu -- ./path/to/richmenu-2500x1686.png');
    exit(1);
    return { ok: false, reason: 'missing-image-path' };
  }

  log.log('⚠️  กำลังจะสร้าง + ตั้งเป็น Rich Menu เริ่มต้นของ LINE OA จริง — ผู้ใช้ทุกคนจะเห็นเมนูใหม่นี้ทันทีที่เสร็จ');
  log.log(`📄 ไฟล์รูป: ${path.resolve(imagePath)}`);
  log.log('');
  try {
    const { richMenuId } = await createRichMenu(imagePath);
    log.log('');
    log.log(`✅ ตั้งค่า Rich Menu สำเร็จ — richMenuId: ${richMenuId}`);
    exit(0);
    return { ok: true, richMenuId };
  } catch (err) {
    log.error('');
    log.error('❌ ตั้งค่า Rich Menu ไม่สำเร็จ:', err.message);
    exit(1);
    return { ok: false, reason: 'service-error', message: err.message };
  }
}

// ── CLI entry (รันเฉพาะตอนเรียกตรงๆ ไม่ใช่ตอนโดน import เพื่อเทสต์) ─────────────────
const isMain = require.main === module;

if (isMain) {
  main(process.argv, {
    createRichMenu: createAndSetDefaultRichMenu,
    log: console,
    exit: (code) => process.exit(code),
  });
}

module.exports = { main };
