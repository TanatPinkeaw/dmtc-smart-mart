// 📄 pages/Login.tsx — หน้าเข้าสู่ระบบ (รหัสผ่าน + LINE auto-login)
//    ทำอะไร: ล็อกอินด้วยรหัสนักศึกษา/รหัสผ่าน; ถ้าเปิดในแอป LINE จะ auto-login ผ่าน LIFF ให้เอง (ไม่เจอ =
//    เด้งไปสมัคร /register); มี rate-limit นับถอยหลัง + loop-breaker กัน ping-pong ตอน ITP บล็อก cookie
// ✅ CHANGED: visual refresh from Figma Make reference (School Co-op POS UI Design/LoginScreen.tsx)
//   — gradient button + loading spinner, rounder card/inputs (3xl/2xl), bolder heading, softer shadow
// ✅ CHANGED: post-login now always lands on /home (hub page) for every role — replaced the old
//   work/shop choice modal, which Home.tsx's module cards subsume (each card sets session_mode itself)
// 🔒 UNCHANGED: handleLogin, API call, localStorage, error/rate-limit state

import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { FieldLabel } from '../components/ui/FieldLabel';
import { InlineAlert } from '../components/ui/InlineAlert';
import api, { setCsrfToken, setBearerToken } from '../api';
import Swal from '../swal';
import { getCurrentUser } from '../utils/getCurrentUser';
import { type ErrorLike } from '../utils/errorMessage';
import { liff, ensureLiffInit, looksLikeLineInApp, getLiffTargetPath, getLiffExtraParams } from '../utils/liff';

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
  // ⭐️ กันเอฟเฟกต์ auto-login ทำงานซ้ำ (StrictMode double-invoke / re-render) — line-login + navigate
  //   ต้องรัน "ครั้งเดียว" ต่อ lifecycle เท่านั้น
  const hasAttemptedLiffLogin = useRef(false);

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
    // ⭐️ รันครั้งเดียวเท่านั้น (กัน StrictMode double-invoke / re-render loop)
    if (hasAttemptedLiffLogin.current) return;
    hasAttemptedLiffLogin.current = true;

    // ⭐️ PING-PONG LOOP BREAKER — ถ้าเพิ่งเด้งกลับมาจาก protected route ที่ 401 (LIFF auto-login ผ่าน
    //   แต่ /pre-order ยิง API แล้ว 401 เพราะ LINE in-app browser บล็อก cookie ด้วย ITP → forceLogout
    //   → reload /login → เกือบจะ auto-login ใหม่วนไม่จบ) ให้ "หยุด" ตรงนี้เลย: ล้าง flag, เตือนผู้ใช้,
    //   แล้ว return ทิ้งทันที ปล่อยให้ผู้ใช้ล็อกอินด้วยรหัสผ่านเองแทน — ตัดวงจร ping-pong ทางกายภาพ
    // ⭐️ ห่อ try/catch — บางเบราว์เซอร์/โหมด (private / cookie ถูกบล็อก) เข้าถึง sessionStorage แล้ว throw
    //   ถ้าไม่ดักไว้ exception จะเด้งออกจาก effect ทันที = autoChecking ค้าง true = สปินเนอร์ค้างวนเอง
    let justBounced = false;
    try {
      justBounced = sessionStorage.getItem('liff_loop_breaker') === 'true';
      if (justBounced) sessionStorage.removeItem('liff_loop_breaker');
    } catch { /* storage ถูกบล็อก — ข้าม loop breaker ไป (LIFF flow ยังทำงานได้ปกติ) */ }
    if (justBounced) {
      // ⭐️ Phase 4 — เปลี่ยนจาก alert() ดิบๆ (ใช้ตอน debug ปัญหา loop) เป็น Swal ให้ตรงธีม/สไตล์
      //   เดียวกับข้อความอื่นทั้งแอป (เช่น forceLogout ใน api.ts ก็ใช้ pattern เดียวกันนี้)
      Swal.fire({
        icon: 'warning',
        title: 'เซสชันหมดอายุ',
        text: 'เซสชันหมดอายุ หรือเบราว์เซอร์ LINE บล็อกคุกกี้ กรุณาล็อกอินด้วยรหัสผ่าน',
        confirmButtonText: 'ตกลง',
      });
      setAutoChecking(false); // โชว์ฟอร์มล็อกอินปกติ
      return;
    }

    const targetPath = getLiffTargetPath();

    // ⭐️ กฎสำคัญ: ปุ่มสมัครสมาชิก — เด้งไป /register ทันทีก่อนยิง line-login ใดๆ
    if (targetPath === '/register') { navigate('/register', { replace: true }); return; }

    if (!looksLikeLineInApp() && !targetPath) return; // เว็บปกติ ไม่มี deep-link — ไม่ทำอะไร

    // ⭐️ query param อื่นๆ นอกจาก path (เช่น ?view=orders จากลิงก์ประวัติการซื้อใน LINE webhook) —
    // forward ต่อไปยัง /pre-order เท่านั้น (หน้าอื่นไม่มี deep-link แบบนี้ให้ใช้)
    const extra = getLiffExtraParams();
    const preOrderDest = extra ? `/pre-order?${extra}` : '/pre-order';

    if (getCurrentUser()) {
      navigate(targetPath === '/pre-order' ? preOrderDest : '/home', { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await ensureLiffInit();
        if (!liff.isInClient()) { if (!cancelled) setAutoChecking(false); return; }
        // ⭐️ CRITICAL: ห้ามเรียก liff.login() ตอนอยู่ในแอป LINE (isInClient=true) — จะบังคับ reload
        //   หน้าวนไม่จบ. อยู่ในแอป LINE จะ auto-login ให้เองอยู่แล้ว เรียก getProfile ต่อได้เลย
        //   (liff.login() ใช้เฉพาะเบราว์เซอร์ภายนอกเท่านั้น ซึ่ง path นี้ไม่ถึงอยู่แล้วเพราะ isInClient=true)
        const profile = await liff.getProfile();
        const idToken = liff.getIDToken() || null;
        const res = await api.post('/auth/line-login', { line_user_id: profile.userId, id_token: idToken });
        localStorage.setItem('user', JSON.stringify(res.data.user));
        setCsrfToken(res.data.csrfToken);
        // ⭐️ Bearer token fallback — LINE in-app browser (ITP) บล็อก cookie ข้าม origin แบบ
        // deterministic เก็บ access_token ไว้แนบเป็น Authorization header เอง กันหลุด 401 ping-pong
        // loop ตั้งแต่ request แรกหลัง auto-login (ไม่มีผล ถ้า cookie ใช้ได้อยู่แล้ว — แค่ redundant)
        if (res.data.access_token) setBearerToken(res.data.access_token);
        window.dispatchEvent(new Event('tokenChanged')); // ให้ SocketContext ต่อ socket ใหม่
        if (cancelled) return;
        // path=/pre-order → /pre-order (พร้อม extra params ถ้ามี) เสมอ; ไม่ระบุ path → เลือกตาม role
        const dest = targetPath === '/pre-order' ? preOrderDest
          : res.data.user.role === 'MEMBER' ? preOrderDest : '/home';
        navigate(dest, { replace: true });
      } catch (err) {
        if (cancelled) return;
        // ⭐️ ยังไม่ผูกบัญชี (401/404) → พาไปสมัคร/ผูกบัญชีที่ /register แทนการโชว์ error
        const e = err as ErrorLike;
        if (e?.response?.status === 401 || e?.response?.status === 404) {
          navigate('/register', { replace: true });
          return;
        }
        // error อื่นๆ (เน็ต/CORS/500) — log ไว้ debug แล้ว fallback ไปโชว์ฟอร์มล็อกอินปกติ
        console.error('[LIFF auto-login] failed:', e?.response?.status, e?.message);
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
    } catch (err) {
      const e = err as ErrorLike;
      if (e.response?.status !== 429) {
        const backendMsg = e.response?.data?.error;
        setError(typeof backendMsg === 'string' ? backendMsg : 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
      }
      setLoading(false);
    }
  };

  // ⭐️ ระหว่างลองล็อกอินผ่าน LINE อัตโนมัติ — โชว์สปินเนอร์แทนฟอร์ม (ไม่ให้เห็นฟอร์มล็อกอินเลย)
  if (autoChecking) {
    return (
      <div className="min-h-dvh bg-neutral-bg flex flex-col items-center justify-center gap-5 px-5">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center shadow-lg overflow-hidden">
          <img src="/logo-192.png" alt={storeName || "Store"} className="w-full h-full object-contain p-2" />
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
            <img src="/logo-192.png" alt={storeName || "Store"} className="w-full h-full object-contain p-2" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">{storeName || "Store"}</h1>
          <p className="mt-1 text-sm text-gray-500 font-medium">ระบบ POS สหกรณ์โรงเรียน</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-neutral-border rounded-3xl shadow-sm p-6">
          {error && (
            <InlineAlert tone="error" className="mb-4">{error}</InlineAlert>
          )}


          {/* ⭐️ F4 — แจ้งเตือน rate limit + countdown */}
          {isRateLimited && (
            <InlineAlert tone="warning" className="mb-4 text-center">
              พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารออีก <span className="font-bold">{rateLimitCountdown}</span> วินาที
            </InlineAlert>
          )}

          <h2 className="text-lg font-bold text-gray-800 mb-5">เข้าสู่ระบบ</h2>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <FieldLabel>ชื่อผู้ใช้งาน</FieldLabel>
              <input
                type="text" required value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Username / รหัสนักศึกษา" disabled={isRateLimited}
                className="w-full px-4 py-3 rounded-full border border-neutral-border bg-neutral-bg text-sm font-medium text-gray-800 placeholder:text-gray-400 transition-colors duration-150 focus:outline-none focus:border-brand focus:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <FieldLabel>รหัสผ่าน</FieldLabel>
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

            <Button
              type="submit" disabled={loading || isRateLimited} size="lg" className="w-full mt-1"
            >
              {isRateLimited ? (
                `กรุณารอ ${rateLimitCountdown} วินาที`
              ) : loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  กำลังเข้าสู่ระบบ...
                </span>
              ) : 'เข้าสู่ระบบ'}
            </Button>
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
