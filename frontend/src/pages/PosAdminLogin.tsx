import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function PosAdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [dbName, setDbName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/pos-admin/login', {
        username, password, db_name: dbName,
      });
      if (data.success) {
        localStorage.setItem('pos_admin_user', JSON.stringify(data.user));
        localStorage.setItem('pos_admin_db', data.db_name);
        localStorage.setItem('pos_admin_store', data.store_name);
        navigate('/pos-admin/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600">
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-2">จัดการร้าน POS</h1>
        <p className="text-gray-500 text-center mb-6">เข้าสู่ระบบจัดการร้านค้า</p>
        
        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl mb-4 text-sm">{error}</div>
        )}
        
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัสร้าน (DB Name)</label>
            <input type="text" value={dbName} onChange={e => setDbName(e.target.value)}
              placeholder="เช่น pos_dmtc-mart" required
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัสนักศึกษา</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="รหัสนักศึกษา" required
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัสผ่าน</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="รหัสผ่าน" required
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-50">
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}
