import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store } from 'lucide-react';
import api from '../api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
 
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const response = await api.post('/auth/login', { username, password });
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      
      // ⭐️ เปลี่ยนตรงนี้: แยกทางเดินระหว่าง ADMIN กับ CASHIER
      if (response.data.user.role === 'ADMIN') {
        navigate('/dashboard'); // ผู้จัดการไปหน้าสรุปยอดเลย
      } else {
        navigate('/shift'); // แคชเชียร์ไปเปิดลิ้นชัก
      }
      
    } catch (err: any) { setError(err.response?.data?.error || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง'); } 
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-pink-50 flex items-center justify-center p-4 md:p-6 font-sans">
      <div className="max-w-md w-full bg-white p-6 md:p-8 rounded-2xl shadow-lg border border-pink-100">
        <div className="flex flex-col items-center mb-6 md:mb-8">
          <div className="w-16 h-16 md:w-20 md:h-20 bg-pink-600 rounded-full flex items-center justify-center mb-3 md:mb-4">
            <Store className="text-white w-8 h-8 md:w-10 md:h-10" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">ระบบ POS สหกรณ์</h1>
          <p className="text-gray-500 mt-1 md:mt-2 text-sm md:text-base">กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ</p>
        </div>

        {error && <div className="bg-red-50 text-red-600 p-3 md:p-4 rounded-xl mb-6 text-center text-sm border border-red-100">{error}</div>}

        <form onSubmit={handleLogin} className="space-y-4 md:space-y-6">
          <Input label="ชื่อผู้ใช้งาน" value={username} onChange={setUsername} placeholder="Username" />
          <Input label="รหัสผ่าน" type="password" value={password} onChange={setPassword} placeholder="••••••••" />
          <button type="submit" disabled={loading} className="w-full bg-pink-600 text-white py-3 md:py-4 rounded-xl font-bold text-base md:text-lg hover:bg-pink-700 transition active:scale-95 disabled:bg-pink-300">
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}

const Input = ({ label, value, onChange, type = "text", placeholder }: any) => (
  <div>
    <label className="block text-sm font-bold text-gray-700 mb-1 md:mb-2">{label}</label>
    <input type={type} required value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full p-3 md:p-4 border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm md:text-base" />
  </div>
);