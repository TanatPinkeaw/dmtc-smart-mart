// 📄 pages/pos-admin/PosAdminLogin.tsx — หน้าเข้าสู่ระบบ POS Admin (จัดการร้านแยกตาม tenant)
//    ทำอะไร: Login เฉพาะ tenant DB (กรอกรหัสร้าน/db_name + รหัสนักศึกษา + รหัสผ่าน)
//    ต่างจาก Login.tsx ปกติ: ไม่ใช้ cookie auth, ไม่ใช้ LIFF, ใช้ pos_admin_* localStorage keys

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { InlineAlert } from '../../components/ui/InlineAlert';
import { FieldLabel } from '../../components/ui/FieldLabel';

import { Button } from '../../components/ui/Button';

function PosAdminLogin() {
  const [dbName, setDbName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/pos-admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, db_name: dbName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
        setLoading(false);
        return;
      }
      localStorage.setItem('pos_admin_user', JSON.stringify(data.user));
      localStorage.setItem('pos_admin_db', data.db_name);
      localStorage.setItem('pos_admin_store', data.store_name);
      localStorage.setItem('pos_admin_token', data.token);
      localStorage.setItem('pos_admin_csrf', data.csrfToken);
      navigate('/pos-admin/dashboard');
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4 shadow-lg">
            <span className="text-3xl">🏪</span>
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900">จัดการร้าน POS</h1>
          <p className="mt-1 text-sm text-gray-500">เข้าสู่ระบบเพื่อจัดการร้านค้า</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-6">
          {error && (
            <InlineAlert tone="error" className="mb-4">
              {error}
            </InlineAlert>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <FieldLabel>รหัสร้าน (db_name)</FieldLabel>
              <input
                type="text" required value={dbName} onChange={e => setDbName(e.target.value)}
                placeholder="เช่น dmtc-mart"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition"
              />
            </div>

            <div>
              <FieldLabel>รหัสนักศึกษา</FieldLabel>
              <input
                type="text" required value={username} onChange={e => setUsername(e.target.value)}
                placeholder="รหัสนักศึกษา"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition"
              />
            </div>

            <div>
              <FieldLabel>รหัสผ่าน</FieldLabel>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition"
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-emerald-600 transition p-1">
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={loading} variant="primary" className="w-full mt-1">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  กำลังเข้าสู่ระบบ...
                </span>
              ) : 'เข้าสู่ระบบ'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center">
          <Link to="/login" className="text-sm text-emerald-600 font-semibold hover:underline">
            ← กลับไปเข้าสู่ระบบปกติ
          </Link>
        </p>

        <p className="mt-4 text-center text-xs text-gray-400">DMTC Mart © 2026</p>
      </div>
    </div>
  );
}

export default PosAdminLogin;
