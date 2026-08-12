// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 swal.ts — กล่อง popup แจ้งเตือน/ยืนยัน มาตรฐานทั้งแอป (ห่อไลบรารี SweetAlert2)
// ทำอะไร: ตั้งธีมสี/ความมนของ popup ให้ตรงแบรนด์ครั้งเดียว แล้ว export ออกไปให้ทุกหน้า import 'Swal'
//   ตัวนี้ไปใช้ (Swal.fire(...)) — จะได้หน้าตาเหมือนกันหมด ไม่ต้องตั้งซ้ำทุกที่
// ═══════════════════════════════════════════════════════════════════════════════════
import Swal from 'sweetalert2';

// สร้าง ธีมมาตรฐาน สำหรับทั้งโปรเจกต์
// ⭐️ Design-ref — bump popup ให้กลมมนแบบการ์ดหน้า Home (24px) + ปุ่มหลักไล่สีแทนสีเดียว
const customSwal = Swal.mixin({
  customClass: {
    popup: 'rounded-3xl shadow-lg border border-pink-100', // กรอบมน 3xl แบบการ์ดหน้า Home
    title: 'font-extrabold text-gray-900',
    confirmButton: 'bg-gradient-to-br from-brand to-brand-dark hover:opacity-95 text-white font-bold py-2.5 px-5 rounded-full transition-all mx-2 shadow-sm', // ปุ่มหลักไล่สีแบบหน้า Home
    cancelButton: 'bg-gray-400 hover:bg-gray-500 text-white font-bold py-2.5 px-5 rounded-full transition-all mx-2', // ปุ่มยกเลิกสีเทา
    actions: 'flex gap-2' // ระยะห่างระหว่างปุ่ม
  },
  buttonsStyling: false, // ปิดสไตล์เดิมของ SweetAlert เพื่อใช้ Tailwind
});

export default customSwal;