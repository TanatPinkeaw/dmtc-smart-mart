// ✅ CHANGED: colors, layout → DMTC Mart theme (#F12B6B primary)
// 🔒 UNCHANGED: all handlers (handleCheckout, handleSearchMember, handleRegister, handleApplyPromo, handleCloseShift, finishAndLogout), socket listeners, all state, filteredProducts, price calculations

import { useState, useEffect } from 'react';
import { ShoppingCart, User, Plus, Minus, Lock, X, CheckCircle, PackagePlus, UserPlus, Printer, Gift, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Swal from '../swal';
import generatePayload from 'promptpay-qr';
import QRCode from 'react-qr-code';
import { useSocket } from '../SocketContext';

interface Category { id: number; name: string; }
interface Product { id: number; barcode: string; name: string; price: string | number; image_url: string; category_id: number | null; }
interface CartItem extends Product { quantity: number; }

export default function POS() {
  const socket = useSocket();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | 'ALL'>('ALL');
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [amountReceived, setAmountReceived] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'QR'>('CASH');
  const PROMPTPAY_ID = "0803610120";
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [actualCash, setActualCash] = useState<number | ''>('');
  const [closeLoading, setCloseLoading] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<any>(null);
  const [searchMemberQuery, setSearchMemberQuery] = useState('');
  const [currentMember, setCurrentMember] = useState<any>(null);
  const [memberLoading, setMemberLoading] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [regForm, setRegForm] = useState({ student_id: '', full_name: '', phone_number: '' });
  const [regLoading, setRegLoading] = useState(false);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [selectedPromoId, setSelectedPromoId] = useState<number | ''>('');
  const [appliedPromo, setAppliedPromo] = useState<{ id: number; name: string; discount_amount: number } | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState<number | ''>('');
  const [receiptData, setReceiptData] = useState<any>(null);
  const [storeInfo, setStoreInfo] = useState<any>(null);

  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  // ── Handlers (unchanged) ──────────────────────────────────────────────────
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault(); setRegLoading(true);
    try {
      const res = await api.post('/users/register', regForm);
      Swal.fire({ icon: 'success', title: 'สมัครสมาชิกสำเร็จ!', text: 'ดึงข้อมูลเข้าบิลให้อัตโนมัติ' });
      setShowRegisterModal(false); setCurrentMember(res.data.user);
      setRegForm({ student_id: '', full_name: '', phone_number: '' });
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error }); }
    finally { setRegLoading(false); }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { navigate('/login'); return; }
    if (localStorage.getItem('session_mode') === 'shop') { navigate('/pre-order'); return; }
    fetchCategories(); fetchProducts(); fetchPromotions(); fetchStoreInfo();
  }, [navigate]);

  const fetchStoreInfo = async () => { try { const res = await api.get('/settings/store'); setStoreInfo(res.data); } catch (e) {} };
  const fetchPromotions = async () => { try { const res = await api.get('/promotions'); setPromotions(res.data); } catch (e) {} };

  useEffect(() => {
    if (!socket) return;
    socket.on('connect', () => {});
    socket.on('stock_updated', (data) => {
      fetchProducts();
      Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'สต๊อกอัปเดตแล้ว!', showConfirmButton: false, timer: 2000, timerProgressBar: true });
    });
    return () => { socket.off('connect'); socket.off('stock_updated'); };
  }, [socket]);

  const fetchCategories = async () => { try { const res = await api.get('/categories'); setCategories(res.data); } catch (e) {} };
  const fetchProducts = async () => { try { const res = await api.get('/products'); setProducts(res.data); } catch (e) {} };

  const filteredProducts = (selectedCategory === 'ALL' ? products : products.filter(p => p.category_id === selectedCategory))
    .filter(p => p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(productSearchQuery)));

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { ...product, quantity: 1 }];
    });
  };
  const updateQuantity = (id: number, delta: number) => setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i).filter(i => i.quantity > 0));

  const grandTotal = cart.reduce((t, i) => t + Number(i.price) * i.quantity, 0);
  const netTotal = Math.max(0, grandTotal - (appliedPromo?.discount_amount || 0));
  const maxRedeemable = currentMember ? Math.min(currentMember.points, Math.floor(netTotal)) : 0;
  const pointsDiscount = currentMember && redeemPoints ? Math.min(Number(redeemPoints), maxRedeemable) : 0;
  const finalTotal = Math.max(0, netTotal - pointsDiscount);

  useEffect(() => { if (cart.length === 0 && appliedPromo) setAppliedPromo(null); if (cart.length === 0 && redeemPoints) setRedeemPoints(''); }, [cart.length]);
  useEffect(() => { if (!currentMember && redeemPoints) setRedeemPoints(''); }, [currentMember]);

  const handleApplyPromo = async () => {
    if (!selectedPromoId) return;
    if (cart.length === 0) return Swal.fire({ icon: 'warning', title: 'ตะกร้าว่างเปล่า!' });
    setPromoLoading(true);
    try {
      const res = await api.post('/promotions/verify', { promotion_id: selectedPromoId, grand_total: grandTotal, items: cart.map(i => ({ product_id: i.id, quantity: i.quantity })), member_id: currentMember?.id || null });
      setAppliedPromo({ id: Number(selectedPromoId), name: res.data.promo_name, discount_amount: Number(res.data.discount_amount) });
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `ใช้โปรโมชั่น "${res.data.promo_name}" แล้ว`, showConfirmButton: false, timer: 1500 });
    } catch (error: any) { setAppliedPromo(null); Swal.fire({ icon: 'error', title: 'ใช้โปรโมชั่นไม่ได้', text: error.response?.data?.error }); }
    finally { setPromoLoading(false); }
  };
  const handleRemovePromo = () => { setAppliedPromo(null); setSelectedPromoId(''); };

  const handleSearchMember = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchMemberQuery.trim()) return;
    setMemberLoading(true);
    try {
      const res = await api.get(`/users/search?q=${searchMemberQuery}`);
      setCurrentMember(res.data);
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `พบสมาชิก: ${res.data.full_name}`, showConfirmButton: false, timer: 1500 });
    } catch { setCurrentMember(null); Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'ไม่พบข้อมูลสมาชิก', showConfirmButton: false, timer: 1500 }); }
    finally { setMemberLoading(false); }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return Swal.fire({ icon: 'warning', title: 'ตะกร้าว่างเปล่า!' });
    if (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal)) return Swal.fire({ icon: 'error', title: 'รับเงินมาไม่พอ!' });
    setLoading(true);
    try {
      const response = await api.post('/sales/checkout', {
        cashier_id: user.id, member_id: currentMember?.id || null,
        promotion_id: appliedPromo?.id || null, redeem_points: pointsDiscount > 0 ? pointsDiscount : 0,
        payment_method: paymentMethod, amount_received: paymentMethod === 'CASH' ? Number(amountReceived) : finalTotal,
        items: cart.map(i => ({ product_id: i.id, quantity: i.quantity }))
      });
      setReceiptData({ ...response.data.receipt, items: cart.map(i => ({ name: i.name, price: Number(i.price), quantity: i.quantity })), cashier_name: user.full_name, member_name: currentMember?.full_name || null, promo_name: appliedPromo?.name || null, created_at: new Date() });
      setCart([]); setAmountReceived(''); setCurrentMember(null); setSearchMemberQuery('');
      setAppliedPromo(null); setSelectedPromoId(''); setRedeemPoints(''); setIsCartOpen(false);
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error }); }
    finally { setLoading(false); }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actualCash === '') return Swal.fire({ icon: 'warning', title: 'กรุณาระบุยอดเงิน' });
    setCloseLoading(true);
    try { const response = await api.post('/shifts/close', { cashier_id: user.id, actual_cash: Number(actualCash) }); setShiftSummary(response.data.summary); }
    catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error }); }
    finally { setCloseLoading(false); }
  };

  const finishAndLogout = () => { localStorage.clear(); navigate('/login'); };

  // ── shared classes ────────────────────────────────────────────────────────
  const inputCls = "w-full px-3 py-2.5 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150";

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full bg-gray-50 relative">

      {/* ── Left: Products ─────────────────────────────────────────────────── */}
      <div className="w-full md:w-3/5 flex flex-col h-full">
        {/* Header */}
        <div className="bg-white border-b border-[#F6C7C7] px-4 py-3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-[#F12B6B] rounded-lg flex items-center justify-center">
              <ShoppingCart size={15} className="text-white" />
            </div>
            <h1 className="text-base font-bold text-gray-900">POS ขายสินค้า</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 bg-[#FFF5F7] border border-[#F6C7C7] px-3 py-1.5 rounded-full">
              <User size={13} /> {user.full_name || 'CASHIER'}
            </span>
            {user.role !== 'ADMIN' && (
              <button onClick={() => setShowCloseModal(true)} className="bg-red-50 border border-red-200 text-red-500 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-semibold transition-all duration-150 active:scale-95">
                <Lock size={14} /> <span className="hidden sm:inline">ปิดกะ</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Category sidebar */}
          <div className="md:w-1/5 bg-white border-b md:border-b-0 md:border-r border-[#F6C7C7] p-3 overflow-x-auto md:overflow-y-auto shrink-0 flex flex-row md:flex-col gap-1.5 scrollbar-hide">
            <button onClick={() => setSelectedCategory('ALL')} className={`shrink-0 px-3 py-1.5 rounded-full md:rounded-xl text-xs font-medium transition-all duration-150 ${selectedCategory === 'ALL' ? 'bg-[#F12B6B] text-white' : 'bg-[#FFF5F7] text-gray-600 hover:bg-[#F6C7C7]'}`}>ทั้งหมด</button>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`shrink-0 px-3 py-1.5 rounded-full md:rounded-xl text-xs font-medium transition-all duration-150 ${selectedCategory === cat.id ? 'bg-[#F12B6B] text-white' : 'bg-[#FFF5F7] text-gray-600 hover:bg-[#F6C7C7]'}`}>
                {cat.name}
              </button>
            ))}
          </div>

          {/* Product grid */}
          <div className="flex-1 p-3 overflow-y-auto pb-28 md:pb-4">
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="ค้นหาสินค้า / บาร์โค้ด..." value={productSearchQuery} onChange={e => setProductSearchQuery(e.target.value)}
                className="w-full pl-8 pr-4 py-2 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150" />
            </div>

            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <PackagePlus size={36} className="text-[#FD94B4] mb-3" />
                <p className="text-sm text-gray-400">ไม่พบสินค้าในหมวดนี้</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredProducts.map(p => (
                  <div key={p.id} onClick={() => addToCart(p)} className="bg-white border border-[#F6C7C7] rounded-xl p-3 cursor-pointer hover:border-[#FD94B4] hover:shadow-sm transition-all duration-150 active:scale-95 flex flex-col items-center">
                    <div className="w-full aspect-square bg-[#FFF5F7] rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <PackagePlus size={28} className="text-[#FD94B4] opacity-50" />}
                    </div>
                    <p className="text-xs font-medium text-gray-800 text-center line-clamp-2 mb-1">{p.name}</p>
                    <p className="text-sm font-bold text-[#F12B6B]">฿{Number(p.price).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile cart FAB ───────────────────────────────────────────────── */}
      <button onClick={() => setIsCartOpen(true)} className="md:hidden fixed bottom-20 right-4 z-40 w-14 h-14 bg-[#F12B6B] hover:bg-[#FF467E] text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90">
        <ShoppingCart size={22} />
        {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white">{cart.reduce((a, c) => a + c.quantity, 0)}</span>}
      </button>

      {/* ── Right: Cart ──────────────────────────────────────────────────── */}
      <div className={`${isCartOpen ? 'fixed inset-0 z-[60] flex' : 'hidden'} md:flex md:relative md:w-2/5 flex-col bg-white border-l border-[#F6C7C7]`}>
        {/* Cart header */}
        <div className="bg-[#F12B6B] px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart size={18} className="text-white" />
            <h2 className="text-sm font-bold text-white">ตะกร้าสินค้า</h2>
            {cart.length > 0 && <span className="bg-white text-[#F12B6B] text-xs font-bold px-1.5 py-0.5 rounded-full">{cart.reduce((a, c) => a + c.quantity, 0)}</span>}
          </div>
          <button onClick={() => setIsCartOpen(false)} className="md:hidden p-1.5 bg-white/20 rounded-lg text-white hover:bg-white/30 transition-colors duration-150"><X size={18} /></button>
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-12 text-center">
              <ShoppingCart size={36} className="text-[#FD94B4] mb-3" />
              <p className="text-sm text-gray-400">ยังไม่มีสินค้าในตะกร้า</p>
            </div>
          ) : cart.map(item => (
            <div key={item.id} className="flex justify-between items-center bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl px-3 py-2">
              <div className="flex-1 min-w-0 pr-2">
                <p className="text-xs font-semibold text-gray-900 truncate">{item.name}</p>
                <p className="text-xs text-[#F12B6B] font-bold">฿{Number(item.price).toFixed(2)}</p>
              </div>
              <div className="flex items-center gap-1 bg-white border border-[#F6C7C7] rounded-lg p-1 shrink-0">
                <button onClick={() => updateQuantity(item.id, -1)} className="w-6 h-6 flex items-center justify-center hover:bg-[#FFF5F7] rounded text-gray-600 hover:text-red-500 transition-colors duration-150"><Minus size={11} /></button>
                <span className="text-xs font-bold text-gray-900 w-5 text-center">{item.quantity}</span>
                <button onClick={() => updateQuantity(item.id, 1)} className="w-6 h-6 flex items-center justify-center hover:bg-[#FFF5F7] rounded text-gray-600 hover:text-emerald-500 transition-colors duration-150"><Plus size={11} /></button>
              </div>
              <p className="text-xs font-bold text-gray-900 w-14 text-right shrink-0">฿{(Number(item.price) * item.quantity).toFixed(2)}</p>
            </div>
          ))}
        </div>

        {/* Checkout panel */}
        <div className="border-t border-[#F6C7C7] p-3 pb-20 md:pb-3 space-y-3 bg-white shrink-0">

          {/* Member search */}
          <div className="bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl p-3">
            {!currentMember ? (
              <form onSubmit={handleSearchMember} className="flex gap-2">
                <input type="text" placeholder="เบอร์โทร หรือ รหัสนักศึกษา..." value={searchMemberQuery} onChange={e => setSearchMemberQuery(e.target.value)} className="flex-1 min-w-0 px-3 py-2 bg-white border border-[#F6C7C7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150" />
                <button type="submit" disabled={memberLoading} className="px-3 py-2 bg-[#F12B6B] hover:bg-[#FF467E] text-white text-xs font-semibold rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50">{memberLoading ? '...' : 'ค้นหา'}</button>
                <button type="button" onClick={() => setShowRegisterModal(true)} className="px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-colors duration-150"><UserPlus size={16} /></button>
              </form>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-gray-400">{currentMember.student_id}</p>
                  <p className="text-sm font-semibold text-gray-900">{currentMember.full_name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">{currentMember.points} 🌟</span>
                  <button onClick={() => { setCurrentMember(null); setSearchMemberQuery(''); }} className="p-1 text-red-400 hover:bg-red-50 rounded-lg transition-colors duration-150"><X size={14} /></button>
                </div>
              </div>
            )}
          </div>

          {/* Promo */}
          {!appliedPromo ? (
            <div className="flex gap-2">
              <select value={selectedPromoId} onChange={e => setSelectedPromoId(e.target.value ? Number(e.target.value) : '')} className={`${inputCls} flex-1 min-w-0`}>
                <option value="">-- โปรโมชั่น (ถ้ามี) --</option>
                {promotions.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.discount_type === 'PERCENT' ? `ลด ${p.discount_value}%` : `ลด ฿${p.discount_value}`})</option>)}
              </select>
              <button onClick={handleApplyPromo} disabled={!selectedPromoId || promoLoading} className="px-3 py-2 bg-[#F12B6B] hover:bg-[#FF467E] text-white text-xs font-semibold rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-40">{promoLoading ? '...' : 'ใช้โค้ด'}</button>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              <p className="text-xs font-semibold text-emerald-700">🏷️ {appliedPromo.name} (-฿{appliedPromo.discount_amount.toFixed(2)})</p>
              <button onClick={handleRemovePromo} className="p-1 text-red-400 hover:bg-red-50 rounded-lg transition-colors duration-150"><X size={14} /></button>
            </div>
          )}

          {/* Redeem points */}
          {currentMember && currentMember.points > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              <Gift size={16} className="text-amber-500 shrink-0" />
              <span className="text-xs text-amber-700 shrink-0">แต้ม ({currentMember.points} 🌟):</span>
              <input type="number" min={0} max={maxRedeemable} value={redeemPoints} onChange={e => setRedeemPoints(e.target.value ? Math.max(0, Math.min(Number(e.target.value), maxRedeemable)) : '')} placeholder="0" className="flex-1 min-w-0 px-2 py-1 bg-white border border-amber-200 rounded-lg text-xs font-bold text-right focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <button onClick={() => setRedeemPoints(maxRedeemable)} className="text-[10px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-2 py-1 rounded-lg transition-colors duration-150 shrink-0">สูงสุด</button>
            </div>
          )}

          {/* Totals */}
          <div className="space-y-1 px-1">
            <div className="flex justify-between text-xs text-gray-500"><span>ยอดรวม</span><span>฿{grandTotal.toFixed(2)}</span></div>
            {appliedPromo && <div className="flex justify-between text-xs text-emerald-600 font-semibold"><span>ส่วนลดโปรโมชั่น</span><span>-฿{appliedPromo.discount_amount.toFixed(2)}</span></div>}
            {pointsDiscount > 0 && <div className="flex justify-between text-xs text-amber-600 font-semibold"><span>แลกแต้ม</span><span>-฿{pointsDiscount.toFixed(2)}</span></div>}
            <div className="flex justify-between text-base font-bold text-gray-900 border-t border-[#F6C7C7] pt-1.5 mt-1.5">
              <span>ยอดสุทธิ</span><span className="text-[#F12B6B]">฿{finalTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Payment method */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setPaymentMethod('CASH'); setAmountReceived(''); }} className={`py-2 rounded-xl text-xs font-semibold border-2 transition-all duration-150 ${paymentMethod === 'CASH' ? 'border-[#F12B6B] bg-[#FFF5F7] text-[#F12B6B]' : 'border-gray-200 text-gray-400 hover:border-[#F6C7C7]'}`}>💵 เงินสด</button>
            <button onClick={() => { setPaymentMethod('QR'); setAmountReceived(finalTotal); }} className={`py-2 rounded-xl text-xs font-semibold border-2 transition-all duration-150 ${paymentMethod === 'QR' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400 hover:border-blue-200'}`}>📱 สแกนจ่าย</button>
          </div>

          {/* Cash input or QR */}
          {paymentMethod === 'CASH' ? (
            <div>
              <input type="number" inputMode="none" value={amountReceived} onChange={e => setAmountReceived(e.target.value ? Number(e.target.value) : '')} placeholder="0.00" readOnly
                className="w-full text-right text-xl font-bold px-4 py-3 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150" />
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {[20, 50, 100, 500, 1000].map(v => (
                  <button key={v} onClick={() => setAmountReceived(v)} className="flex-1 min-w-[40px] py-1.5 bg-[#FFF5F7] border border-[#F6C7C7] text-[#F12B6B] font-semibold rounded-lg text-xs hover:bg-[#F12B6B] hover:text-white transition-all duration-150">฿{v}</button>
                ))}
                <button onClick={() => setAmountReceived(Math.ceil(finalTotal / 10) * 10)} className="flex-1 min-w-[40px] py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold rounded-lg text-xs hover:bg-emerald-500 hover:text-white transition-all duration-150">เต็ม</button>
              </div>
              {/* Mobile numpad */}
              <div className="md:hidden mt-2 grid grid-cols-3 gap-1.5">
                {['1','2','3','4','5','6','7','8','9','00','0','⌫'].map(k => (
                  <button key={k} onClick={() => {
                    if (k === '⌫') { setAmountReceived(prev => { const s = String(prev === '' ? '' : prev).slice(0, -1); return s === '' ? '' : Number(s); }); }
                    else { setAmountReceived(prev => { const s = (prev === '' ? '' : String(prev)) + k; return Number(s); }); }
                  }} className={`py-3.5 rounded-xl text-base font-bold transition-all duration-150 active:scale-95 ${k === '⌫' ? 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-100' : 'bg-[#FFF5F7] border border-[#F6C7C7] text-gray-800 hover:bg-[#F12B6B] hover:text-white hover:border-[#F12B6B]'}`}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-800 mb-2">สแกนเพื่อชำระเงิน (PromptPay)</p>
              <div className="bg-white p-2 rounded-lg"><QRCode value={generatePayload(PROMPTPAY_ID, { amount: finalTotal })} size={130} /></div>
              <p className="text-[10px] text-blue-500 mt-2">รบกวนลูกค้าโชว์สลิปหลังโอนสำเร็จ</p>
            </div>
          )}

          {/* Checkout button */}
          <button onClick={handleCheckout} disabled={cart.length === 0 || loading || (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal))}
            className={`w-full py-3.5 rounded-xl text-sm font-bold text-white transition-all duration-150 active:scale-95 flex items-center justify-center gap-2 ${cart.length === 0 || (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal)) ? 'bg-gray-300 cursor-not-allowed' : paymentMethod === 'QR' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-[#F12B6B] hover:bg-[#FF467E]'}`}>
            {loading ? 'กำลังประมวลผล...' : <><CheckCircle size={18} /> {paymentMethod === 'QR' ? 'ยืนยันตรวจสอบสลิปแล้ว' : 'ชำระเงิน'}</>}
          </button>
        </div>
      </div>

      {/* ── Close Shift Modal ─────────────────────────────────────────────── */}
      {showCloseModal && (
        <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-xl w-full md:max-w-md overflow-hidden">
            {!shiftSummary ? (
              <>
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#F6C7C7] bg-[#FFF5F7]">
                  <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Lock size={16} className="text-red-500" /> ปิดกะการขาย</h3>
                  <button onClick={() => setShowCloseModal(false)} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-white rounded-lg transition-colors duration-150"><X size={18} /></button>
                </div>
                <div className="p-5">
                  <p className="text-sm text-gray-500 mb-4">นับเงินสดในลิ้นชักและกรอกยอดที่นับได้จริง</p>
                  <form onSubmit={handleCloseShift} className="space-y-4">
                    <input type="number" required min="0" value={actualCash} onChange={e => setActualCash(e.target.value ? Number(e.target.value) : '')} placeholder="0.00"
                      className="w-full text-center text-2xl font-bold px-4 py-3 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150" />
                    <button type="submit" disabled={closeLoading} className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50">
                      {closeLoading ? 'กำลังตรวจสอบ...' : 'ยืนยันการปิดกะ'}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="p-6 text-center">
                <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><CheckCircle size={28} className="text-emerald-500" /></div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">ปิดกะสำเร็จ</h3>
                <p className="text-xs text-gray-400 mb-4">บันทึกข้อมูลเรียบร้อยแล้ว</p>
                <div className="bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl p-4 text-left space-y-2 mb-5 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">เงินทอนตั้งต้น</span><span className="font-semibold">฿{Number(shiftSummary.opening_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">ยอดขายเงินสด</span><span className="font-semibold">฿{Number(shiftSummary.cash_sales||0).toFixed(2)}</span></div>
                  <div className="flex justify-between border-t border-[#F6C7C7] pt-2"><span className="font-bold text-gray-800">เงินสดที่ควรมี</span><span className="font-bold text-[#F12B6B]">฿{Number(shiftSummary.expected_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="font-bold text-gray-800">นับได้จริง</span><span className="font-bold">฿{Number(shiftSummary.actual_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between border-t border-[#F6C7C7] pt-2">
                    <span className="font-bold text-gray-800">ส่วนต่าง</span>
                    <span className={`font-bold ${Number(shiftSummary.difference) < 0 ? 'text-red-500' : Number(shiftSummary.difference) > 0 ? 'text-emerald-500' : 'text-gray-500'}`}>
                      {Number(shiftSummary.difference) > 0 ? '+' : ''}{Number(shiftSummary.difference).toFixed(2)}
                    </span>
                  </div>
                </div>
                <button onClick={finishAndLogout} className="w-full py-3 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-semibold rounded-xl transition-all duration-150 active:scale-95">ออกจากระบบ</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Register Modal ────────────────────────────────────────────────── */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F6C7C7] bg-emerald-50">
              <h3 className="text-sm font-semibold text-emerald-800 flex items-center gap-2"><UserPlus size={16} /> สมัครสมาชิกใหม่</h3>
              <button onClick={() => setShowRegisterModal(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors duration-150"><X size={16} /></button>
            </div>
            <form onSubmit={handleRegister} className="p-5 space-y-3">
              {[{ key: 'student_id', label: 'รหัสนักศึกษา', placeholder: 'เช่น 66209010001', type: 'text' },
                { key: 'full_name', label: 'ชื่อ-นามสกุล', placeholder: 'นาย/นางสาว...', type: 'text' },
                { key: 'phone_number', label: 'เบอร์โทรศัพท์', placeholder: '08X-XXX-XXXX', type: 'tel' }].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
                  <input type={f.type} required placeholder={f.placeholder} value={(regForm as any)[f.key]} onChange={e => setRegForm({ ...regForm, [f.key]: e.target.value })} className={inputCls} />
                </div>
              ))}
              <button type="submit" disabled={regLoading} className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50 mt-2">
                {regLoading ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Receipt Modal ─────────────────────────────────────────────────── */}
      {receiptData && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 print:bg-white print:p-0 print:backdrop-blur-none">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden print:shadow-none print:rounded-none print:max-w-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F6C7C7] bg-[#FFF5F7] print:hidden">
              <h3 className="text-sm font-semibold text-[#F12B6B] flex items-center gap-2"><CheckCircle size={16} /> ทำรายการสำเร็จ</h3>
              <button onClick={() => setReceiptData(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors duration-150"><X size={16} /></button>
            </div>
            <div id="receipt-print-area" className="p-5 font-mono text-sm text-gray-800">
              <div className="text-center mb-3">
                <p className="font-bold text-base">{storeInfo?.store_name || 'สหกรณ์วิทยาลัย'}</p>
                {storeInfo?.address && <p className="text-xs text-gray-500">{storeInfo.address}</p>}
                {storeInfo?.tax_id && <p className="text-xs text-gray-500">เลขผู้เสียภาษี: {storeInfo.tax_id}</p>}
              </div>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className="text-xs space-y-0.5">
                <div className="flex justify-between"><span>เลขที่บิล:</span><span>#{receiptData.sale_id}</span></div>
                <div className="flex justify-between"><span>วันที่:</span><span>{new Date(receiptData.created_at).toLocaleString('th-TH')}</span></div>
                <div className="flex justify-between"><span>แคชเชียร์:</span><span>{receiptData.cashier_name}</span></div>
                {receiptData.member_name && <div className="flex justify-between"><span>สมาชิก:</span><span>{receiptData.member_name}</span></div>}
              </div>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className="space-y-1">
                {receiptData.items.map((item: any, idx: number) => (
                  <div key={idx} className="flex justify-between text-xs">
                    <span className="flex-1 pr-2">{item.name} x{item.quantity}</span>
                    <span>฿{(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className="text-xs space-y-0.5">
                <div className="flex justify-between"><span>ยอดรวม:</span><span>฿{Number(receiptData.subtotal).toFixed(2)}</span></div>
                {receiptData.discount_amount > 0 && <div className="flex justify-between"><span>ส่วนลด{receiptData.promo_name ? ` (${receiptData.promo_name})` : ''}:</span><span>-฿{Number(receiptData.discount_amount).toFixed(2)}</span></div>}
                {receiptData.points_discount > 0 && <div className="flex justify-between"><span>แลกแต้ม ({receiptData.points_redeemed} 🌟):</span><span>-฿{Number(receiptData.points_discount).toFixed(2)}</span></div>}
              </div>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className="flex justify-between font-bold text-base"><span>ยอดสุทธิ:</span><span>฿{Number(receiptData.total_amount).toFixed(2)}</span></div>
              <div className="flex justify-between text-xs mt-1"><span>{receiptData.payment_method === 'CASH' ? 'รับเงินสด:' : 'ชำระผ่าน QR:'}</span><span>฿{Number(receiptData.amount_received).toFixed(2)}</span></div>
              <div className="flex justify-between text-xs"><span>เงินทอน:</span><span>฿{Number(receiptData.change_amount).toFixed(2)}</span></div>
              {receiptData.earn_points > 0 && <p className="text-center text-xs font-bold text-emerald-600 mt-2">+{receiptData.earn_points} 🌟 แต้มสะสม</p>}
              <p className="text-center text-xs text-gray-400 mt-3">ขอบคุณที่ใช้บริการ</p>
            </div>
            <div className="flex gap-2 p-4 border-t border-[#F6C7C7] print:hidden">
              <button onClick={() => window.print()} className="flex-1 py-2.5 bg-[#FFF5F7] border border-[#FD94B4] text-[#F12B6B] font-semibold text-sm rounded-xl flex items-center justify-center gap-2 hover:bg-[#F12B6B] hover:text-white transition-all duration-150 active:scale-95">
                <Printer size={16} /> พิมพ์ใบเสร็จ
              </button>
              <button onClick={() => setReceiptData(null)} className="flex-1 py-2.5 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95">ปิด</button>
            </div>
          </div>
        </div>
      )}

      <style>{`.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none} @media print{body *{visibility:hidden}#receipt-print-area,#receipt-print-area *{visibility:visible}#receipt-print-area{position:absolute;top:0;left:0;width:80mm;padding:4mm}}`}</style>
    </div>
  );
}
