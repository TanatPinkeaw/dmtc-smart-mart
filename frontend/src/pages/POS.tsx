import { useState, useEffect } from 'react';
import { ShoppingCart, User, Plus, Minus, Lock, X, CheckCircle, PackagePlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Swal from 'sweetalert2';

interface Category { id: number; name: string; }
interface Product { id: number; barcode: string; name: string; price: string | number; image_url: string; category_id: number | null; }
interface CartItem extends Product { quantity: number; }

export default function POS() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | 'ALL'>('ALL');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [amountReceived, setAmountReceived] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);

  // ⭐️ State ควบคุมตะกร้าสินค้าในมือถือ
  const [isCartOpen, setIsCartOpen] = useState(false);

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [actualCash, setActualCash] = useState<number | ''>('');
  const [closeLoading, setCloseLoading] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<any>(null);

  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { navigate('/login'); return; }
    fetchCategories(); fetchProducts();
  }, [navigate]);

  const fetchCategories = async () => { try { const res = await api.get('/categories'); setCategories(res.data); } catch (e) { console.error(e); } };
  const fetchProducts = async () => { try { const res = await api.get('/products'); setProducts(res.data); } catch (e) { console.error(e); } };

  const filteredProducts = selectedCategory === 'ALL' ? products : products.filter(p => p.category_id === selectedCategory);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) return prev.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart((prev) => prev.map(item => item.id === id ? { ...item, quantity: item.quantity + delta } : item).filter(item => item.quantity > 0));
  };

  const grandTotal = cart.reduce((total, item) => total + (Number(item.price) * item.quantity), 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return Swal.fire({ icon: 'warning', title: 'ตะกร้าว่างเปล่า!', confirmButtonColor: '#3b82f6' });
    if (!amountReceived || Number(amountReceived) < grandTotal) return Swal.fire({ icon: 'error', title: 'รับเงินมาไม่พอ!', confirmButtonColor: '#ef4444' });

    setLoading(true);
    try {
      const payload = { cashier_id: user.id, payment_method: "CASH", amount_received: Number(amountReceived), items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })) };
      const response = await api.post('/sales/checkout', payload);

      // ⭐️ Popup จ่ายเงินสำเร็จแบบอลังการ
      Swal.fire({
        icon: 'success',
        title: 'ทำรายการสำเร็จ! 🎉',
        html: `เลขที่บิล: <b>#${response.data.receipt.sale_id}</b><br/><br/>เงินทอน: <b style="color: #2563eb; font-size: 24px;">฿${response.data.receipt.change_amount}</b>`,
        confirmButtonColor: '#22c55e',
        confirmButtonText: 'ตกลง'
      });

      setCart([]); setAmountReceived(''); fetchProducts(); setIsCartOpen(false);
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error }); }
    finally { setLoading(false); }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actualCash === '') return Swal.fire({ icon: 'warning', title: 'กรุณาระบุยอดเงิน' });
    setCloseLoading(true);
    try {
      const response = await api.post('/shifts/close', { cashier_id: user.id, actual_cash: Number(actualCash) });
      setShiftSummary(response.data.summary);
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error }); }
    finally { setCloseLoading(false); }
  };

  const finishAndLogout = () => { localStorage.clear(); navigate('/login'); };

  return (
    <div className="flex h-full bg-gray-50 font-sans relative">

      {/* ================= ฝั่งซ้าย: สินค้าและหมวดหมู่ ================= */}
      <div className="w-full md:w-2/3 flex flex-col h-full">
        {/* Header */}
        <div className="bg-white p-3 md:p-4 shadow-sm flex justify-between items-center z-10 shrink-0">
          <h1 className="text-lg md:text-2xl font-bold text-gray-800">ระบบ POS</h1>
          <div className="flex items-center gap-2 md:gap-4">
            <div className="hidden sm:flex items-center gap-2 text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full text-sm">
              <User size={16} /> <span className="font-medium truncate max-w-[100px]">{user.full_name || 'CASHIER'}</span>
            </div>
            
            {/* ⭐️ ครอบปุ่มนี้ไว้: แสดงปุ่มปิดกะ เฉพาะตอนที่ไม่ใช่ ADMIN เท่านั้น */}
            {user.role !== 'ADMIN' && (
              <button onClick={() => setShowCloseModal(true)} className="bg-red-50 text-red-600 hover:bg-red-500 hover:text-white px-3 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl flex items-center gap-1.5 font-bold transition shadow-sm text-xs md:text-base">
                <Lock size={16} /> <span className="hidden sm:inline">ปิดกะ (เลิกงาน)</span><span className="sm:hidden">ปิดกะ</span>
              </button>
            )}
            
          </div>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

          {/* ⭐️ แถบหมวดหมู่: แนวนอนในมือถือ, แนวตั้งในคอม */}
          <div className="md:w-1/4 bg-white md:border-r border-b md:border-b-0 border-gray-200 p-3 md:p-4 overflow-x-auto md:overflow-y-auto shrink-0 scrollbar-hide flex flex-row md:flex-col gap-2">
            <h2 className="hidden md:block text-lg font-bold text-gray-700 mb-2 px-2">หมวดหมู่</h2>
            <button onClick={() => setSelectedCategory('ALL')} className={`shrink-0 md:w-full text-center md:text-left px-4 py-2 md:py-3 rounded-full md:rounded-xl font-medium text-sm md:text-base transition ${selectedCategory === 'ALL' ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 md:bg-transparent text-gray-600 hover:bg-gray-100'}`}>
              ทั้งหมด
            </button>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`shrink-0 md:w-full text-center md:text-left px-4 py-2 md:py-3 rounded-full md:rounded-xl font-medium text-sm md:text-base transition ${selectedCategory === cat.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 md:bg-transparent text-gray-600 hover:bg-gray-100'}`}>
                {cat.name}
              </button>
            ))}
          </div>

          {/* Grid สินค้า */}
          {/* เพิ่ม pb-24 ในมือถือ เพื่อไม่ให้ปุ่มตะกร้าบังสินค้าแถวล่างสุด */}
          <div className="flex-1 p-4 md:p-6 overflow-y-auto pb-24 md:pb-6">
            {filteredProducts.length === 0 ? (
              <p className="text-center text-gray-400 mt-10 text-sm">ไม่พบสินค้าในหมวดหมู่นี้</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
                {filteredProducts.map((product) => (
                  <div key={product.id} onClick={() => addToCart(product)} className="bg-white p-3 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-gray-100 cursor-pointer hover:shadow-md hover:border-blue-300 transition active:scale-95 flex flex-col items-center">
                    <div className="w-full aspect-square bg-gray-50 rounded-lg md:rounded-xl mb-3 flex items-center justify-center text-gray-400 overflow-hidden">
                      {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <PackagePlus size={32} className="opacity-20" />}
                    </div>
                    <h3 className="font-semibold text-center text-gray-700 line-clamp-2 text-xs md:text-sm">{product.name}</h3>
                    <p className="text-blue-600 font-bold mt-1 text-sm md:text-base">฿{Number(product.price).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ⭐️ ปุ่มตะกร้าลอย (แสดงเฉพาะจอมือถือ) */}
      <button
        onClick={() => setIsCartOpen(true)}
        className="md:hidden fixed bottom-20 right-4 bg-blue-600 text-white w-14 h-14 rounded-full shadow-2xl flex items-center justify-center z-40 hover:bg-blue-700 transition transform active:scale-90"
      >
        <ShoppingCart size={24} />
        {cart.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-6 h-6 flex items-center justify-center rounded-full border-2 border-white shadow-sm">
            {cart.reduce((a, c) => a + c.quantity, 0)}
          </span>
        )}
      </button>

      {/* ================= ฝั่งขวา: ตะกร้าสินค้า (รองรับมือถือแบบ Popup) ================= */}
      <div className={`
        ${isCartOpen ? 'fixed inset-0 z-[60] flex animate-fade-in' : 'hidden'}
        md:flex md:relative md:w-1/3 flex-col bg-white md:border-l border-gray-200 shadow-2xl md:shadow-xl md:z-20
      `}>
        <div className="p-4 md:p-6 bg-blue-600 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 md:gap-3">
            <ShoppingCart size={20} className="md:w-6 md:h-6" />
            <h2 className="text-lg md:text-2xl font-bold">ตะกร้าสินค้า</h2>
          </div>
          {/* ปุ่มปิดตะกร้า (เฉพาะมือถือ) */}
          <button onClick={() => setIsCartOpen(false)} className="md:hidden p-2 bg-blue-700 rounded-lg text-white hover:bg-blue-800"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2 md:space-y-3 bg-gray-50">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <ShoppingCart size={48} className="mb-4 opacity-30" />
              <p className="text-sm md:text-base">ยังไม่มีสินค้าในตะกร้า</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-3 rounded-xl shadow-sm border border-gray-100 gap-2">
                <div className="flex-1 w-full">
                  <p className="font-bold text-gray-800 line-clamp-1 text-xs md:text-sm">{item.name}</p>
                  <p className="font-semibold text-blue-600 text-xs md:text-sm">฿{Number(item.price).toFixed(2)}</p>
                </div>
                <div className="flex items-center justify-between w-full sm:w-auto">
                  <div className="flex items-center gap-1 md:gap-2 bg-gray-100 rounded-lg p-1">
                    <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:bg-white rounded text-gray-600 hover:text-red-500 transition shadow-sm bg-white sm:bg-transparent"><Minus size={14} /></button>
                    <span className="w-6 md:w-8 text-center font-bold text-gray-800 text-sm">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:bg-white rounded text-gray-600 hover:text-green-500 transition shadow-sm bg-white sm:bg-transparent"><Plus size={14} /></button>
                  </div>
                  <div className="w-16 text-right ml-2">
                    <p className="font-bold text-gray-800 text-sm">฿{(Number(item.price) * item.quantity).toFixed(2)}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ⭐️ เติม pb-10 ตรงนี้ เพื่อดันปุ่ม 'ชำระเงิน' ให้ลอยขึ้นในจอมือถือ */}
        <div className="p-4 pb-24 md:p-6 bg-white border-t border-gray-200 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
          <div className="flex justify-between text-lg md:text-2xl font-bold mb-3 md:mb-6 text-gray-800">
            <span>ยอดรวม:</span>
            <span className="text-blue-600">฿{grandTotal.toFixed(2)}</span>
          </div>
          <div className="mb-4 md:mb-6">
            <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1 md:mb-2">รับเงินลูกค้า (บาท)</label>
            <input type="number" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value ? Number(e.target.value) : '')} className="w-full text-right text-xl md:text-3xl font-bold p-3 md:p-4 border border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 focus:outline-none transition" placeholder="0.00" />
          </div>
          <button onClick={handleCheckout} disabled={cart.length === 0 || loading} className={`w-full py-4 md:py-5 rounded-xl text-lg md:text-2xl font-bold text-white transition shadow-lg flex justify-center items-center gap-2 ${cart.length === 0 ? 'bg-gray-300 cursor-not-allowed shadow-none' : 'bg-green-500 hover:bg-green-600 active:scale-95'}`}>
            {loading ? 'กำลังประมวลผล...' : <><CheckCircle size={24} /> ชำระเงิน</>}
          </button>
        </div>
      </div>

      {/* ================= MODAL ปิดกะ (ปรับให้พอดีมือถือ) ================= */}
      {showCloseModal && (
        // ⭐️ ใช้ z-[70] เพื่อทับเมนูสนิท
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all">
            {!shiftSummary ? (
              // ⭐️ เพิ่ม pb-12 ให้ปุ่มโดนดันขึ้นมา
              <div className="p-6 pb-12 md:p-8">
                <div className="flex justify-between items-center mb-4 md:mb-6">
                  <h2 className="text-lg md:text-2xl font-bold text-gray-800 flex items-center gap-2"><Lock className="text-red-500" /> ปิดกะการขาย</h2>
                  <button onClick={() => setShowCloseModal(false)} className="text-gray-400 hover:text-gray-600 p-1 bg-gray-100 rounded-lg"><X size={20} /></button>
                </div>
                <p className="text-gray-600 text-sm md:text-base mb-6">กรุณานับเงินสดทั้งหมดในลิ้นชักและกรอกยอดที่นับได้จริง</p>
                <form onSubmit={handleCloseShift}>
                  <div className="mb-6">
                    <label className="block text-sm font-bold text-gray-700 mb-2">เงินสดที่นับได้จริง (บาท)</label>
                    <input type="number" required min="0" value={actualCash} onChange={(e) => setActualCash(e.target.value ? Number(e.target.value) : '')} className="w-full text-center text-2xl md:text-3xl font-bold p-4 border border-gray-300 rounded-xl focus:ring-4 focus:ring-red-100 focus:border-red-500 focus:outline-none transition" placeholder="0.00" />
                  </div>
                  <button type="submit" disabled={closeLoading} className="w-full bg-red-500 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-600 transition active:scale-95 disabled:bg-gray-300">
                    {closeLoading ? 'กำลังตรวจสอบ...' : 'ยืนยันการปิดกะ'}
                  </button>
                </form>
              </div>
            ) : (
              <div className="p-6 md:p-8 text-center">
                <div className="w-16 h-16 md:w-20 md:h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 md:mb-6">
                  <CheckCircle className="text-green-500 w-8 h-8 md:w-10 md:h-10" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-2">สรุปยอดการขาย</h2>
                <p className="text-gray-500 text-sm mb-6">ปิดกะสำเร็จ บันทึกข้อมูลเรียบร้อยแล้ว</p>
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 md:space-y-3 text-left mb-6 md:mb-8 border border-gray-100 text-sm md:text-base">
                  <div className="flex justify-between"><span className="text-gray-600">เงินทอนตั้งต้น:</span><span className="font-semibold">฿{Number(shiftSummary.opening_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">ยอดขายเงินสด:</span><span className="font-semibold">฿{Number(shiftSummary.cash_sales).toFixed(2)}</span></div>
                  <div className="flex justify-between border-t pt-2 md:pt-3"><span className="text-gray-800 font-bold">เงินที่ควรมี:</span><span className="font-bold text-blue-600">฿{Number(shiftSummary.expected_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-800 font-bold">นับได้จริง:</span><span className="font-bold">฿{Number(shiftSummary.actual_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-gray-600 font-bold">ส่วนต่าง:</span>
                    <span className={`font-bold ${Number(shiftSummary.difference) < 0 ? 'text-red-500' : Number(shiftSummary.difference) > 0 ? 'text-green-500' : 'text-gray-500'}`}>
                      {Number(shiftSummary.difference) > 0 ? '+' : ''}{Number(shiftSummary.difference).toFixed(2)}
                    </span>
                  </div>
                </div>
                <button onClick={finishAndLogout} className="w-full bg-gray-800 text-white py-4 rounded-xl font-bold text-lg hover:bg-gray-900 transition active:scale-95">ออกจากระบบ</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ซ่อน Scrollbar ของหมวดหมู่แนวนอน */}
      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; } .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
    </div>
  );
}