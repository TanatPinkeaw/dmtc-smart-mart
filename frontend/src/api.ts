import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api', // ชี้ไปที่ Backend 
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