import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Receipt, Banknote, CreditCard, LogOut, Package, ArrowLeft } from 'lucide-react';
import api from '../api';

export default function Dashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { navigate('/login'); return; }
    fetchDashboardData();
  }, [navigate]);

  const fetchDashboardData = async () => {
    try {
      const [dashRes, topRes] = await Promise.all([ api.get('/reports/dashboard'), api.get('/reports/top-selling') ]);
      setSummary(dashRes.data.summary);
      setTopProducts(topRes.data);
    } catch (error) { console.error("Error fetching dashboard data:", error); } 
    finally { setLoading(false); }
  };

  const handleLogout = () => { localStorage.clear(); navigate('/login'); };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50 font-sans text-lg font-bold text-gray-500">กำลังโหลดข้อมูล...</div>;

  return (
    // ปรับ Padding ในมือถือให้เล็กลง (p-4 md:p-6)
    <div className="min-h-screen bg-gray-100 font-sans p-4 md:p-6">
      
      {/* Header (เรียงเป็นแนวตั้งในมือถือ, แนวนอนในคอม) */}
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-2xl shadow-sm mb-6 gap-4">
        <div className="flex items-center gap-2 md:gap-3 text-indigo-600">
          <LayoutDashboard size={24} className="md:w-7 md:h-7" />
          <h1 className="text-xl md:text-2xl font-bold text-gray-800">สรุปยอดขายประจำวัน</h1>
        </div>
        
        {/* แผงปุ่มด้านขวา */}
        <div className="flex flex-wrap items-center gap-2 md:gap-4 w-full md:w-auto justify-between md:justify-end">
          <button onClick={() => navigate('/pos')} className="flex items-center gap-1 md:gap-2 text-gray-600 hover:text-blue-600 font-medium bg-gray-50 hover:bg-blue-50 px-3 py-2 rounded-xl transition text-sm md:text-base">
            <ArrowLeft size={16} /> <span className="hidden sm:inline">กลับไปหน้า POS</span><span className="sm:hidden">ไป POS</span>
          </button>
          
          <div className="hidden md:block border-l h-8 border-gray-300 mx-2"></div>
          
          <span className="font-medium text-gray-600 text-sm md:text-base truncate max-w-[120px] sm:max-w-none">{user.full_name}</span>
          
          {/* ปุ่ม Logout ซ่อนในมือถือ (เพราะมีที่ Bottom Nav แล้ว) */}
          <button onClick={handleLogout} className="hidden md:block text-red-500 hover:bg-red-50 p-2 rounded-lg transition">
            <LogOut size={20} />
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* ================= ซ้าย: Card สรุปยอดขาย ================= */}
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            
            {/* Card ยอดขายรวม */}
            <div className="bg-gradient-to-br from-indigo-500 to-blue-600 p-5 md:p-6 rounded-3xl shadow-lg text-white">
              <div className="flex justify-between items-start mb-2 md:mb-4">
                <div>
                  <p className="text-indigo-100 font-medium mb-1 text-sm md:text-base">ยอดขายรวมวันนี้</p>
                  {/* ลดขนาด Font ในมือถือ (text-3xl) */}
                  <h2 className="text-3xl md:text-4xl font-bold">฿{Number(summary?.total_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
                </div>
                <div className="bg-white/20 p-2 md:p-3 rounded-2xl">
                  <TrendingUp size={24} className="md:w-7 md:h-7" />
                </div>
              </div>
              <p className="text-xs text-indigo-100 opacity-80">* ข้อมูลรีเซ็ตทุกเที่ยงคืน</p>
            </div>

            {/* Card จำนวนบิล */}
            <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-gray-500 font-medium mb-1 text-sm md:text-base">จำนวนบิลทั้งหมด</p>
                  <h2 className="text-3xl md:text-4xl font-bold text-gray-800">{summary?.total_bills || 0} <span className="text-sm md:text-lg text-gray-400 font-normal">บิล</span></h2>
                </div>
                <div className="bg-green-100 text-green-600 p-2 md:p-3 rounded-2xl">
                  <Receipt size={24} className="md:w-7 md:h-7" />
                </div>
              </div>
            </div>

            {/* Card เงินสด */}
            <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2 text-gray-500 font-medium text-sm md:text-base">
                  <Banknote size={18} className="text-emerald-500 md:w-5 md:h-5" /> ยอดรับเงินสด
                </div>
                <span className="font-bold text-gray-800 text-lg md:text-xl">฿{Number(summary?.cash_sales || 0).toLocaleString()}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mt-3 md:mt-4">
                <div className="bg-emerald-400 h-2 rounded-full" style={{ width: summary?.total_sales ? `${(summary.cash_sales / summary.total_sales) * 100}%` : '0%' }}></div>
              </div>
            </div>

            {/* Card เงินโอน */}
            <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2 text-gray-500 font-medium text-sm md:text-base">
                  <CreditCard size={18} className="text-purple-500 md:w-5 md:h-5" /> ยอดรับเงินโอน (QR)
                </div>
                <span className="font-bold text-gray-800 text-lg md:text-xl">฿{Number(summary?.qr_sales || 0).toLocaleString()}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mt-3 md:mt-4">
                <div className="bg-purple-400 h-2 rounded-full" style={{ width: summary?.total_sales ? `${(summary.qr_sales / summary.total_sales) * 100}%` : '0%' }}></div>
              </div>
            </div>

          </div>
        </div>

        {/* ================= ขวา: สินค้าขายดี Top 10 ================= */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 md:p-6 flex flex-col h-full">
          <div className="flex items-center gap-2 mb-4 md:mb-6">
            <Package className="text-orange-500 w-5 h-5 md:w-6 md:h-6" />
            <h2 className="text-lg md:text-xl font-bold text-gray-800">10 อันดับสินค้าขายดี</h2>
          </div>
          
          {/* กำหนดความสูงต่ำสุดในมือถือ เพื่อให้เลื่อนได้ง่าย */}
          <div className="flex-1 overflow-y-auto pr-1 md:pr-2 space-y-3 min-h-[300px]">
            {topProducts.length === 0 ? (
              <p className="text-center text-gray-400 mt-10 text-sm">ยังไม่มีข้อมูลการขายในวันนี้</p>
            ) : (
              topProducts.map((product, index) => (
                <div key={product.product_id} className="flex items-center justify-between p-2 md:p-3 hover:bg-gray-50 rounded-xl transition">
                  <div className="flex items-center gap-3 md:gap-4">
                    <div className={`w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      index === 0 ? 'bg-yellow-100 text-yellow-600' :
                      index === 1 ? 'bg-gray-200 text-gray-600' :
                      index === 2 ? 'bg-orange-100 text-orange-600' : 'bg-blue-50 text-blue-600'
                    }`}>
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-bold text-gray-800 line-clamp-1 text-sm md:text-base">{product.name}</p>
                      <p className="text-xs md:text-sm text-gray-500">ขายแล้ว {product.total_quantity} ชิ้น</p>
                    </div>
                  </div>
                  <div className="font-bold text-blue-600 text-sm md:text-base">
                    ฿{Number(product.total_revenue).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}