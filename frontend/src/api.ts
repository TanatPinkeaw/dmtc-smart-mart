import axios from 'axios';
import Swal from './swal';
import { saveRequestToQueue, getQueue, removeFromQueue, incrementRetries } from './utils/requestQueue';
import { API_BASE_URL } from './config'; // ⭐️ DEPLOY FIX — URL จาก env แทนฮาร์ดโค้ด

// ⭐️ F4 — เก็บไว้กันโชว์ Swal ซ้ำถ้ามีหลาย request โดน 429 พร้อมกัน
let rateLimitSwalOpen = false;

// ⭐️ Sprint 2 — B5: Track refresh in-flight to prevent multiple refresh calls
let refreshPromise: Promise<any> | null = null;

// ⭐️ Sprint 2 — B6: Idempotency key generator (UUID-like)
function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ⭐️ Sprint 2 — B6: Track if we're retrying queued requests
let isProcessingQueue = false;

// 1. ตั้งค่าพื้นฐาน (เปลี่ยน URL ให้ตรงกับพอร์ต Backend ของนายถ้าไม่ใช่ 3000)
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// 2. ใช้ Interceptor ดักจับทุก Request ก่อนวิ่งออกไปที่ Backend
api.interceptors.request.use(
  (config) => {
    // ไปค้นหา Token ในกระเป๋า (localStorage)
    const accessToken = localStorage.getItem('accessToken');

    // ⭐️ F4 — Debug: Log token status for debugging auth issues
    // ⭐️ Skip warning for public endpoints that don't need auth
    const publicPaths = ['/version', '/health', '/login', '/register'];
    const isPublicPath = publicPaths.some(p => config.url?.includes(p));

    if (!accessToken && !isPublicPath) {
      console.warn(`[API] No accessToken found for request: ${config.method?.toUpperCase()} ${config.url}`);
    } else if (accessToken) {
      console.debug(`[API] Token found and sending with request: ${config.method?.toUpperCase()} ${config.url}`);
    }

    // ถ้ามี Token ให้แนบไปกับ Header
    if (accessToken) {
      config.headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // ⭐️ Sprint 2 — B6: Generate idempotency-key for POST/PUT/DELETE
    if (['POST', 'PUT', 'DELETE'].includes(config.method?.toUpperCase() || '')) {
      // Check if idempotency-key already exists (from queue retry)
      if (!config.headers['idempotency-key']) {
        config.headers['idempotency-key'] = generateIdempotencyKey();
      }
    }

    // ⭐️ Sprint 2 — B6: Queue POST/PUT/DELETE if offline
    if (['POST', 'PUT', 'DELETE'].includes(config.method?.toUpperCase() || '')) {
      if (!navigator.onLine && !isProcessingQueue) {
        saveRequestToQueue(
          config.method || 'POST',
          config.url || '',
          config.data,
          Object.fromEntries(Object.entries(config.headers || {}))
        );
        // Return a rejected promise to prevent the actual request
        return Promise.reject(new Error('Offline - request queued'));
      }
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

// 3. Response interceptor: Auto-refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as any;
    
    // ⭐️ F4 — โดน rate limit (429): แจ้งเตือนผู้ใช้ + broadcast ให้หน้าที่สนใจ (เช่น Login) ปิดปุ่ม/นับถอยหลังได้
    if (error.response?.status === 429) {
      const retryAfter = Number(error.response.headers['retry-after']) || 60;

      window.dispatchEvent(new CustomEvent('rate-limited', { detail: { retryAfter } }));

      if (!rateLimitSwalOpen) {
        rateLimitSwalOpen = true;
        Swal.fire({
          icon: 'warning',
          title: 'พยายามบ่อยเกินไป',
          text: `กรุณารอ ${retryAfter} วินาที แล้วลองใหม่อีกครั้ง`,
          allowOutsideClick: false,
        }).then(() => { rateLimitSwalOpen = false; });
      }
      return Promise.reject(error);
    }

    // ⭐️ Sprint 2 — B5: Auto-refresh on 401
    if (error.response && error.response.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Prevent multiple simultaneous refresh calls
        if (!refreshPromise) {
          refreshPromise = api.post('/auth/refresh', {
            refreshToken: localStorage.getItem('refreshToken')
          });
        }

        const { data } = await refreshPromise;
        refreshPromise = null;

        // Store new access token
        localStorage.setItem('accessToken', data.accessToken);

        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed → logout
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    // 🐛 FIX (MEMBER login bug) — เดิมเช็ค 401 กับ 403 รวมกัน แล้ว force logout ทั้งคู่
    // 403 = "login ถูกต้อง แต่ไม่มีสิทธิ์ทำ action นี้" (เช่น MEMBER หลุดเข้าหน้า POS แล้วยิง
    // GET /api/users/search ซึ่งเป็น endpoint เฉพาะ CASHIER/ADMIN) — ไม่ใช่ token เสีย/หมดอายุ
    // การ force logout ตรงนี้คือสาเหตุที่ทำให้ "frontend crashes/closes connection": session ที่ยัง
    // valid อยู่ถูกเตะทิ้งทั้งหน้าทั้งที่ควรแค่ปฏิเสธ request เดียวแล้วให้หน้าที่เรียกไป handle เอง
    // เหลือแค่ 401 (token หมดอายุ/ปลอม) ที่ควร force logout จริงๆ
    if (error.response && error.response.status === 401 && originalRequest._retry) {
      // Token refresh failed or already retried, force logout
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');

      // ข้ามการเตะกลับถ้ากำลังอยู่ที่หน้า login เพื่อไม่ให้ loop
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

// ⭐️ Sprint 2 — B6: Listen for online event and retry queued requests
if (typeof window !== 'undefined') {
  window.addEventListener('online', async () => {
    console.log('[Queue] Connection restored, processing queued requests...');
    isProcessingQueue = true;
    const queue = getQueue();

    for (let i = 0; i < queue.length; i++) {
      const req = queue[i];
      if (req.retries >= 3) {
        console.warn(`[Queue] Max retries exceeded for ${req.method} ${req.url}`);
        removeFromQueue(i);
        continue;
      }

      try {
        const config = {
          method: req.method,
          url: req.url,
          data: req.data,
          headers: req.headers,
        };
        console.log(`[Queue] Retrying ${req.method} ${req.url} (attempt ${req.retries + 1})`);
        await api.request(config);
        console.log(`[Queue] Successfully sent ${req.method} ${req.url}`);
        removeFromQueue(i);
        i--; // Adjust index after removal
      } catch (error: any) {
        incrementRetries(i);
        console.error(`[Queue] Retry failed for ${req.method} ${req.url}:`, error.message);
      }
    }

    isProcessingQueue = false;
    console.log('[Queue] Done processing queued requests');
  });
}

export default api;
