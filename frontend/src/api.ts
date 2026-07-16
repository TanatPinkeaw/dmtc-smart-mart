import axios from 'axios';

// 1. ตั้งค่าพื้นฐาน (เปลี่ยน URL ให้ตรงกับพอร์ต Backend ของนายถ้าไม่ใช่ 3000)
const api = axios.create({
  baseURL: 'http://localhost:3000/api', 
  headers: {
    'Content-Type': 'application/json'
  }
});

// 2. ใช้ Interceptor ดักจับทุก Request ก่อนวิ่งออกไปที่ Backend
api.interceptors.request.use(
  (config) => {
    // ไปค้นหา Token ในกระเป๋า (localStorage)
    const token = localStorage.getItem('token');
    
    // ถ้ามี Token ให้แนบไปกับ Header
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    // ⭐️ ถ้าส่ง FormData (เช่น upload รูป) ให้ลบ Content-Type ออก
    // กัน axios instance ที่ตั้ง default 'application/json' ไป override multipart/form-data boundary
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 3. (Optional) ดักจับ Error ขากลับ เผื่อ Token หมดอายุ
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      // ถ้า Backend ฟ้องว่า Token หมดอายุ หรือไม่มีสิทธิ์ ให้เตะกลับไปหน้า Login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      
      // ข้ามการเตะกลับถ้ากำลังอยู่ที่หน้า login เพื่อไม่ให้ loop
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;