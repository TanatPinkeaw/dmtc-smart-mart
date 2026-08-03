// ✅ CHANGED: visual refresh from Figma Make reference (School Co-op POS UI Design/LoginScreen.tsx)
//   — gradient button + loading spinner, rounder card/inputs (3xl/2xl), bolder heading, softer shadow
// ✅ CHANGED: post-login now always lands on /home (hub page) for every role — replaced the old
//   work/shop choice modal, which Home.tsx's module cards subsume (each card sets session_mode itself)
// 🔒 UNCHANGED: handleLogin, API call, localStorage, error/rate-limit state

import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import api, { setCsrfToken } from '../api';
import { getCurrentUser } from '../utils/getCurrentUser';
import { liff, ensureLiffInit, looksLikeLineInApp, getLiffTargetPath } from '../utils/liff';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // ⭐️ LINE Auto-Login — ถ้าเปิดจากเบราว์เซอร์ในแอป LINE (Rich Menu) จะพยายามล็อกอินอัตโนมัติก่อน
  //   ระหว่างนั้นโชว์สปินเนอร์แทนฟอร์ม (autoChecking) เพื่อไม่ให้ผู้ใช้เห็นฟอร์มล็อกอินเลย
  //   โชว์สปินเนอร์ด้วยถ้ามี deep-link ?path=... ติดมา (กันฟอร์ม flash ก่อน redirect ไปหน้าปลายทาง)
  const [autoChecking, setAutoChecking] = useState(looksLikeLineInApp() || !!getLiffTargetPath());

  // ⭐️ F4 — countdown ตอนโดน rate limit (429)
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const countdownIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    const handleRateLimited = (e: Event) => {
      const { retryAfter } = (e as CustomEvent<{ retryAfter: number }>).detail;
      setRateLimitCountdown(retryAfter);
    };
    window.addEventListener('rate-limited', handleRateLimited);
    return () => window.removeEventListener('rate-limited', handleRateLimited);
  }, []);

  useEffect(() => {
    if (rateLimitCountdown <= 0) {
      if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
      return;
    }
    countdownIntervalRef.current = window.setInterval(() => {
      setRateLimitCountdown(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => { if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current); };
  }, [rateLimitCountdown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const isRateLimited = rateLimitCountdown > 0;

  // ⭐️ LINE Auto-Login + Deep-link (LIFF) — รันครั้งเดียวตอนหน้า Login โหลด
  //   Rich Menu เปิด liff.line.me/<id>?path=/register (หรือ /pre-order) — อ่าน path แล้วแยกทาง:
  //     • path=/register  → เด้งไป /register ทันที (ไม่ต้อง line-login — Register.tsx จัดการ LIFF เอง)
  //     • path=/pre-order → auto-login แล้วเด้งไป /pre-order
  //   auto-login: liff.init → userId (+ id_token) → POST /auth/line-login → เก็บ session → เด้งเข้าหน้า
  //   ถ้ายังไม่ผูกบัญชี (401/404) → พาไป /register อย่างนุ่มนวล (ให้ไปสมัคร/ผูกบัญชี) ไม่โชว์ error ดิบ
  //   ผู้ใช้เว็บปกติ (ไม่ใช่ LINE และไม่มี ?path=) ข้ามทั้งหมด ไม่โหลด LIFF ไม่หน่วง
  useEffect(() => {
    const targetPath = getLiffTargetPath();

    // ⭐️ กฎสำคัญ: ปุ่มสมัครสมาชิก — เด้งไป /register ทันทีก่อนยิง line-login ใดๆ
    if (targetPath === '/register') { navigate('/register', { replace: true }); return; }

    if (!looksLikeLineInApp() && !targetPath) return; // เว็บปกติ ไม่มี deep-link — ไม่ทำอะไร
    if (getCurrentUser()) {
      navigate(targetPath === '/pre-order' ? '/pre-order' : '/home', { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await ensureLiffInit();
        if (!liff.isInClient()) { if (!cancelled) setAutoChecking(false); return; }
        if (!liff.isLoggedIn()) { liff.login(); return; } // redirect ออกไปขอ login ของ LINE แล้วกลับมาใหม่
        const profile = await liff.getProfile();
        const idToken = liff.getIDToken() || null;
        const res = await api.post('/auth/line-login', { line_user_id: profile.userId, id_token: idToken });
        localStorage.setItem('user', JSON.stringify(res.data.user));
        setCsrfToken(res.data.csrfToken);
        window.dispatchEvent(new Event('tokenChanged')); // ให้ SocketContext ต่อ socket ใหม่
        if (cancelled) return;
        // path=/pre-order → /pre-order เสมอ; ไม่ระบุ path → เลือกตาม role
        const dest = targetPath === '/pre-order' ? '/pre-order'
          : res.data.user.role === 'MEMBER' ? '/pre-order' : '/home';
        navigate(dest, { replace: true });
      } catch (err: any) {
        if (cancelled) return;
        // ⭐️ ยังไม่ผูกบัญชี (401/404) → พาไปสมัคร/ผูกบัญชีที่ /register แทนการโชว์ error
        if (err?.response?.status === 401 || err?.response?.status === 404) {
          navigate('/register', { replace: true });
          return;
        }
        // error อื่นๆ (เน็ต/CORS/500) — log ไว้ debug แล้ว fallback ไปโชว์ฟอร์มล็อกอินปกติ
        console.error('[LIFF auto-login] failed:', err?.response?.status, err?.message);
        setAutoChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRateLimited) return;
    setError(''); setLoading(true);
    try {
      const response = await api.post('/auth/login', { username, password });
      // ⭐️ Security remediation — token อยู่ใน httpOnly cookie ที่ backend ตั้งให้แล้ว (Set-Cookie)
      // เก็บแค่ข้อมูล user (ไม่ลับ) ไว้ใช้แสดงผล/role guard ฝั่ง client เท่านั้น
      localStorage.setItem('user', JSON.stringify(response.data.user));
      // ⭐️ Security fix — csrf token ต้องมาทาง response body (อ่านข้าม origin ได้) ไม่ใช่ cookie
      setCsrfToken(response.data.csrfToken);

      // ⭐️ F4 — Notify Socket context that token has changed (for same-tab reconnection)
      window.dispatchEvent(new Event('tokenChanged'));

      // ⭐️ ทุก role เข้าหน้า Home กลางก่อนเสมอ ให้เลือกโมดูลเองจากการ์ดในหน้า Home
      //   (เดิมมี logic ตั้ง session_mode work/shop ตามสถานะเข้างาน — ถอดออกแล้วพร้อมการเลิกใช้
      //    "โหมดซื้อของ" ของ staff ทั้งระบบ; staff จัดการงานผ่านเมนู staff, MEMBER ซื้อของผ่าน /pre-order)
      navigate('/home');
    } catch (err: any) {
      if (err.response?.status !== 429) {
        setError(err.response?.data?.error || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
      }
      setLoading(false);
    }
  };

  // ⭐️ ระหว่างลองล็อกอินผ่าน LINE อัตโนมัติ — โชว์สปินเนอร์แทนฟอร์ม (ไม่ให้เห็นฟอร์มล็อกอินเลย)
  if (autoChecking) {
    return (
      <div className="min-h-dvh bg-neutral-bg flex flex-col items-center justify-center gap-5 px-5">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center shadow-lg overflow-hidden">
          <img src="/logo-192.png" alt="DMTC Mart" className="w-full h-full object-contain p-2" />
        </div>
        <div className="flex items-center gap-2 text-gray-600 font-medium text-sm">
          <span className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          กำลังเข้าสู่ระบบผ่าน LINE...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-neutral-bg flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">

        {/* Brand — ⭐️ FIX: ใช้โลโก้จริงของร้านแทนกล่องไอคอน ShoppingBag เดิม */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center mb-4 shadow-lg overflow-hidden">
            <img src="/logo-192.png" alt="DMTC Mart" className="w-full h-full object-contain p-2" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">DMTC Mart</h1>
          <p className="mt-1 text-sm text-gray-500 font-medium">ระบบ POS สหกรณ์โรงเรียน</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-neutral-border rounded-3xl shadow-sm p-6">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-2xl">
              {error}
            </div>
          )}


          {/* ⭐️ F4 — แจ้งเตือน rate limit + countdown */}
          {isRateLimited && (
            <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-2xl text-center">
              พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารออีก <span className="font-bold">{rateLimitCountdown}</span> วินาที
            </div>
          )}

          <h2 className="text-lg font-bold text-gray-800 mb-5">เข้าสู่ระบบ</h2>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">ชื่อผู้ใช้งาน</label>
              <input
                type="text" required value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Username / รหัสนักศึกษา" disabled={isRateLimited}
                className="w-full px-4 py-3 rounded-full border border-neutral-border bg-neutral-bg text-sm font-medium text-gray-800 placeholder:text-gray-400 transition-colors duration-150 focus:outline-none focus:border-brand focus:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">รหัสผ่าน</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" disabled={isRateLimited}
                  className="w-full px-4 py-3 pr-12 rounded-full border border-neutral-border bg-neutral-bg text-sm font-medium text-gray-800 placeholder:text-gray-400 transition-colors duration-150 focus:outline-none focus:border-brand focus:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} disabled={isRateLimited} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand transition-colors duration-150 p-1 disabled:opacity-50">
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit" disabled={loading || isRateLimited}
              className="w-full py-3.5 mt-1 rounded-full text-white font-bold text-sm transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed
                enabled:bg-gradient-to-br enabled:from-brand enabled:to-brand-dark disabled:bg-gray-300
                focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
            >
              {isRateLimited ? (
                `กรุณารอ ${rateLimitCountdown} วินาที`
              ) : loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  กำลังเข้าสู่ระบบ...
                </span>
              ) : 'เข้าสู่ระบบ'}
            </button>
          </form>

          {/* ⭐️ F1 — ลืมรหัสผ่าน */}
          <div className="mt-5 pt-5 border-t border-neutral-border text-center">
            <Link to="/forgot-password" className="text-sm text-brand font-semibold hover:underline">
              ลืมรหัสผ่าน?
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400 font-medium">DMTC Mart © 2026</p>
      </div>
    </div>
  );
}
