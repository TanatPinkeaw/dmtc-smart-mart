// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 ecosystem.config.js — ไฟล์ตั้งค่า PM2 (ตัวคุมให้ backend รันค้างตลอด) สำหรับ deploy บนเครื่องเซิร์ฟเวอร์
// ทำอะไร: บอก PM2 ว่ารัน server.js ชื่อ dmtc-mart-api, auto-restart ถ้าแครช/ใช้แรมเกิน, เก็บ log ที่ logs/
//   ใช้ตอน on-prem/VPS (คำสั่ง: pm2 start ecosystem.config.js) — บน Render/cloud ไม่ได้ใช้ไฟล์นี้
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ DEPLOY — ตั้งค่า PM2 ให้รัน backend แบบ auto-restart + เก็บ log
// ใช้: pm2 start ecosystem.config.js  แล้ว  pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'dmtc-mart-api',
      script: 'server.js',
      cwd: __dirname,              // โฟลเดอร์ backend
      instances: 1,               // ~100 users พอ 1 instance; เพิ่มได้ทีหลังถ้าโหลดสูง
      exec_mode: 'fork',
      watch: false,               // ห้ามเปิด watch บน production (จะรีสตาร์ทมั่วตอนไฟล์อัปโหลดเปลี่ยน)
      max_memory_restart: '400M', // ถ้าใช้แรมเกินนี้ให้รีสตาร์ทเอง (กัน memory leak ค้าง)
      env: {
        NODE_ENV: 'production',
      },
      // Log — PM2 เก็บให้ที่ ~/.pm2/logs/ ; ตั้งไฟล์ชัดเจนไว้ดูง่าย
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
