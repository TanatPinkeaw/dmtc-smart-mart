import { useState, useEffect } from 'react';
import { ShoppingCart, User, Plus, Minus, Lock, X, CheckCircle, PackagePlus, UserPlus, Printer, Gift, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Swal from '../swal';
import generatePayload from 'promptpay-qr';
import QRCode from 'react-qr-code';

// ⭐️ ใช้ socket กลางของแอปแทนการสร้าง connection เอง
import { useSocket } from '../SocketContext';

interface Category { id: number; name: string; }

interface Category { id: number; name: string; }
interface Product { id: number; barcode: string; name: string; price: string | number; image_url: string; category_id: number | null; }
interface CartItem extends Product { quantity: number; }

export default function POS() {
  const socket = useSocket();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | 'ALL'>('ALL');
  const [productSearchQuery, setProductSearchQuery] = useState(''); // ⭐️ ค้นหาสินค้า (ชื่อ/บาร์โค้ด)
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [amountReceived, setAmountReceived] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);

  // ⭐️ เพิ่ม 2 บรรทัดนี้
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'QR'>('CASH');
  const PROMPTPAY_ID = "0803610120"; // 👈 เปลี่ยนเป็นเบอร์พร้อมเพย์ของร้าน หรือเบอร์นายได้เลย

  // ⭐️ State ควบคุมตะกร้าสินค้าในมือถือ
  const [isCartOpen, setIsCartOpen] = useState(false);

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [actualCash, setActualCash] = useState<number | ''>('');
  const [closeLoading, setCloseLoading] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<any>(null);

  // ⭐️ เพิ่ม State สำหรับค้นหาสมาชิก
  const [searchMemberQuery, setSearchMemberQuery] = useState('');
  const [currentMember, setCurrentMember] = useState<any>(null);
  const [memberLoading, setMemberLoading] = useState(false);

  // ⭐️ State สำหรับสมัครสมาชิกใหม่
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [regForm, setRegForm] = useState({ student_id: '', full_name: '', phone_number: '' });
  const [regLoading, setRegLoading] = useState(false);

  // ⭐️ State สำหรับโปรโมชั่น
  const [promotions, setPromotions] = useState<any[]>([]);
  const [selectedPromoId, setSelectedPromoId] = useState<number | ''>('');
  const [appliedPromo, setAppliedPromo] = useState<{ id: number; name: string; discount_amount: number } | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);

  // ⭐️ State สำหรับแลกแต้มเป็นส่วนลด (1 แต้ม = ฿1)
  const [redeemPoints, setRedeemPoints] = useState<number | ''>('');

  // ⭐️ State สำหรับ Popup ใบเสร็จ + ข้อมูลร้าน
  const [receiptData, setReceiptData] = useState<any>(null);
  const [storeInfo, setStoreInfo] = useState<any>(null);

  // ⭐️ ฟังก์ชันกดยืนยันสมัครสมาชิก
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegLoading(true);
    try {
      const res = await api.post('/users/register', regForm);
      Swal.fire({ icon: 'success', title: 'สมัครสมาชิกสำเร็จ!', text: 'ดึงข้อมูลเข้าบิลให้อัตโนมัติ' });

      // ปิดหน้าต่าง และดึงข้อมูลลูกค้าใหม่เข้าบิลทันที!
      setShowRegisterModal(false);
      setCurrentMember(res.data.user);
      setRegForm({ student_id: '', full_name: '', phone_number: '' });
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error });
    } finally {
      setRegLoading(false);
    }
  };

  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { navigate('/login'); return; }
    if (localStorage.getItem('session_mode') === 'shop') { navigate('/pre-order'); return; } // ⭐️ โหมดซื้อของ ห้ามเข้าหน้าขาย
    fetchCategories(); fetchProducts(); fetchPromotions(); fetchStoreInfo();
  }, [navigate]);

  const fetchStoreInfo = async () => {
    try { const res = await api.get('/settings/store'); setStoreInfo(res.data); } catch (e) { console.error(e); }
  };

  const fetchPromotions = async () => {
    try { const res = await api.get('/promotions'); setPromotions(res.data); } catch (e) { console.error(e); }
  };

  // ==========================================
  // ⭐️ 3. เพิ่มระบบหูฟัง WebSocket ตรงนี้!
  // ==========================================
  useEffect(() => {
    if (!socket) return;

    // เมื่อเชื่อมต่อสำเร็จ
    socket.on('connect', () => {
      console.log('🟢 เชื่อมต่อ WebSocket สำเร็จ! เครื่องนี้ ID:', socket.id);
    });

    // เมื่อมีคนจ่ายเงินสำเร็จ Backend จะส่งสัญญาณ 'stock_updated' มา
    socket.on('stock_updated', (data) => {
      console.log('⚡', data.message);

      // สั่งให้ดึงข้อมูลสินค้า (ที่มีสต๊อกล่าสุด) มาใหม่แบบเนียนๆ
      fetchProducts();

      // แจ้งเตือนแคชเชียร์เล็กๆ ที่มุมขวาบนแบบไม่บังหน้าจอ (Toast)
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'info',
        title: 'มีการซื้อสินค้า สต๊อกอัปเดตแล้ว!',
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true
      });
    });

    // คืนค่าและปิดการเชื่อมต่อเมื่อปิดหน้าเว็บ
    return () => {
      socket.off('connect');
      socket.off('stock_updated');
    };
  }, [socket]);
  // ==========================================

  const fetchCategories = async () => { try { const res = await api.get('/categories'); setCategories(res.data); } catch (e) { console.error(e); } };
  const fetchProducts = async () => { try { const res = await api.get('/products'); setProducts(res.data); } catch (e) { console.error(e); } };

  const filteredProducts = (selectedCategory === 'ALL' ? products : products.filter(p => p.category_id === selectedCategory))
    .filter(p => p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(productSearchQuery)));

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
  const netTotal = Math.max(0, grandTotal - (appliedPromo?.discount_amount || 0));

  // ⭐️ ส่วนลดจากแต้ม (1 แต้ม = ฿1) ห้ามเกินแต้มที่มี และห้ามเกินยอดที่ต้องจ่าย
  const maxRedeemable = currentMember ? Math.min(currentMember.points, Math.floor(netTotal)) : 0;
  const pointsDiscount = currentMember && redeemPoints ? Math.min(Number(redeemPoints), maxRedeemable) : 0;
  const finalTotal = Math.max(0, netTotal - pointsDiscount);

  // ⭐️ ยกเลิกโปรโมชั่น/แต้มอัตโนมัติถ้าตะกร้าว่าง หรือยอดเปลี่ยนหลังใช้โปรแล้ว (ต้องกดใช้ใหม่)
  useEffect(() => {
    if (cart.length === 0 && appliedPromo) setAppliedPromo(null);
    if (cart.length === 0 && redeemPoints) setRedeemPoints('');
  }, [cart.length]);

  // ⭐️ ล้างแต้มที่แลกไว้ถ้าเปลี่ยน/เอาสมาชิกออก
  useEffect(() => {
    if (!currentMember && redeemPoints) setRedeemPoints('');
  }, [currentMember]);

  const handleApplyPromo = async () => {
    if (!selectedPromoId) return;
    if (cart.length === 0) return Swal.fire({ icon: 'warning', title: 'ตะกร้าว่างเปล่า!' });
    setPromoLoading(true);
    try {
      const res = await api.post('/promotions/verify', {
        promotion_id: selectedPromoId,
        grand_total: grandTotal,
        items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })),
        member_id: currentMember ? currentMember.id : null
      });
      setAppliedPromo({ id: Number(selectedPromoId), name: res.data.promo_name, discount_amount: Number(res.data.discount_amount) });
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `ใช้โปรโมชั่น "${res.data.promo_name}" แล้ว`, showConfirmButton: false, timer: 1500 });
    } catch (error: any) {
      setAppliedPromo(null);
      Swal.fire({ icon: 'error', title: 'ใช้โปรโมชั่นไม่ได้', text: error.response?.data?.error || 'โปรโมชั่นไม่ถูกต้อง' });
    } finally {
      setPromoLoading(false);
    }
  };

  const handleRemovePromo = () => { setAppliedPromo(null); setSelectedPromoId(''); };

  // ⭐️ 1. ฟังก์ชันค้นหาลูกค้า
  const handleSearchMember = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchMemberQuery.trim()) return;

    setMemberLoading(true);
    try {
      const res = await api.get(`/users/search?q=${searchMemberQuery}`);
      setCurrentMember(res.data);
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `พบสมาชิก: ${res.data.full_name}`, showConfirmButton: false, timer: 1500 });
    } catch (error) {
      setCurrentMember(null);
      Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'ไม่พบข้อมูลสมาชิก', showConfirmButton: false, timer: 1500 });
    } finally {
      setMemberLoading(false);
    }
  };

  // ⭐️ 2. อัปเดตการจ่ายเงิน (ส่ง member_id, redeem_points ไปด้วย)
  const handleCheckout = async () => {
    if (cart.length === 0) return Swal.fire({ icon: 'warning', title: 'ตะกร้าว่างเปล่า!' });
    if (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal)) return Swal.fire({ icon: 'error', title: 'รับเงินมาไม่พอ!' });

    setLoading(true);
    try {
      const payload = {
        cashier_id: user.id,
        member_id: currentMember ? currentMember.id : null, // 👈 ส่ง ID ลูกค้าไปเก็บแต้ม
        promotion_id: appliedPromo ? appliedPromo.id : null, // 👈 ส่งโปรโมชั่นที่ใช้ไปด้วย
        redeem_points: pointsDiscount > 0 ? pointsDiscount : 0, // 👈 แต้มที่จะแลกเป็นส่วนลด
        payment_method: paymentMethod,
        amount_received: paymentMethod === 'CASH' ? Number(amountReceived) : finalTotal,
        items: cart.map(item => ({ product_id: item.id, quantity: item.quantity }))
      };

      const response = await api.post('/sales/checkout', payload);
      const receipt = response.data.receipt;

      // ⭐️ เตรียมข้อมูลใบเสร็จไว้โชว์ในหน้าต่าง Popup (ต้องเก็บ snapshot ตะกร้าไว้ก่อนเคลียร์)
      setReceiptData({
        ...receipt,
        items: cart.map(item => ({ name: item.name, price: Number(item.price), quantity: item.quantity })),
        cashier_name: user.full_name,
        member_name: currentMember ? currentMember.full_name : null,
        promo_name: appliedPromo ? appliedPromo.name : null,
        created_at: new Date()
      });

      // เคลียร์ตะกร้าและข้อมูลลูกค้าเตรียมรับคิวต่อไป
      setCart([]);
      setAmountReceived('');
      setCurrentMember(null);
      setSearchMemberQuery('');
      setAppliedPromo(null);
      setSelectedPromoId('');
      setRedeemPoints('');
      setIsCartOpen(false);
      // fetchProducts(); <- ไม่ต้องเรียกแล้ว เพราะ WebSocket จัดการให้แล้ว!
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error });
    } finally {
      setLoading(false);
    }
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
    <div className="flex h-full bg-pink-50 font-sans relative">

      {/* ================= ฝั่งซ้าย: สินค้าและหมวดหมู่ ================= */}
      <div className="w-full md:w-2/3 flex flex-col h-full">
        {/* Header */}
        <div className="bg-white p-3 md:p-4 shadow-sm flex justify-between items-center z-10 shrink-0">
          <h1 className="text-lg md:text-2xl font-bold text-gray-800">ระบบ POS</h1>
          <div className="flex items-center gap-2 md:gap-4">
            <div className="hidden sm:flex items-center gap-2 text-gray-600 bg-pink-100 px-3 py-1.5 rounded-full text-sm">
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
          <div className="md:w-1/4 bg-white md:border-r border-b md:border-b-0 border-pink-100 p-3 md:p-4 overflow-x-auto md:overflow-y-auto shrink-0 scrollbar-hide flex flex-row md:flex-col gap-2">
            <h2 className="hidden md:block text-lg font-bold text-gray-700 mb-2 px-2">หมวดหมู่</h2>
            <button onClick={() => setSelectedCategory('ALL')} className={`shrink-0 md:w-full text-center md:text-left px-4 py-2 md:py-3 rounded-full md:rounded-xl font-medium text-sm md:text-base transition ${selectedCategory === 'ALL' ? 'bg-pink-100 text-pink-700' : 'bg-pink-50 md:bg-transparent text-gray-600 hover:bg-pink-100'}`}>
              ทั้งหมด
            </button>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`shrink-0 md:w-full text-center md:text-left px-4 py-2 md:py-3 rounded-full md:rounded-xl font-medium text-sm md:text-base transition ${selectedCategory === cat.id ? 'bg-pink-100 text-pink-700' : 'bg-pink-50 md:bg-transparent text-gray-600 hover:bg-pink-100'}`}>
                {cat.name}
              </button>
            ))}
          </div>

          {/* Grid สินค้า */}
          {/* เพิ่ม pb-24 ในมือถือ เพื่อไม่ให้ปุ่มตะกร้าบังสินค้าแถวล่างสุด */}
          <div className="flex-1 p-4 md:p-6 overflow-y-auto pb-24 md:pb-6">
            {/* ⭐️ ช่องค้นหาสินค้า (ชื่อ/บาร์โค้ด) — กรองฝั่ง client จาก products ที่โหลดมาแล้ว */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text" placeholder="ค้นหาสินค้า / บาร์โค้ด..."
                value={productSearchQuery} onChange={(e) => setProductSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-sm md:text-base bg-pink-100 border-none rounded-xl focus:ring-2 focus:ring-pink-500 focus:bg-white transition"
              />
            </div>
            {filteredProducts.length === 0 ? (
              <p className="text-center text-gray-400 mt-10 text-sm">ไม่พบสินค้าในหมวดหมู่นี้</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
                {filteredProducts.map((product) => (
                  <div key={product.id} onClick={() => addToCart(product)} className="bg-white p-3 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-pink-100 cursor-pointer hover:shadow-md hover:border-pink-300 transition active:scale-95 flex flex-col items-center">
                    <div className="w-full aspect-square bg-pink-50 rounded-lg md:rounded-xl mb-3 flex items-center justify-center text-gray-400 overflow-hidden">
                      {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <PackagePlus size={32} className="opacity-20" />}
                    </div>
                    <h3 className="font-semibold text-center text-gray-700 line-clamp-2 text-xs md:text-sm">{product.name}</h3>
                    <p className="text-pink-600 font-bold mt-1 text-sm md:text-base">฿{Number(product.price).toFixed(2)}</p>
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
        className="md:hidden fixed bottom-20 right-4 bg-pink-600 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-40 hover:bg-pink-700 transition transform active:scale-90"
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
        md:flex md:relative md:w-1/3 flex-col bg-white md:border-l border-pink-100 shadow-lg md:z-20
      `}>
        <div className="p-4 md:p-6 bg-pink-600 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 md:gap-3">
            <ShoppingCart size={20} className="md:w-6 md:h-6" />
            <h2 className="text-lg md:text-2xl font-bold">ตะกร้าสินค้า</h2>
          </div>
          {/* ปุ่มปิดตะกร้า (เฉพาะมือถือ) */}
          <button onClick={() => setIsCartOpen(false)} className="md:hidden p-2 bg-pink-700 rounded-lg text-white hover:bg-pink-800"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2 md:space-y-3 bg-pink-50">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <ShoppingCart size={48} className="mb-4 opacity-30" />
              <p className="text-sm md:text-base">ยังไม่มีสินค้าในตะกร้า</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-3 rounded-xl shadow-sm border border-pink-100 gap-2">
                <div className="flex-1 w-full">
                  <p className="font-bold text-gray-800 line-clamp-1 text-xs md:text-sm">{item.name}</p>
                  <p className="font-semibold text-pink-600 text-xs md:text-sm">฿{Number(item.price).toFixed(2)}</p>
                </div>
                <div className="flex items-center justify-between w-full sm:w-auto">
                  <div className="flex items-center gap-1 md:gap-2 bg-pink-100 rounded-lg p-1">
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

        {/* ================= โซนชำระเงิน ================= */}
        <div className="p-4 pb-24 md:p-6 bg-white border-t border-pink-100 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">

          {/* ⭐️ กล่องค้นหาสมาชิก */}
          <div className="mb-4 bg-pink-50 p-3 rounded-xl border border-pink-100">
            {!currentMember ? (
              <form onSubmit={handleSearchMember} className="flex gap-2">
                <input
                  type="text"
                  placeholder="เบอร์โทร หรือ รหัสนักศึกษา..."
                  value={searchMemberQuery}
                  onChange={(e) => setSearchMemberQuery(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-pink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
                <button
                  type="submit"
                  disabled={memberLoading}
                  className="bg-pink-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-pink-700 transition disabled:bg-gray-400"
                >
                  {memberLoading ? '...' : 'ค้นหา'}
                </button>

                {/* ⭐️ ปุ่มสมัครสมาชิกใหม่ */}
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(true)}
                  className="bg-green-500 text-white px-3 py-2 rounded-lg hover:bg-green-600 transition flex items-center justify-center shadow-sm"
                >
                  <UserPlus size={20} />
                </button>
              </form>
            ) : (
              <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-pink-200">
                <div>
                  <p className="text-xs text-gray-500">สมาชิก: {currentMember.student_id}</p>
                  <p className="text-sm font-bold text-gray-800 line-clamp-1">{currentMember.full_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">แต้มสะสม</p>
                  <p className="text-sm font-bold text-green-600">{currentMember.points} 🌟</p>
                </div>
                <button
                  onClick={() => { setCurrentMember(null); setSearchMemberQuery(''); }}
                  className="ml-2 text-red-500 hover:bg-red-50 p-1 rounded-md transition"
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>

          {/* ⭐️ เลือก/ใช้โปรโมชั่น */}
          <div className="mb-4">
            {!appliedPromo ? (
              <div className="flex gap-2">
                <select
                  value={selectedPromoId}
                  onChange={(e) => setSelectedPromoId(e.target.value ? Number(e.target.value) : '')}
                  className="flex-1 p-2.5 text-sm border border-pink-200 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none bg-white"
                >
                  <option value="">-- เลือกโปรโมชั่น (ถ้ามี) --</option>
                  {promotions.map((promo: any) => (
                    <option key={promo.id} value={promo.id}>
                      {promo.name} ({promo.discount_type === 'PERCENT' ? `ลด ${promo.discount_value}%` : `ลด ฿${promo.discount_value}`})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleApplyPromo}
                  disabled={!selectedPromoId || promoLoading}
                  className="bg-pink-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-pink-700 transition disabled:bg-gray-300"
                >
                  {promoLoading ? '...' : 'ใช้โค้ด'}
                </button>
              </div>
            ) : (
              <div className="flex justify-between items-center bg-green-50 p-2.5 rounded-lg border border-green-200">
                <p className="text-sm font-bold text-green-700">🏷️ {appliedPromo.name} (-฿{appliedPromo.discount_amount.toFixed(2)})</p>
                <button onClick={handleRemovePromo} className="text-red-500 hover:bg-red-50 p-1 rounded-md transition"><X size={16} /></button>
              </div>
            )}
          </div>

          {/* ⭐️ แลกแต้มเป็นส่วนลด (1 แต้ม = ฿1) */}
          {currentMember && currentMember.points > 0 && (
            <div className="mb-4 flex items-center gap-2 bg-yellow-50 p-2.5 rounded-lg border border-yellow-200">
              <Gift size={18} className="text-yellow-600 shrink-0" />
              <span className="text-xs md:text-sm text-yellow-700 font-medium shrink-0">แลกแต้ม (มี {currentMember.points} 🌟):</span>
              <input
                type="number"
                min={0}
                max={maxRedeemable}
                value={redeemPoints}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : '';
                  setRedeemPoints(v === '' ? '' : Math.max(0, Math.min(Number(v), maxRedeemable)));
                }}
                placeholder="0"
                className="flex-1 min-w-0 p-1.5 text-right text-sm font-bold border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none"
              />
              <button
                type="button"
                onClick={() => setRedeemPoints(maxRedeemable)}
                className="text-xs font-bold text-yellow-700 bg-yellow-100 hover:bg-yellow-200 px-2 py-1.5 rounded-lg transition shrink-0"
              >
                ใช้สูงสุด
              </button>
            </div>
          )}

          <div className="mb-3 md:mb-4">
            <div className="flex justify-between text-sm md:text-base text-gray-500">
              <span>ยอดรวม:</span>
              <span>฿{grandTotal.toFixed(2)}</span>
            </div>
            {appliedPromo && (
              <div className="flex justify-between text-sm md:text-base text-green-600 font-bold">
                <span>ส่วนลดโปรโมชั่น:</span>
                <span>-฿{appliedPromo.discount_amount.toFixed(2)}</span>
              </div>
            )}
            {pointsDiscount > 0 && (
              <div className="flex justify-between text-sm md:text-base text-yellow-600 font-bold">
                <span>แลกแต้ม ({pointsDiscount} 🌟):</span>
                <span>-฿{pointsDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg md:text-2xl font-bold text-gray-800">
              <span>ยอดสุทธิ:</span>
              <span className="text-pink-600">฿{finalTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* ⭐️ ปุ่มเลือกวิธีชำระเงิน */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => { setPaymentMethod('CASH'); setAmountReceived(''); }}
              className={`flex-1 py-2 rounded-lg font-bold text-sm md:text-base border-2 transition ${paymentMethod === 'CASH' ? 'border-pink-600 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-400 hover:border-pink-300'}`}
            >
              💵 เงินสด
            </button>
            <button
              onClick={() => { setPaymentMethod('QR'); setAmountReceived(finalTotal); }}
              className={`flex-1 py-2 rounded-lg font-bold text-sm md:text-base border-2 transition ${paymentMethod === 'QR' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400 hover:border-blue-300'}`}
            >
              📱 สแกนจ่าย
            </button>
          </div>

          {/* ⭐️ แสดงช่องรับเงินสด หรือ รูป QR Code ตามที่เลือก */}
          {paymentMethod === 'CASH' ? (
            <div className="mb-4 md:mb-6">
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1 md:mb-2">รับเงินลูกค้า (บาท)</label>
              <input
                type="number" inputMode="none"
                value={amountReceived}
                onChange={(e) => setAmountReceived(e.target.value ? Number(e.target.value) : '')}
                className="w-full text-right text-xl md:text-3xl font-bold p-3 md:p-4 border border-pink-200 rounded-xl focus:ring-4 focus:ring-pink-100 focus:border-pink-500 focus:outline-none transition"
                placeholder="0.00"
                readOnly
              />

              {/* ⭐️ Quick preset buttons */}
              <div className="flex gap-2 mt-2 flex-wrap">
                {[20, 50, 100, 500, 1000].map(v => (
                  <button key={v} type="button" onClick={() => setAmountReceived(v)}
                    className="flex-1 min-w-[48px] bg-pink-50 text-pink-700 font-bold py-1.5 rounded-lg text-sm hover:bg-pink-100 transition">
                    ฿{v}
                  </button>
                ))}
                <button type="button" onClick={() => setAmountReceived(Math.ceil(finalTotal / 10) * 10)}
                  className="flex-1 min-w-[48px] bg-green-50 text-green-700 font-bold py-1.5 rounded-lg text-sm hover:bg-green-100 transition">
                  เต็ม
                </button>
              </div>

              {/* ⭐️ Numpad — โชว์เฉพาะมือถือ/แท็บเล็ต (md:hidden) */}
              <div className="md:hidden mt-3 grid grid-cols-3 gap-2">
                {['1','2','3','4','5','6','7','8','9','00','0','⌫'].map(k => (
                  <button key={k} type="button"
                    onClick={() => {
                      if (k === '⌫') {
                        setAmountReceived(prev => {
                          const s = String(prev === '' ? '' : prev).slice(0, -1);
                          return s === '' ? '' : Number(s);
                        });
                      } else {
                        setAmountReceived(prev => {
                          const s = (prev === '' ? '' : String(prev)) + k;
                          return Number(s);
                        });
                      }
                    }}
                    className={`py-4 rounded-xl text-xl font-bold transition active:scale-95 ${k === '⌫' ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-gray-100 text-gray-800 hover:bg-pink-50 hover:text-pink-700'}`}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mb-4 md:mb-6 flex flex-col items-center justify-center p-4 bg-blue-50 rounded-xl border border-blue-200">
              <p className="text-sm font-bold text-blue-800 mb-2">สแกนเพื่อชำระเงิน (PromptPay)</p>
              <div className="bg-white p-2 rounded-lg shadow-sm">
                <QRCode value={generatePayload(PROMPTPAY_ID, { amount: finalTotal })} size={150} />
              </div>
              <p className="text-xs text-blue-600 mt-2 text-center">รบกวนลูกค้าโชว์สลิปหลังโอนสำเร็จ</p>
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || loading || (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal))}
            className={`w-full py-4 md:py-5 rounded-xl text-lg md:text-2xl font-bold text-white transition shadow-lg flex justify-center items-center gap-2 ${cart.length === 0 || (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal)) ? 'bg-gray-300 cursor-not-allowed shadow-none' : paymentMethod === 'QR' ? 'bg-blue-600 hover:bg-blue-700 active:scale-95' : 'bg-pink-600 hover:bg-pink-700 active:scale-95'}`}
          >
            {loading ? 'กำลังประมวลผล...' : <><CheckCircle size={24} /> {paymentMethod === 'QR' ? 'ยืนยันตรวจสอบสลิปแล้ว' : 'ชำระเงิน'}</>}
          </button>
        </div>
      </div>

      {/* ================= MODAL ปิดกะ (ปรับให้พอดีมือถือ) ================= */}
      {showCloseModal && (
        // ⭐️ ใช้ z-[70] เพื่อทับเมนูสนิท
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-end md:items-center justify-center sm:p-4 animate-fade-in">
          <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-lg w-full max-w-md overflow-hidden transform transition-all">
            {!shiftSummary ? (
              <>
                <div className="px-5 py-4 border-b border-pink-100 flex justify-between items-center bg-pink-50 rounded-t-2xl md:rounded-t-none shrink-0">
                  <h2 className="text-base md:text-lg font-bold text-gray-800 flex items-center gap-2"><Lock size={18} className="text-red-500" /> ปิดกะการขาย</h2>
                  <button onClick={() => setShowCloseModal(false)} className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition"><X size={20} /></button>
                </div>
                <div className="p-6 pb-12 md:p-8">
                  <p className="text-gray-600 text-sm md:text-base mb-6">กรุณานับเงินสดทั้งหมดในลิ้นชักและกรอกยอดที่นับได้จริง</p>
                  <form onSubmit={handleCloseShift}>
                    <div className="mb-6">
                      <label className="block text-sm font-bold text-gray-700 mb-2">เงินสดที่นับได้จริง (บาท)</label>
                      <input type="number" required min="0" value={actualCash} onChange={(e) => setActualCash(e.target.value ? Number(e.target.value) : '')} className="w-full text-center text-2xl md:text-3xl font-bold p-4 border border-pink-200 rounded-xl focus:ring-4 focus:ring-red-100 focus:border-red-500 focus:outline-none transition" placeholder="0.00" />
                    </div>
                    <button type="submit" disabled={closeLoading} className="w-full bg-red-500 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-600 transition active:scale-95 disabled:bg-gray-300">
                      {closeLoading ? 'กำลังตรวจสอบ...' : 'ยืนยันการปิดกะ'}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="p-6 pb-12 md:p-8 text-center">
                <div className="w-16 h-16 md:w-20 md:h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 md:mb-6">
                  <CheckCircle className="text-green-500 w-8 h-8 md:w-10 md:h-10" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-2">สรุปยอดการขาย</h2>
                <p className="text-gray-500 text-sm mb-6">ปิดกะสำเร็จ บันทึกข้อมูลเรียบร้อยแล้ว</p>
                <div className="bg-pink-50 rounded-xl p-4 space-y-2 md:space-y-3 text-left mb-6 md:mb-8 border border-pink-100 text-sm md:text-base">
                  <div className="flex justify-between"><span className="text-gray-600">เงินทอนตั้งต้น:</span><span className="font-semibold">฿{Number(shiftSummary.opening_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">ยอดขายเงินสด:</span><span className="font-semibold">฿{Number(shiftSummary.cash_sales).toFixed(2)}</span></div>
                  <div className="flex justify-between border-t pt-2 md:pt-3"><span className="text-gray-800 font-bold">เงินที่ควรมี:</span><span className="font-bold text-pink-600">฿{Number(shiftSummary.expected_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-800 font-bold">นับได้จริง:</span><span className="font-bold">฿{Number(shiftSummary.actual_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-gray-600 font-bold">ส่วนต่าง:</span>
                    <span className={`font-bold ${Number(shiftSummary.difference) < 0 ? 'text-red-500' : Number(shiftSummary.difference) > 0 ? 'text-green-500' : 'text-gray-500'}`}>
                      {Number(shiftSummary.difference) > 0 ? '+' : ''}{Number(shiftSummary.difference).toFixed(2)}
                    </span>
                  </div>
                </div>
                <button onClick={finishAndLogout} className="w-full bg-pink-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-pink-700 transition active:scale-95">ออกจากระบบ</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ซ่อน Scrollbar ของหมวดหมู่แนวนอน */}
      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; } .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }`}</style>

      {/* ================= MODAL สมัครสมาชิกใหม่ ================= */}
      {showRegisterModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-lg w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-green-50">
              <h2 className="text-lg font-bold text-green-800 flex items-center gap-2">
                <UserPlus size={20} /> สมัครสมาชิกใหม่
              </h2>
              <button onClick={() => setShowRegisterModal(false)} className="text-gray-400 hover:text-red-500 transition"><X size={20} /></button>
            </div>
            <form onSubmit={handleRegister} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">รหัสนักศึกษา</label>
                  <input type="text" required value={regForm.student_id} onChange={(e) => setRegForm({ ...regForm, student_id: e.target.value })} className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none" placeholder="เช่น 66209010001" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">ชื่อ-นามสกุล</label>
                  <input type="text" required value={regForm.full_name} onChange={(e) => setRegForm({ ...regForm, full_name: e.target.value })} className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none" placeholder="นาย/นางสาว..." />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">เบอร์โทรศัพท์</label>
                  <input type="tel" required value={regForm.phone_number} onChange={(e) => setRegForm({ ...regForm, phone_number: e.target.value })} className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none" placeholder="08X-XXX-XXXX" />
                </div>
              </div>
              <button type="submit" disabled={regLoading} className="w-full mt-6 bg-green-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-green-600 transition disabled:bg-gray-300">
                {regLoading ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL ใบเสร็จ (โชว์หลัง Checkout สำเร็จ + พิมพ์ได้) ================= */}
      {receiptData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4 animate-fade-in print:bg-white print:p-0 print:backdrop-blur-none">
          <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm overflow-hidden print:shadow-none print:rounded-none print:max-w-full">

            {/* ปุ่มปิด/พิมพ์ (ซ่อนตอนพิมพ์จริง) */}
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-pink-50 print:hidden">
              <h2 className="text-lg font-bold text-pink-800 flex items-center gap-2">
                <CheckCircle size={20} /> ทำรายการสำเร็จ
              </h2>
              <button onClick={() => setReceiptData(null)} className="text-gray-400 hover:text-red-500 transition"><X size={20} /></button>
            </div>

            {/* ตัวใบเสร็จ (ใช้ id นี้ตอนพิมพ์) */}
            <div id="receipt-print-area" className="p-5 font-mono text-sm text-gray-800">
              <div className="text-center mb-3">
                <p className="font-bold text-base">{storeInfo?.store_name || 'สหกรณ์วิทยาลัย'}</p>
                {storeInfo?.address && <p className="text-xs text-gray-500">{storeInfo.address}</p>}
                {storeInfo?.tax_id && <p className="text-xs text-gray-500">เลขผู้เสียภาษี: {storeInfo.tax_id}</p>}
              </div>
              <div className="border-t border-dashed border-gray-400 my-2"></div>
              <div className="text-xs space-y-0.5">
                <div className="flex justify-between"><span>เลขที่บิล:</span><span>#{receiptData.sale_id}</span></div>
                <div className="flex justify-between"><span>วันที่:</span><span>{new Date(receiptData.created_at).toLocaleString('th-TH')}</span></div>
                <div className="flex justify-between"><span>แคชเชียร์:</span><span>{receiptData.cashier_name}</span></div>
                {receiptData.member_name && <div className="flex justify-between"><span>สมาชิก:</span><span>{receiptData.member_name}</span></div>}
              </div>
              <div className="border-t border-dashed border-gray-400 my-2"></div>
              <div className="space-y-1">
                {receiptData.items.map((item: any, idx: number) => (
                  <div key={idx} className="flex justify-between text-xs">
                    <span className="flex-1 pr-2">{item.name} x{item.quantity}</span>
                    <span>฿{(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-gray-400 my-2"></div>
              <div className="text-xs space-y-0.5">
                <div className="flex justify-between"><span>ยอดรวม:</span><span>฿{Number(receiptData.subtotal).toFixed(2)}</span></div>
                {receiptData.discount_amount > 0 && (
                  <div className="flex justify-between"><span>ส่วนลดโปรโมชั่น{receiptData.promo_name ? ` (${receiptData.promo_name})` : ''}:</span><span>-฿{Number(receiptData.discount_amount).toFixed(2)}</span></div>
                )}
                {receiptData.points_discount > 0 && (
                  <div className="flex justify-between"><span>แลกแต้ม ({receiptData.points_redeemed} 🌟):</span><span>-฿{Number(receiptData.points_discount).toFixed(2)}</span></div>
                )}
              </div>
              <div className="border-t border-dashed border-gray-400 my-2"></div>
              <div className="flex justify-between font-bold text-base">
                <span>ยอดสุทธิ:</span><span>฿{Number(receiptData.total_amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span>{receiptData.payment_method === 'CASH' ? 'รับเงินสด:' : 'ชำระผ่าน QR:'}</span><span>฿{Number(receiptData.amount_received).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>เงินทอน:</span><span>฿{Number(receiptData.change_amount).toFixed(2)}</span>
              </div>
              {receiptData.earned_points > 0 && (
                <>
                  <div className="border-t border-dashed border-gray-400 my-2"></div>
                  <p className="text-center text-xs font-bold">ได้รับแต้มสะสม +{receiptData.earned_points} 🌟</p>
                </>
              )}
              <div className="border-t border-dashed border-gray-400 my-2"></div>
              <p className="text-center text-xs text-gray-500 mt-2">{storeInfo?.receipt_footer || 'ขอบคุณที่อุดหนุนสหกรณ์ของเรา'}</p>
            </div>

            <div className="p-4 border-t border-gray-100 flex gap-2 print:hidden">
              <button
                onClick={() => window.print()}
                className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition active:scale-95 flex items-center justify-center gap-2"
              >
                <Printer size={18} /> พิมพ์ใบเสร็จ
              </button>
              <button
                onClick={() => setReceiptData(null)}
                className="flex-1 bg-pink-600 text-white py-3 rounded-xl font-bold hover:bg-pink-700 transition active:scale-95"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⭐️ CSS สำหรับพิมพ์ใบเสร็จเครื่องพิมพ์ความร้อน (Thermal Printer) — โชว์แค่ใบเสร็จตอนกด Print */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #receipt-print-area, #receipt-print-area * { visibility: visible; }
          #receipt-print-area {
            position: absolute; top: 0; left: 0;
            width: 80mm; /* ปรับเป็น 58mm ถ้าใช้กระดาษ 58mm */
            padding: 4mm;
          }
        }
      `}</style>

    </div>
  );
}