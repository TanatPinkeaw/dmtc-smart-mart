const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

// ⭐️ Payment slip storage (uploads/slips/YYYY-MM-DD/)
const slipStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const date = getBangkokDate();
    const uploadDir = path.join(__dirname, 'uploads', 'slips', date);

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const date = getBangkokDate();
    const time = getBangkokTime();
    const userId = req.user?.id || 'unknown';
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${date}_${time}_${userId}${ext}`;
    cb(null, name);
  }
});

// ⭐️ Shift photo storage (uploads/shift-photos/clock-in|clock-out/YYYY-MM-DD/)
const shiftPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const date = getBangkokDate();
    // Get type from query param: ?type=clock-in or ?type=clock-out
    const photoType = req.query.type || 'clock-out';
    const uploadDir = path.join(__dirname, 'uploads', 'shift-photos', photoType, date);

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const date = getBangkokDate();
    const time = getBangkokTime();
    const userId = req.user?.id || 'unknown';
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${date}_${time}_${userId}${ext}`;
    cb(null, name);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  console.log(`[DEBUG MULTER FILTER] Checking file - fieldname=${file.fieldname}, originalname=${file.originalname}, mimetype=${file.mimetype}`);

  if (!allowedMimes.includes(file.mimetype)) {
    console.log(`[DEBUG MULTER FILTER] REJECTED - Invalid MIME type: ${file.mimetype}`);
    return cb(new Error(`Invalid file type: ${file.mimetype}`), false);
  }

  console.log(`[DEBUG MULTER FILTER] ACCEPTED - File passed filter`);
  cb(null, true);
};

// Multer instances
const slipUpload = multer({
  storage: slipStorage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

const shiftPhotoUpload = multer({
  storage: shiftPhotoStorage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

module.exports = { slipUpload, shiftPhotoUpload };
