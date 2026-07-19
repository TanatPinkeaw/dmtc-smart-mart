// ⭐️ เก็บรูปถาวรบน Cloudinary — แก้ปัญหา Render free ลบไฟล์อัปโหลดตอน redeploy/restart
// ถ้าไม่ได้ตั้งค่า Cloudinary (เช่น dev บนเครื่อง local) จะ fallback เขียนลงดิสก์ uploads/ เหมือนเดิม
const fs = require('fs');
const path = require('path');

const CLOUDINARY_ENABLED = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

let cloudinary = null;
if (CLOUDINARY_ENABLED) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
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
    return await _uploadToCloudinary(buffer, `dmtc-mart/${subfolder}`, baseName);
  }
  const dir = path.join(__dirname, 'uploads', subfolder);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${baseName}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${subfolder}/${filename}`;
}

module.exports = { saveImage, CLOUDINARY_ENABLED };
