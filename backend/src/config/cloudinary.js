// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 config/cloudinary.js — จัดการอัปโหลด/ดาวน์โหลดไฟล์ (รูปสลิป/รูปเข้างาน/ไฟล์ backup)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: ถ้าตั้งค่า CLOUDINARY_* ครบ → เก็บไฟล์ถาวรบนคลาวด์ Cloudinary; ถ้าไม่ตั้ง → fallback เขียน
//   ลงดิสก์ uploads/ (ใช้ได้เฉพาะ dev เพราะ Render free ลบไฟล์ทิ้งตอน redeploy)
// export สำคัญ:
//   • saveImage(buffer, subfolder, baseName, ext) — เซฟรูป คืน URL/พาธที่เอาไปเก็บใน DB (fallback ดิสก์อัตโนมัติ)
//   • saveRawFile / fetchRawFile — อัปโหลด/ดึงไฟล์ที่ "ไม่ใช่รูป" (เช่น .sql.gz ของ backup) ใช้ resource_type:'raw'
//   • CLOUDINARY_ENABLED — flag บอกว่าเปิดใช้คลาวด์อยู่ไหม
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ เก็บรูปถาวรบน Cloudinary — แก้ปัญหา Render free ลบไฟล์อัปโหลดตอน redeploy/restart
// ถ้าไม่ได้ตั้งค่า Cloudinary (เช่น dev บนเครื่อง local) จะ fallback เขียนลงดิสก์ uploads/ เหมือนเดิม
const fs = require('fs');
const path = require('path');
const config = require('./config'); // ⭐️ ค่า CLOUDINARY_* มาจากที่นี่แทน process.env ตรงๆ

const CLOUDINARY_ENABLED = !!(
  config.CLOUDINARY_CLOUD_NAME &&
  config.CLOUDINARY_API_KEY &&
  config.CLOUDINARY_API_SECRET
);

let cloudinary = null;
if (CLOUDINARY_ENABLED) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log('☁️  Cloudinary storage: ENABLED (รูปเก็บถาวรบนคลาวด์)');
} else {
  console.log('💾 Cloudinary ไม่ได้ตั้งค่า — เก็บรูปลงดิสก์ uploads/ แทน (ok สำหรับ dev, แต่ Render free รูปจะหายตอน redeploy)');
}

function _uploadToCloudinary(buffer, folder, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: 'image', overwrite: true },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    stream.end(buffer);
  });
}

// บันทึกรูปจาก buffer แล้วคืน "ค่าที่ต้องเก็บลง DB":
//  - Cloudinary เปิด  → คืน https URL เต็ม เช่น https://res.cloudinary.com/xxx/.../abc.png
//  - Cloudinary ปิด   → เขียนลง uploads/<subfolder>/ แล้วคืน /uploads/<subfolder>/<name><ext>
async function saveImage(buffer, subfolder, baseName, ext) {
  if (CLOUDINARY_ENABLED) {
    return await _uploadToCloudinary(buffer, `uploads/${subfolder}`, baseName);
  }
  const dir = path.join(__dirname, 'uploads', subfolder);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${baseName}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${subfolder}/${filename}`;
}

// ⭐️ Update — สำรองไฟล์ backup (.sql.gz) ขึ้น Cloudinary เป็นสำเนานอกดิสก์ ให้รอดตอน Render
// redeploy/restart ล้าง filesystem ทิ้ง (เหตุผลเดียวกับรูป แต่ .sql.gz ไม่ใช่รูป ใช้
// resource_type: 'raw' แยกจาก saveImage ด้านบนที่ hardcode 'image' ไว้ — ผสมกันไม่ได้ Cloudinary
// จะปฏิเสธ/ตีความไบนารี gzip ผิดถ้าส่งเป็น 'image')
function _uploadRawToCloudinary(buffer, folder, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: 'raw', overwrite: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

// อัปโหลดไฟล์ทั่วไป (ไม่ใช่รูป) จาก buffer — คืน null ถ้า Cloudinary ไม่ได้ตั้งค่า (caller ต้อง
// เช็คเองว่าจะ fallback เป็นดิสก์อย่างเดียวหรือไม่ — ต่างจาก saveImage ที่ fallback ให้อัตโนมัติ
// เพราะไฟล์ backup มีสำเนาบนดิสก์อยู่แล้วเป็นค่าเริ่มต้น ไม่ต้องมีที่เก็บสำรอง)
async function saveRawFile(buffer, subfolder, publicId) {
  if (!CLOUDINARY_ENABLED) return null;
  const result = await _uploadRawToCloudinary(buffer, `uploads/${subfolder}`, publicId);
  return { publicId: result.public_id, url: result.secure_url };
}

// โหลดไฟล์ raw กลับจาก Cloudinary เป็น Buffer — ใช้ signed URL เสมอ เพราะบัญชี Cloudinary ที่สร้าง
// ใหม่ (หลัง 2024) ปิด "unsigned delivery ของไฟล์ raw/ไม่ใช่รูป" ไว้เป็นค่าเริ่มต้น (นโยบายความ
// ปลอดภัยฝั่ง Cloudinary เอง กัน asset ที่ไม่ใช่รูปถูกเดาลิงก์เข้าถึงได้) signed URL ข้ามข้อจำกัดนี้ได้เสมอ
async function fetchRawFile(publicId) {
  if (!CLOUDINARY_ENABLED) throw new Error('Cloudinary ไม่ได้ตั้งค่าไว้ — ดึงไฟล์จากคลาวด์ไม่ได้');
  const signedUrl = cloudinary.url(publicId, { resource_type: 'raw', type: 'upload', sign_url: true, secure: true });
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`ดาวน์โหลดไฟล์จาก Cloudinary ไม่สำเร็จ: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { saveImage, CLOUDINARY_ENABLED, saveRawFile, fetchRawFile };
