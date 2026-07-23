// ✅ CHANGED: Layout, colors, typography → DMTC Mart theme
// 🔒 UNCHANGED: handleLogin, handleChooseWork, handleChooseShop, API call, localStorage, modal state

import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShoppingBag, Briefcase, Eye, EyeOff } from 'lucide-react';
import api from '../api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [showChoiceModal, setShowChoiceModal] = useState(false);
  const [loggedInRole, setLoggedInRole] = useState<string | null>(null);

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

      // ⭐️ F4 — Notify Socket context that token has changed (for same-tab reconnection)
      window.dispatchEvent(new Event('tokenChanged'));

      const role = response.data.user.role;
      if (role === 'ADMIN' || role === 'CASHIER') {
        setLoggedInRole(role); setShowChoiceModal(true); setLoading(false); return;
      }
      localStorage.removeItem('session_mode');
      navigate('/pre-order');
    } catch (err: any) {
      if (err.response?.status !== 429) {
        setError(err.response?.data?.error || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
      }
      setLoading(false);
    }
  };

  const handleChooseWork = () => { localStorage.setItem('session_mode', 'work'); navigate('/shift'); };
  const handleChooseShop = () => { localStorage.setItem('session_mode', 'shop'); navigate('/pre-order'); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-bg via-white to-brand-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Brand — ⭐️ FIX: ใช้โลโก้จริงของร้านแทนกล่องไอคอน ShoppingBag เดิม */}
        <div className="text-center mb-8">
          <img src="/logo-192.png" alt="DMTC Mart" className="inline-flex w-16 h-16 rounded-2xl shadow-lg mb-4 object-contain" />
          <h1 className="text-2xl font-bold text-gray-900">DMTC Mart</h1>
          <p className="mt-1 text-sm text-gray-500">ระบบ POS สหกรณ์โรงเรียน</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-brand-border rounded-2xl shadow-lg p-6">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl">
              {error}
            </div>
          )}

          {/* ⭐️ F4 — แจ้งเตือน rate limit + countdown */}
          {isRateLimited && (
            <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-xl text-center">
              พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารออีก <span className="font-bold">{rateLimitCountdown}</span> วินาที
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-500">ชื่อผู้ใช้งาน</label>
              <input
                type="text" required value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Username / รหัสนักศึกษา" disabled={isRateLimited}
                className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-500">รหัสผ่าน</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" disabled={isRateLimited}
                  className="w-full px-3 py-2.5 pr-10 bg-brand-bg border border-brand-border rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} disabled={isRateLimited} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 disabled:opacity-50">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit" disabled={loading || isRateLimited}
              className="w-full py-3 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
            >
              {isRateLimited ? `กรุณารอ ${rateLimitCountdown} วินาที` : loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>

          {/* ⭐️ F1 — ลืมรหัสผ่าน */}
          <div className="mt-4 text-center">
            <Link to="/forgot-password" className="text-sm text-brand hover:underline">
              ลืมรหัสผ่าน?
            </Link>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">DMTC Mart © 2026</p>
      </div>

      {/* Choice modal */}
      {showChoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-white border border-brand-border rounded-2xl shadow-xl w-full max-w-xs p-6 text-center">
            <div className="w-12 h-12 bg-brand-bg rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ShoppingBag size={22} className="text-brand" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">เข้ามาทำอะไรวันนี้?</h2>
            <p className="text-sm text-gray-500 mb-5">เลือกโหมดการใช้งาน</p>
            <div className="space-y-3">
              <button onClick={handleChooseWork} className="w-full flex items-center justify-center gap-2 py-3 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-xl shadow-sm transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
                <Briefcase size={18} /> เข้างาน
              </button>
              <button onClick={handleChooseShop} className="w-full flex items-center justify-center gap-2 py-3 bg-white border border-brand-mid text-brand hover:bg-brand-bg font-semibold text-sm rounded-xl shadow-sm transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
                <ShoppingBag size={18} /> ซื้อของ / จองสินค้า
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
