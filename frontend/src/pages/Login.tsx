// ✅ CHANGED: Layout, colors, typography → DMTC Mart theme
// 🔒 UNCHANGED: handleLogin, handleChooseWork, handleChooseShop, API call, localStorage, modal state

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const response = await api.post('/auth/login', { username, password });
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      const role = response.data.user.role;
      if (role === 'ADMIN' || role === 'CASHIER') {
        setLoggedInRole(role); setShowChoiceModal(true); setLoading(false); return;
      }
      localStorage.removeItem('session_mode');
      navigate('/pre-order');
    } catch (err: any) { setError(err.response?.data?.error || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง'); setLoading(false); }
  };

  const handleChooseWork = () => { localStorage.setItem('session_mode', 'work'); navigate('/shift'); };
  const handleChooseShop = () => { localStorage.setItem('session_mode', 'shop'); navigate('/pre-order'); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFF5F7] via-white to-[#FFF5F7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[#F12B6B] rounded-2xl shadow-lg mb-4">
            <ShoppingBag size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">DMTC Mart</h1>
          <p className="mt-1 text-sm text-gray-500">ระบบ POS สหกรณ์โรงเรียน</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-[#F6C7C7] rounded-2xl shadow-sm p-6">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-500">ชื่อผู้ใช้งาน</label>
              <input
                type="text" required value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Username / รหัสนักศึกษา"
                className="w-full px-3 py-2.5 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#F12B6B] focus:border-[#F12B6B] transition-colors duration-150"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-500">รหัสผ่าน</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 pr-10 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#F12B6B] focus:border-[#F12B6B] transition-colors duration-150"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit" disabled={loading}
              className="w-full py-3 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#F12B6B] focus:ring-offset-2"
            >
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">DMTC Mart © 2026</p>
      </div>

      {/* Choice modal */}
      {showChoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-white border border-[#F6C7C7] rounded-2xl shadow-xl w-full max-w-xs p-6 text-center">
            <div className="w-12 h-12 bg-[#FFF5F7] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ShoppingBag size={22} className="text-[#F12B6B]" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">เข้ามาทำอะไรวันนี้?</h2>
            <p className="text-sm text-gray-500 mb-5">เลือกโหมดการใช้งาน</p>
            <div className="space-y-3">
              <button onClick={handleChooseWork} className="w-full flex items-center justify-center gap-2 py-3 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95">
                <Briefcase size={18} /> เข้างาน
              </button>
              <button onClick={handleChooseShop} className="w-full flex items-center justify-center gap-2 py-3 bg-white border border-[#FD94B4] text-[#F12B6B] hover:bg-[#FFF5F7] font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95">
                <ShoppingBag size={18} /> ซื้อของ / จองสินค้า
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
