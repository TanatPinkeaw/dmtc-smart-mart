import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, LogOut } from 'lucide-react';
import api from '../api';

export default function Shift() {
  const [openingCash, setOpeningCash] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    // ⭐️ ถ้าเป็น ADMIN ให้เตะส่งไปหน้า Dashboard ทันที
    if (user.role === 'ADMIN') {
      navigate('/dashboard');
      return;
    }
    // ⭐️ เพิ่มการเช็ค: ถ้าไม่มี user.id ให้เตะกลับไปหน้า Login ทันที
    if (!user || !user.id) {
      navigate('/login');
      return;
    }

    const checkCurrentShift = async () => {
      try {
        const res = await api.get(`/shifts/current?cashier_id=${user.id}`);
        if (res.data && res.data.id) navigate('/pos');
      } catch (error) {}
    };
    checkCurrentShift();
  }, [user.id, user.role, navigate]);

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (openingCash === '') return alert('กรุณาระบุยอดเงินทอนตั้งต้น');
    setLoading(true);
    try {
      await api.post('/shifts/open', { cashier_id: user.id, opening_cash: Number(openingCash) });
      navigate('/pos');
    } catch (err: any) { alert(err.response?.data?.error); } 
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 md:p-6 font-sans">
      <div className="max-w-md w-full bg-white p-6 md:p-8 rounded-3xl shadow-xl text-center relative">
        <button onClick={() => { localStorage.clear(); navigate('/login'); }} className="absolute top-4 right-4 md:top-6 md:right-6 text-gray-400 hover:text-red-500 p-2 bg-gray-50 rounded-lg transition" title="สลับบัญชี">
          <LogOut size={18} />
        </button>

        <div className="w-20 h-20 md:w-24 md:h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 md:mb-6 shadow-inner mt-4">
          <Wallet className="text-green-600 w-10 h-10 md:w-12 md:h-12" />
        </div>
        
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">เปิดกะการขาย</h1>
        <p className="text-gray-500 mb-6 md:mb-8 text-sm md:text-base">ยินดีต้อนรับคุณ <strong>{user.full_name}</strong><br/>กรุณาระบุเงินทอนตั้งต้น</p>

        <form onSubmit={handleOpenShift} className="text-left space-y-4 md:space-y-6">
          <div>
            <input type="number" required min="0" value={openingCash} onChange={(e) => setOpeningCash(e.target.value ? Number(e.target.value) : '')} className="w-full text-center text-3xl md:text-4xl font-bold p-4 md:p-5 border border-gray-300 rounded-2xl focus:ring-4 focus:ring-green-100 focus:border-green-500 outline-none text-gray-800" placeholder="0.00" />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-green-500 text-white py-3 md:py-4 rounded-xl font-bold text-lg md:text-xl hover:bg-green-600 transition active:scale-95 disabled:bg-gray-300">
            {loading ? 'กำลังเปิดกะ...' : 'เริ่มขายสินค้า'}
          </button>
        </form>
      </div>
    </div>
  );
}