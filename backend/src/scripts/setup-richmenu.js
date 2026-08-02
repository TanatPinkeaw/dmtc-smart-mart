// ⭐️ CLI สั่งสร้าง + อัปโหลดรูป + ตั้งเป็น Rich Menu เริ่มต้นของ LINE OA — รันด้วย `npm run line:richmenu`
//
// ⚠️ คำเตือน — สคริปต์นี้เปลี่ยนเมนูจริงที่ผู้ใช้ LINE OA "ทุกคน" เห็นทันทีที่รันสำเร็จ ไม่ใช่แค่ dev/test
// รันด้วยความตั้งใจเท่านั้น อย่ารันเพื่อทดสอบ/ดู error โดยไม่ได้ตรวจสอบว่ารูป/ข้อความพร้อมจริงก่อน
//
// Usage: npm run line:richmenu -- ./path/to/richmenu-2500x1686.png
//   หรือ: node src/scripts/setup-richmenu.js ./path/to/richmenu-2500x1686.png
require('dotenv').config({ quiet: true });
const path = require('path');
const { createAndSetDefaultRichMenu } = require('../services/lineService');

const imagePath = process.argv[2];

if (!imagePath) {
  console.error('❌ ไม่ได้ระบุ path ไฟล์รูป Rich Menu');
  console.error('   Usage: npm run line:richmenu -- ./path/to/richmenu-2500x1686.png');
  process.exit(1);
}

(async () => {
  console.log('⚠️  กำลังจะสร้าง + ตั้งเป็น Rich Menu เริ่มต้นของ LINE OA จริง — ผู้ใช้ทุกคนจะเห็นเมนูใหม่นี้ทันทีที่เสร็จ');
  console.log(`📄 ไฟล์รูป: ${path.resolve(imagePath)}`);
  console.log('');
  try {
    const { richMenuId } = await createAndSetDefaultRichMenu(imagePath);
    console.log('');
    console.log(`✅ ตั้งค่า Rich Menu สำเร็จ — richMenuId: ${richMenuId}`);
    process.exit(0);
  } catch (err) {
    console.error('');
    console.error('❌ ตั้งค่า Rich Menu ไม่สำเร็จ:', err.message);
    process.exit(1);
  }
})();
