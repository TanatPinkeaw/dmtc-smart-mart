import axios from 'axios';

const api = axios.create({
  // ⭐️ เปลี่ยนเป็น URL ของ Render ที่นายเพิ่งได้มา
  baseURL: 'https://pos-backend-api-z0mu.onrender.com/api' 
});
// ฟังก์ชันดักจับ: ถ้ามี Token ในเครื่อง ให้แนบไปด้วยทุกครั้ง
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

export default api;