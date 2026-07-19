const multer = require('multer');
const path = require('path');

// Get Bangkok date (YYYY-MM-DD)
function getBangkokDate() {
  const now = new Date();
  const bangkokDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const year = bangkokDate.getFullYear();
  const month = String(bangkokDate.getMonth() + 1).padStart(2, '0');
  const day = String(bangkokDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get Bangkok time (HH-MM-SS)
function getBangkokTime() {
  const now = new Date();
  const bangkokDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const hours = String(bangkokDate.getHours()).padStart(2, '0');
  const minutes = String(bangkokDate.getMinutes()).padStart(2, '0');
  const seconds = String(bangkokDate.getSeconds()).padStart(2, '0');
  return `${hours}-${minutes}-${seconds}`;
}

// ⭐️ เปลี่ยนเป็น memoryStorage — ไฟล์อยู่ใน req.file.buffer (RAM) ไม่แตะดิสก์
// จากนั้น route จะส่ง buffer ขึ้น Cloudinary เอง (ดู cloudinary-config.js)
// เดิมใช้ diskStorage เขียนลง uploads/ ซึ่งบน Render free จะโดนลบตอน redeploy
const memoryStorage = multer.memoryStorage();

// File filter — อนุญาตเฉพาะรูปภาพ
const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedMimes.includes(file.mimetype)) {
    return cb(new Error(`Invalid file type: ${file.mimetype}`), false);
  }
  cb(null, true);
};

const slipUpload = multer({
  storage: memoryStorage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

const shiftPhotoUpload = multer({
  storage: memoryStorage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

module.exports = { slipUpload, shiftPhotoUpload, getBangkokDate, getBangkokTime };
