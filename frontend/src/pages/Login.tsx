// ✅ CHANGED: visual refresh from Figma Make reference (School Co-op POS UI Design/LoginScreen.tsx)
//   — gradient button + loading spinner, rounder card/inputs (3xl/2xl), bolder heading, softer shadow
// ✅ CHANGED: post-login now always lands on /home (hub page) for every role — replaced the old
//   work/shop choice modal, which Home.tsx's module cards subsume (each card sets session_mode itself)
// 🔒 UNCHANGED: handleLogin, API call, localStorage, error/rate-limit state

import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import api, { setCsrfToken } from '../api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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

      // ⭐️ NEW — ตั้งโหมดใช้งานอัตโนมัติจากสถานะเข้างานจริง (backend ส่ง has_active_work_session มาให้)
      //   staff ที่ยังเข้างานค้างอยู่ (เปิดกะ/ลงชื่อเข้างานแล้วยังไม่ออก) = เข้าโหมดทำงานต่อได้เลย
      //   ใครที่ไม่ได้เข้างาน (รวม MEMBER ทุกคน) = โหมดซื้อของตามเดิม
      //   ยังเปลี่ยนเองได้ทีหลังจากการ์ดโมดูลในหน้า Home (goTo ตั้ง session_mode ทับ)
      // 🐛 FIX — ต้องแยก undefined (backend รุ่นเก่ายังไม่ deploy = ไม่มี field นี้) ออกจาก false
      //   ไม่งั้น `undefined ? 'work' : 'shop'` จะเหวี่ยง staff ทุกคนไปโหมดซื้อของ ทั้งที่เข้างานอยู่จริง
      //   กรณีไม่มี field ให้คงพฤติกรรมเดิม (ไม่ตั้งค่า = Layout ถือว่าเป็น staff) จนกว่า backend จะอัปเดต
      // ⭐️ ADMIN เข้าโหมดทำงานเสมอ ไม่ต้องลงชื่อเข้างานก่อน (งานหลังบ้านไม่ใช่กะขายของ)
      //   กติกาเช็คกะใช้กับ CASHIER เท่านั้น
      const workFlag = response.data.has_active_work_session;
      if (response.data.user.role === 'ADMIN') localStorage.setItem('session_mode', 'work');
      else if (workFlag === undefined) localStorage.removeItem('session_mode');
      else localStorage.setItem('session_mode', workFlag ? 'work' : 'shop');
      // ⭐️ ทุก role เข้าหน้า Home กลางก่อนเสมอ
      navigate('/home');
    } catch (err: any) {
      if (err.response?.status !== 429) {
        setError(err.response?.data?.error || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-brand-bg flex flex-col items-center justify-center px-5 py-10">
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
        <div className="bg-white border border-brand-border rounded-3xl shadow-sm p-6">
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
                className="w-full px-4 py-3 rounded-full border border-brand-border bg-brand-bg text-sm font-medium text-gray-800 placeholder:text-gray-400 transition-colors duration-150 focus:outline-none focus:border-brand focus:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">รหัสผ่าน</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" disabled={isRateLimited}
                  className="w-full px-4 py-3 pr-12 rounded-full border border-brand-border bg-brand-bg text-sm font-medium text-gray-800 placeholder:text-gray-400 transition-colors duration-150 focus:outline-none focus:border-brand focus:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} disabled={isRateLimited} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand transition-colors duration-150 p-1 disabled:opacity-50">
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit" disabled={loading || isRateLimited}
              className="w-full py-3.5 mt-1 rounded-full text-white font-bold text-sm transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed
                enabled:bg-gradient-to-br enabled:from-brand enabled:to-brand-dark disabled:bg-brand-border
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
          <div className="mt-5 pt-5 border-t border-brand-border text-center">
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
