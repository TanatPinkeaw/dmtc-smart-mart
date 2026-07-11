import Swal from 'sweetalert2';

// สร้าง ธีมมาตรฐาน สำหรับทั้งโปรเจกต์
const customSwal = Swal.mixin({
  customClass: {
    popup: 'rounded-2xl shadow-lg border border-pink-100', // กรอบมน 2xl และเงามาตรฐาน
    confirmButton: 'bg-pink-500 hover:bg-pink-600 text-white font-bold py-2.5 px-5 rounded-xl transition-all mx-2', // ปุ่มหลักสีชมพู
    cancelButton: 'bg-gray-400 hover:bg-gray-500 text-white font-bold py-2.5 px-5 rounded-xl transition-all mx-2', // ปุ่มยกเลิกสีเทา
    actions: 'flex gap-2' // ระยะห่างระหว่างปุ่ม
  },
  buttonsStyling: false, // ปิดสไตล์เดิมของ SweetAlert เพื่อใช้ Tailwind
});

export default customSwal;