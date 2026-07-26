import axios from 'axios';
import Swal from './swal';
import { saveRequestToQueue, getQueue, removeFromQueue, incrementRetries } from './utils/requestQueue';
import { API_BASE_URL } from './config'; // ⭐️ DEPLOY FIX — URL จาก env แทนฮาร์ดโค้ด

// ⭐️ F4 — เก็บไว้กันโชว์ Swal ซ้ำถ้ามีหลาย request โดน 429 พร้อมกัน
let rateLimitSwalOpen = false;

// ⭐️ Sprint 2 — B5: Track refresh in-flight to prevent multiple refresh calls
let refreshPromise: Promise<any> | null = null;

// 🐛 FIX (production bug) — เดิมพอ refresh พังก็ยิง `window.location.href = '/login'` ตรงๆ ทันที
// จากทุก request ที่ 401 พร้อมกัน (เช่นหน้า Dashboard ยิง 6 endpoint พร้อมกันตอน mount) — ถ้าเบราว์เซอร์
// ยัง render หน้าเดิมค้างอยู่ (Render เย็น/เน็ตช้า) การ set href ซ้ำๆ จากหลาย request เกือบพร้อมกัน
// จะ "แย่งกัน" ยกเลิก navigation ของกันเองซ้ำไปเรื่อยๆ จนไม่เคย navigate สำเร็จสักที (หน้าเว็บค้างที่
// เดิม ยิง 401 ต่อเนื่องไม่มีที่สิ้นสุด ตามที่เจอจริงใน production) แก้โดย gate ด้วย flag เดียว ให้
// แสดง Swal ให้ผู้ใช้กดยืนยันครั้งเดียว แล้วค่อย navigate จริงตอนนั้น (คลิกจริงของผู้ใช้ = execution
// context ใหม่ ไม่โดนแย่งจาก request อื่นที่ยัง 401 ค้างอยู่)
let sessionExpiredHandled = false;
function forceLogout() {
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;
  Swal.fire({
    icon: 'warning',
    title: 'เซสชันหมดอายุ',
    text: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
    confirmButtonText: 'เข้าสู่ระบบ',
    allowOutsideClick: false,
  }).then(() => {
    localStorage.removeItem('user');
    localStorage.removeItem('session_mode');
    window.location.href = '/login';
  });
}

// ⭐️ Sprint 2 — B6: Idempotency key generator (UUID-like)
function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ⭐️ Sprint 2 — B6: Track if we're retrying queued requests
let isProcessingQueue = false;

// ⭐️ Security fix — เดิมอ่าน csrf token จาก document.cookie แต่ frontend (Vercel) กับ backend (Render)
// อยู่คนละ domain กัน หน้าเว็บอ่าน cookie ของ domain อื่นไม่ได้เลยแม้จะไม่ใช่ httpOnly (กฎ same-origin
// ของ browser) ทำให้ CSRF token เป็น null เสมอ = ทุก mutating request โดน backend ปฏิเสธ 403 จริง
// (bug ที่เจอจาก production จริง: POST /attendance/upload-photo 403 CSRF token ไม่ถูกต้องหรือหายไป)
// แก้โดยเก็บ csrf token ไว้ในตัวแปร JS แทน (ไม่ persist ข้าม reload) ได้ค่ามาจาก login/refresh response
// body (อ่านข้าม origin ได้ปกติผ่าน fetch/axios ต่างจาก cookie) หรือ fetch ใหม่จาก /auth/csrf-token
// ตอน reload หน้าเว็บ (คนละ token ต่อ access token ที่ backend ฝังไว้เป็น JWT claim อยู่แล้ว)
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) { csrfToken = token; }

// เรียกครั้งเดียวตอนโหลดแอป (module init) — ถ้ามี access_token cookie ที่ valid อยู่แล้ว (เช่น
// reload หน้าเว็บ) จะได้ csrf token กลับมาเก็บไว้ใช้ทันที ถ้ายังไม่ login ก็แค่ล้มเหลวเงียบๆ (401)
// ⭐️ เก็บ promise ไว้ด้วย (ไม่ใช่แค่ fire-and-forget) กัน race: ถ้าหน้าเว็บที่ reload ยิง mutating
// request ออกไปเร็วกว่านี้ resolve interceptor ด้านล่างจะ await ให้เสร็จก่อนค่อยแนบ header
async function bootstrapCsrfToken() {
  try {
    const res = await axios.get(`${API_BASE_URL}/auth/csrf-token`, { withCredentials: true });
    if (res.data?.csrfToken) csrfToken = res.data.csrfToken;
  } catch { /* ยังไม่ login หรือ token หมดอายุ — ไม่ต้องทำอะไร ตอน login จริงจะได้ค่าใหม่มาเอง */ }
}
let csrfBootstrapPromise: Promise<void> | null = bootstrapCsrfToken();

// 1. ตั้งค่าพื้นฐาน (เปลี่ยน URL ให้ตรงกับพอร์ต Backend ของนายถ้าไม่ใช่ 3000)
const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // ⭐️ Security remediation — ส่ง/รับ httpOnly cookie ข้าม origin (Vercel↔Render)
  headers: {
    'Content-Type': 'application/json'
  }
});

// 2. ใช้ Interceptor ดักจับทุก Request ก่อนวิ่งออกไปที่ Backend
api.interceptors.request.use(
  async (config) => {
    // ⭐️ Security remediation — แนบ CSRF token เฉพาะ request ที่เปลี่ยนแปลงข้อมูล (backend ก็เช็คแค่เท่านี้)
    const method = config.method?.toUpperCase() || '';
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      // ⭐️ กัน race ตอน reload หน้าเว็บ: ถ้า bootstrap ยังไม่เสร็จและยังไม่มี token ในมือ รอให้เสร็จก่อน
      if (!csrfToken && csrfBootstrapPromise) {
        await csrfBootstrapPromise;
        csrfBootstrapPromise = null;
      }
      if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
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
        // ⭐️ Security remediation — refresh_token อยู่ใน httpOnly cookie (path-scoped ไปที่ endpoint
        // นี้โดยเฉพาะ) browser แนบให้เองผ่าน withCredentials ไม่ต้องส่งใน body แล้ว
        if (!refreshPromise) {
          refreshPromise = api.post('/auth/refresh');
        }

        const { data } = await refreshPromise;
        refreshPromise = null;

        // ⭐️ access_token/refresh_token cookie ใหม่ถูกตั้งโดย backend (Set-Cookie) แล้ว — แค่ retry
        // request เดิม browser จะแนบ cookie ใหม่ให้เองอัตโนมัติ ส่วน csrf token ต้องอัปเดตในตัวแปร JS เอง
        if (data?.csrfToken) csrfToken = data.csrfToken;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed → session หมดจริง
        refreshPromise = null; // 🐛 FIX — เดิมไม่ reset ตอนพัง ทำให้ request 401 รอบถัดไปได้ promise ที่ reject ค้างไปตลอด
        forceLogout();
        return Promise.reject(refreshError);
      }
    }

    // ⭐️ Security remediation — บัญชีที่ยังใช้รหัสผ่านชั่วคราวอยู่ ถูก backend บล็อกทุก endpoint
    // ยกเว้น change-password/logout (ดู requirePasswordChange middleware). หน้า /shift ไม่ได้ห่อด้วย
    // Layout (ที่ force-open ChangePasswordModal) เลยต้องดักตรงนี้เป็น fallback แล้วเด้งไปหน้าที่มี Layout
    if (error.response?.status === 403 && error.response?.data?.code === 'MUST_CHANGE_PASSWORD') {
      if (!window.location.pathname.startsWith('/settings') && !window.location.pathname.startsWith('/pre-order')) {
        window.location.href = '/pre-order';
      }
      return Promise.reject(error);
    }

    // 🐛 FIX (MEMBER login bug) — เดิมเช็ค 401 กับ 403 รวมกัน แล้ว force logout ทั้งคู่
    // 403 = "login ถูกต้อง แต่ไม่มีสิทธิ์ทำ action นี้" (เช่น MEMBER หลุดเข้าหน้า POS แล้วยิง
    // GET /api/users/search ซึ่งเป็น endpoint เฉพาะ CASHIER/ADMIN) — ไม่ใช่ token เสีย/หมดอายุ
    // การ force logout ตรงนี้คือสาเหตุที่ทำให้ "frontend crashes/closes connection": session ที่ยัง
    // valid อยู่ถูกเตะทิ้งทั้งหน้าทั้งที่ควรแค่ปฏิเสธ request เดียวแล้วให้หน้าที่เรียกไป handle เอง
    // เหลือแค่ 401 (token หมดอายุ/ปลอม) ที่ควร force logout จริงๆ
    if (error.response && error.response.status === 401 && originalRequest._retry) {
      // Token refresh failed or already retried, force logout
      // ข้ามการเตะกลับถ้ากำลังอยู่ที่หน้า login เพื่อไม่ให้ loop
      if (window.location.pathname !== '/login') {
        forceLogout();
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
