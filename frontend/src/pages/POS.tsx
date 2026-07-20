// ✅ CHANGED: colors, layout → DMTC Mart theme (#F12B6B primary)
// 🔒 UNCHANGED: all handlers (handleCheckout, handleSearchMember, handleRegister, handleApplyPromo, handleCloseShift, finishAndLogout), socket listeners, all state, filteredProducts, price calculations

import { useState, useEffect } from 'react';
import { ShoppingCart, User, Plus, Minus, X, CheckCircle, PackagePlus, UserPlus, Printer, Gift, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Swal from '../swal';
import generatePayload from 'promptpay-qr';
import QRCode from 'react-qr-code';
import { useSocket } from '../SocketContext';
import { validateCheckout, type CheckoutPayload } from '../validators/checkoutValidator'; // ⭐️ F5
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { toSatang, fromSatang, lineTotalSatang } from '../utils/money'; // ⭐️ Sprint 1 — B3
import { useOnlineStatus } from '../hooks/useOnlineStatus'; // ⭐️ Sprint 2 — B6
import OfflineBanner from '../components/OfflineBanner'; // ⭐️ Sprint 2 — B6
import { formatBangkokTime } from '../utils/timezone'; // ⭐️ Sprint 2 — B8

interface Category { id: number; name: string; }
interface Product { id: number; barcode: string; name: string; price: string | number; image_url: string; category_id: number | null; stock?: number; }
interface CartItem extends Product { quantity: number; }

export default function POS() {
  const socket = useSocket();
  const isOnline = useOnlineStatus(); // ⭐️ Sprint 2 — B6
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
  const [payOpen, setPayOpen] = useState(false); // ⭐️ มือถือ: ยุบ/ขยายแผงชำระเงิน (กันจอสั้นล้น)
  // ⭐️ FIX: ปุ่ม/โมดัลปิดกะเดิมอยู่ในนี้ด้วย ซ้ำกับ Dashboard.tsx ที่มีฟีเจอร์ปิดกะสมบูรณ์อยู่แล้ว
  // ตามคำขอผู้ใช้ — ย้ายให้เหลือจุดเดียวที่ Dashboard เท่านั้น (state/handler/modal ที่เกี่ยวข้องถูกลบออกทั้งหมด)
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
  const [priceOverride, setPriceOverride] = useState<{[key: number]: number}>({});  // ⭐️ Sprint 2 — Expiry Discount

  const navigate = useNavigate();
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2

  // ── Handlers (unchanged) ──────────────────────────────────────────────────
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault(); setRegLoading(true);
    try {
      const res = await api.post('/users/register', regForm);
      Swal.fire({ icon: 'success', title: 'สมัครสมาชิกสำเร็จ!', text: 'ดึงข้อมูลเข้าบิลให้อัตโนมัติ' });
      setShowRegisterModal(false); setCurrentMember(res.data.user);
      setRegForm({ student_id: '', full_name: '', phone_number: '' });
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(error) }); }
    finally { setRegLoading(false); }
  };

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
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
    // ⭐️ Sprint 2 — Expiry Discount: Listen for expired products notification
    socket.on('products_expired', (data) => {
      Swal.fire({
        icon: 'warning',
        title: 'สินค้าหมดอายุ',
        html: `
          <p>สินค้าต่อไปนี้หมดอายุแล้ว:</p>
          <ul style="text-align: left; margin: 10px 0;">
            ${data.products.map((p: string) => `<li>${p}</li>`).join('')}
          </ul>
          <p>สินค้าเหล่านี้ถูกลบออกจากการขายแล้ว</p>
        `,
        confirmButtonText: 'เข้าใจแล้ว'
      });
      fetchProducts();
    });
    // ⭐️ Sprint 2 — D1: Listen for shift approval/rejection
    socket.on('shift_approved', (data) => {
      Swal.fire({
        icon: 'success',
        title: 'คำขอปิดกะได้รับการอนุมัติ',
        text: 'ผู้จัดการอนุมัติการปิดกะของคุณแล้ว',
        confirmButtonText: 'ตกลง'
      });
    });
    socket.on('shift_rejected', (data) => {
      Swal.fire({
        icon: 'warning',
        title: 'คำขอปิดกะถูกปฏิเสธ',
        text: `เหตุผล: ${data.reason || 'ไม่ระบุ'}\n\nกรุณาตรวจสอบและส่งคำขอใหม่`,
        confirmButtonText: 'ตกลง'
      });
    });
    return () => {
      socket.off('connect');
      socket.off('stock_updated');
      socket.off('products_expired');
      socket.off('shift_approved');
      socket.off('shift_rejected');
    };
  }, [socket]);

  const fetchCategories = async () => { try { const res = await api.get('/categories'); setCategories(res.data); } catch (e) {} };
  const fetchProducts = async () => { try { const res = await api.get('/products'); setProducts(res.data); } catch (e) {} };

  const filteredProducts = (selectedCategory === 'ALL' ? products : products.filter(p => p.category_id === selectedCategory))
    .filter(p => p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(productSearchQuery)));

  const addToCart = (product: Product, customPrice?: number) => {
    // ⭐️ Sprint 2: Check if product is expired
    if ((product as any).expiry_status === 'expired') {
      Swal.fire({ icon: 'error', title: 'สินค้าหมดอายุ', text: 'ไม่สามารถเพิ่มสินค้าที่หมดอายุแล้ว' });
      return;
    }
    setCart(prev => {
      const cartProduct = { ...product, quantity: 1, price: customPrice ?? product.price };
      const existing = prev.find(i => i.id === product.id);
      if (existing) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, cartProduct];
    });
  };
  const updateQuantity = (id: number, delta: number) => setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i).filter(i => i.quantity > 0));

  // ⭐️ Sprint 1 — B3: คำนวณยอดเงินทั้งหมดในหน่วยสตางค์ (integer) กัน float drift สะสมข้ามหลายรายการ
  // ในตะกร้า (เดิม: Number(i.price) * i.quantity บวกสะสมด้วย float ตรงๆ — คลาสสิก 0.1+0.2 bug)
  const grandTotalSatang = cart.reduce((t, i) => t + lineTotalSatang(i.price, i.quantity), 0);
  const grandTotal = fromSatang(grandTotalSatang);
  const netTotalSatang = Math.max(0, grandTotalSatang - toSatang(appliedPromo?.discount_amount || 0));
  const netTotal = fromSatang(netTotalSatang);
  const maxRedeemable = currentMember ? Math.min(currentMember.points, Math.floor(netTotal)) : 0;
  const pointsDiscount = currentMember && redeemPoints ? Math.min(Number(redeemPoints), maxRedeemable) : 0;
  const finalTotal = fromSatang(Math.max(0, netTotalSatang - toSatang(pointsDiscount)));

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
    } catch (error: any) { setAppliedPromo(null); Swal.fire({ icon: 'error', title: 'ใช้โปรโมชั่นไม่ได้', text: getErrorMessage(error) }); }
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

  // ⭐️ F5 — payload ตัวเดียวกันทั้งใช้ validate ก่อนส่งจริง และใช้เช็คแบบ real-time ปิดปุ่ม
  const buildCheckoutPayload = (): CheckoutPayload => ({
    cashier_id: user.id, member_id: currentMember?.id || null,
    promotion_id: appliedPromo?.id || null, redeem_points: pointsDiscount > 0 ? pointsDiscount : 0,
    payment_method: paymentMethod, amount_received: paymentMethod === 'CASH' ? Number(amountReceived) || 0 : finalTotal,
    items: cart.map(i => ({ product_id: i.id, quantity: i.quantity })),
  });
  const checkoutValidationError = validateCheckout(buildCheckoutPayload());

  const handleCheckout = async () => {
    if (cart.length === 0) return Swal.fire({ icon: 'warning', title: 'ตะกร้าว่างเปล่า!' });
    if (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal)) return Swal.fire({ icon: 'error', title: 'รับเงินมาไม่พอ!' });
    // ⭐️ F5 — validate ตาม schema เดียวกับ backend ก่อนยิง API จริง กัน payload ผิดรูปแบบหลุดไปถึง server
    if (checkoutValidationError) return Swal.fire({ icon: 'error', title: 'ข้อมูลไม่ถูกต้อง', text: checkoutValidationError });
    setLoading(true);
    try {
      // ⭐️ Sprint 2 — B6: Add 30-second timeout for checkout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await api.post('/sales/checkout', {
        cashier_id: user.id, member_id: currentMember?.id || null,
        promotion_id: appliedPromo?.id || null, redeem_points: pointsDiscount > 0 ? pointsDiscount : 0,
        payment_method: paymentMethod, amount_received: paymentMethod === 'CASH' ? Number(amountReceived) : finalTotal,
        items: cart.map(i => ({ product_id: i.id, quantity: i.quantity }))
      }, { signal: controller.signal });

      clearTimeout(timeoutId);

      setReceiptData({ ...response.data.receipt, items: cart.map(i => ({ name: i.name, price: Number(i.price), quantity: i.quantity })), cashier_name: user.full_name, member_name: currentMember?.full_name || null, promo_name: appliedPromo?.name || null, created_at: new Date() });
      setCart([]); setAmountReceived(''); setCurrentMember(null); setSearchMemberQuery('');
      setAppliedPromo(null); setSelectedPromoId(''); setRedeemPoints(''); setIsCartOpen(false);
    } catch (error: any) {
      if (error.code === 'ECONNABORTED') {
        Swal.fire({ icon: 'error', title: 'หมดเวลา', text: 'การส่งข้อมูลใช้เวลานานเกินไป (30 วินาที) — กรุณาลองใหม่' });
      }
      // ⭐️ Sprint 2 — B7: Handle 400 with stock issues
      else if (error.response?.status === 400 && error.response?.data?.issues) {
        const issues = error.response.data.issues as Array<{ product_id: number; product_name: string; requested: number; available: number }>;
        Swal.fire({
          icon: 'warning',
          title: 'สต๊อกไม่เพียงพอสำหรับบางรายการ',
          html: `
            <div style="text-align: left; margin-top: 10px;">
              <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
                <tbody>
                  ${issues.map(issue => `
                    <tr style="border-bottom: 1px solid #ccc; padding: 8px;">
                      <td style="padding: 6px; font-weight: bold; color: #F12B6B;">${issue.product_name}</td>
                      <td style="padding: 6px; text-align: right;">
                        <span style="color: #d9534f;">ขอ: ${issue.requested}</span> |
                        <span style="color: #5cb85c;">มี: ${issue.available}</span>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `,
          confirmButtonText: 'แก้ไขตะกร้า',
          confirmButtonColor: '#F12B6B'
        });
      }
      // ⭐️ Sprint 2 — B7: Handle 409 race condition
      else if (error.response?.status === 409) {
        Swal.fire({
          icon: 'error',
          title: 'ขัดแย้ง',
          text: 'สต๊อกถูกแก้ไขโดยระบบอื่นพร้อมกัน กรุณาลองใหม่ (หน้าจะโหลดข้อมูลใหม่)',
          confirmButtonText: 'โหลดใหม่',
          confirmButtonColor: '#F12B6B',
          allowOutsideClick: false
        }).then(() => {
          setCart([]);
          setAmountReceived('');
          setCurrentMember(null);
          setSearchMemberQuery('');
          setAppliedPromo(null);
          setSelectedPromoId('');
          setRedeemPoints('');
          fetchProducts();
          setIsCartOpen(false);
        });
      }
      else {
        Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(error) });
      }
    }
    finally { setLoading(false); }
  };

  // ── shared classes ────────────────────────────────────────────────────────
  const inputCls = "w-full px-3 py-2.5 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150";

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ⭐️ Sprint 2 — B6: Offline Banner */}
      <OfflineBanner isOnline={isOnline} />

      <div className="flex h-full bg-[#FFF5F7] relative">

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
            {/* ⭐️ FIX: ปุ่มปิดกะเดิมอยู่ตรงนี้ด้วย — ตามคำขอผู้ใช้ ย้ายให้เหลือจุดเดียวที่หน้า Dashboard */}
          </div>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* ⭐️ FIX: มือถือ — ใส่กรอบขาวโค้งมนรอบแท็บหมวดหมู่ให้เหมือนหน้าจอง (Pre-order) เดิมเป็นแค่แถบบาง
              ไม่มีกรอบ ดูกลืนกับพื้นหลัง ส่วนเดสก์ท็อปยังคงเป็น sidebar ตามเดิม (border-r ธรรมดา ไม่ใส่กรอบ) */}
          <div className="md:w-1/5 bg-white border border-[#F6C7C7] rounded-xl shadow-sm m-3 mb-0 md:m-0 md:rounded-none md:shadow-none md:border-0 md:border-r p-3 overflow-x-auto md:overflow-y-auto shrink-0 flex flex-row md:flex-col gap-1.5 scrollbar-hide">
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
                {filteredProducts.map(p => {
                  const pWithExpiry = p as any;
                  const showDiscount = pWithExpiry.expiry_status === 'near_expiry';
                  const overridePrice = priceOverride[p.id];
                  // ⭐️ Phase 1 — โปรช่วงวันที่ (ใช้เมื่อไม่มีลดใกล้หมดอายุ; ถ้ามีทั้งคู่ server จะเลือกอันดีสุดตอนคิดเงินเอง)
                  const promoActive = !showDiscount && !!pWithExpiry.promo_active;
                  const promoPct = Number(pWithExpiry.promo_percent) || 0;
                  const finalPrice = overridePrice ?? (showDiscount ? pWithExpiry.price_after_discount : (promoActive ? Number(p.price) * (1 - promoPct / 100) : p.price));
                  const isExpired = pWithExpiry.expiry_status === 'expired';

                  return (
                    <div
                      key={p.id}
                      onClick={() => !isExpired && addToCart(p, finalPrice)}
                      className={`bg-white border rounded-xl p-3 transition-all duration-150 flex flex-col items-center h-full
                        ${showDiscount ? 'border-yellow-400 bg-yellow-50' : 'border-[#F6C7C7]'}
                        ${isExpired ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-[#FD94B4] hover:shadow-sm active:scale-95'}
                      `}
                    >
                      <div className="w-full aspect-square bg-[#FFF5F7] rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                        {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <PackagePlus size={28} className="text-[#FD94B4] opacity-50" />}
                      </div>
                      <p className="text-xs font-medium text-gray-800 text-center line-clamp-2 mb-1">{p.name}</p>

                      {/* ⭐️ Sprint 2: Expiry Badges */}
                      {showDiscount && (
                        <div className="bg-yellow-200 text-yellow-800 px-2 py-1 rounded text-xs font-bold mb-1 w-full text-center">
                          🎁 ใกล้หมดอายุ - {pWithExpiry.discount_percent}% OFF
                        </div>
                      )}
                      {isExpired && (
                        <div className="bg-red-200 text-red-800 px-2 py-1 rounded text-xs font-bold mb-1 w-full text-center">
                          ❌ หมดอายุ
                        </div>
                      )}
                      {pWithExpiry.expiry_status === 'expires_today' && (
                        <div className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs mb-1 w-full text-center">
                          ⚠️ หมดอายุวันนี้
                        </div>
                      )}
                      {promoActive && (
                        <div className="bg-amber-200 text-amber-800 px-2 py-1 rounded text-xs font-bold mb-1 w-full text-center">
                          🏷️ โปรลดราคา -{promoPct}%
                        </div>
                      )}

                      {/* ⭐️ FIX: ราคาอยู่มุมซ้ายล่าง จำนวนคงเหลืออยู่มุมขวาล่าง เหมือนการ์ดสินค้าหน้าจอง (Pre-order)
                          mt-auto ดันราคา+ปุ่มด้านล่างทั้งกลุ่มให้ชิดขอบล่างเสมอ แม้การ์ดถูก grid stretch สูงไม่เท่ากัน */}
                      <div className="w-full flex justify-between items-end mb-1 gap-1 mt-auto">
                        <div className="min-w-0">
                          {showDiscount ? (
                            <>
                              <s className="text-gray-400 text-xs block">฿{Number(p.price).toFixed(2)}</s>
                              <span className="text-red-600 font-bold text-sm">฿{Number(finalPrice).toFixed(2)}</span>
                            </>
                          ) : promoActive ? (
                            <>
                              <s className="text-gray-400 text-xs block">฿{Number(p.price).toFixed(2)}</s>
                              <span className="text-amber-600 font-bold text-sm">฿{Number(finalPrice).toFixed(2)}</span>
                            </>
                          ) : (
                            <p className="text-sm font-bold text-[#F12B6B]">฿{Number(finalPrice).toFixed(2)}</p>
                          )}
                        </div>
                        {typeof p.stock === 'number' && (
                          <p className="shrink-0 text-[10px] bg-[#FFF5F7] text-[#F12B6B] px-1.5 py-0.5 rounded-md font-bold">เหลือ {p.stock}</p>
                        )}
                      </div>

                      {/* ⭐️ Sprint 2: Staff Override Price Input */}
                      {showDiscount && (
                        <div className="w-full mt-1 mb-2" onClick={(e) => e.stopPropagation()}>
                          <label className="text-xs text-gray-600">ราคาเบิกเพิ่มเติม:</label>
                          <input
                            type="number"
                            value={overridePrice ?? ''}
                            onChange={(e) => setPriceOverride({...priceOverride, [p.id]: parseFloat(e.target.value) || 0})}
                            className="w-full px-2 py-1 border rounded text-sm"
                            placeholder={Number(pWithExpiry.price_after_discount).toFixed(2)}
                            step="0.01"
                          />
                        </div>
                      )}

                      {/* ⭐️ FIX: เพิ่ม stopPropagation กัน addToCart ยิงซ้อน 2 ครั้ง (การ์ดทั้งใบก็ onClick
                          addToCart อยู่แล้ว กดปุ่มจะ bubble ขึ้นไปยิงซ้ำ) + เปลี่ยน hover เป็น #FF467E ให้ตรงธีม */}
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!isExpired) addToCart(p, finalPrice); }}
                        disabled={isExpired}
                        className={`w-full py-1 rounded text-xs font-medium transition-colors duration-150
                          ${isExpired
                            ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                            : 'bg-[#F12B6B] text-white hover:bg-[#FF467E] active:scale-95'
                          }
                        `}
                      >
                        {isExpired ? 'ไม่สามารถขายได้' : 'เพิ่มลงตะกร้า'}
                      </button>
                    </div>
                  );
                })}
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
          ) : cart.map(item => {
            // ⭐️ Sprint 2 — B7: Get current product stock to show warnings
            const product = products.find(p => p.id === item.id);
            const isStockExceeded = product && item.quantity > (product.stock ?? 0);
            return (
            <div key={item.id} className={`flex justify-between items-center rounded-xl px-3 py-2 border transition-colors ${
              isStockExceeded
                ? 'bg-yellow-50 border-yellow-300'
                : 'bg-[#FFF5F7] border-[#F6C7C7]'
            }`}>
              <div className="flex-1 min-w-0 pr-2">
                <p className="text-xs font-semibold text-gray-900 truncate">{item.name}</p>
                <p className="text-xs text-[#F12B6B] font-bold">฿{Number(item.price).toFixed(2)}</p>
                {/* ⭐️ Sprint 2 — B7: Show stock warning */}
                {isStockExceeded && (
                  <p className="text-xs text-yellow-700 font-semibold mt-1">
                    ⚠️ มีเฉพาะ {product?.stock} ชิ้น
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 bg-white border border-[#F6C7C7] rounded-lg p-1 shrink-0">
                <button onClick={() => updateQuantity(item.id, -1)} className="w-6 h-6 flex items-center justify-center hover:bg-[#FFF5F7] rounded text-gray-600 hover:text-red-500 transition-colors duration-150"><Minus size={11} /></button>
                <span className="text-xs font-bold text-gray-900 w-5 text-center">{item.quantity}</span>
                <button onClick={() => updateQuantity(item.id, 1)} className="w-6 h-6 flex items-center justify-center hover:bg-[#FFF5F7] rounded text-gray-600 hover:text-emerald-500 transition-colors duration-150"><Plus size={11} /></button>
              </div>
              <p className="text-xs font-bold text-gray-900 w-14 text-right shrink-0">฿{(Number(item.price) * item.quantity).toFixed(2)}</p>
            </div>
          );
          })}
        </div>

        {/* Checkout panel */}
        {/* ⭐️ FIX: เดิม pb-20 กันชนกับ bottom nav แต่ตะกร้ามือถือเป็น fixed inset-0 z-[60] คลุมเต็มจอ
            ทับ nav (z-50) อยู่แล้ว 100% เลยไม่มี nav ให้ต้องกันเว้นระยะ — เหลือ pb-20 ไว้กลายเป็นช่องว่างเปล่าๆ
            ใต้ปุ่ม "ชำระเงิน" เอาออกให้เนื้อหาทั้งแผงขยับลงมาชิดขอบล่างจริง */}
        <div className="border-t border-[#F6C7C7] bg-white shrink-0">
          {/* ⭐️ มือถือ: แถบสรุป + ปุ่มยุบ/ขยายแผงชำระเงิน — จอสั้นจะได้เห็นรายการสินค้าเต็มๆ แล้วค่อยกดขยายตอนจะจ่าย */}
          <div className="md:hidden flex items-center justify-between gap-2 px-3 py-2 border-b border-[#F6C7C7]">
            <div className="text-sm"><span className="text-gray-500">ยอดสุทธิ </span><span className="font-bold text-[#F12B6B]">฿{finalTotal.toFixed(2)}</span></div>
            <button onClick={() => setPayOpen(v => !v)} className="flex items-center gap-1 text-xs font-bold text-[#F12B6B] bg-[#FFF5F7] border border-[#F6C7C7] px-3 py-1.5 rounded-full active:scale-95 transition-all duration-150">
              {payOpen ? <><ChevronDown size={14} /> ย่อลง</> : <><ChevronUp size={14} /> ชำระเงิน</>}
            </button>
          </div>
          <div className={`${payOpen ? 'block' : 'hidden'} md:block p-3 pt-2 md:pt-3 space-y-3 overflow-y-auto max-h-[72vh] md:max-h-none md:overflow-visible`}>

          {/* Member search — ⭐️ FIX: rounded-xl → rounded-lg ให้ตรงกับสไตล์หน้าจองทั้งแผง */}
          <div className="bg-[#FFF5F7] border border-[#F6C7C7] rounded-lg p-3">
            {!currentMember ? (
              // ⭐️ FIX: ย้ายปุ่ม "สมัครสมาชิกใหม่" จากปุ่มเขียวแยกด้านนอก ไปเป็นไอคอนเล็กฝังในช่องค้นหาแทน
              // ลดความรก ยังกดสมัครสมาชิกได้เหมือนเดิม (ระบบมีจุดสมัครจุดเดียว ไม่ได้ตัดฟีเจอร์)
              <form onSubmit={handleSearchMember} className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <input type="text" placeholder="เบอร์โทร หรือ รหัสนักศึกษา..." value={searchMemberQuery} onChange={e => setSearchMemberQuery(e.target.value)} className="w-full pl-3 pr-9 py-2 bg-white border border-[#F6C7C7] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150" />
                  <button type="button" onClick={() => setShowRegisterModal(true)} title="สมัครสมาชิกใหม่" className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors duration-150">
                    <UserPlus size={15} />
                  </button>
                </div>
                <button type="submit" disabled={memberLoading} className="px-3 py-2 bg-[#F12B6B] hover:bg-[#FF467E] text-white text-xs font-semibold rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50">{memberLoading ? '...' : 'ค้นหา'}</button>
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
              {/* ⭐️ FIX: ไม่ใช้ inputCls ตรงๆ เพราะมี rounded-xl ฝังอยู่ ต่อ class ซ้อนแบบเดิมไม่การันตี override
                  (ลำดับ class ใน CSS ไม่ตรงกับลำดับใน className) เขียน class ใหม่ทั้งชุดแทนให้ rounded-lg ชัวร์ */}
              <select value={selectedPromoId} onChange={e => setSelectedPromoId(e.target.value ? Number(e.target.value) : '')} className="flex-1 min-w-0 px-3 py-2.5 bg-[#FFF5F7] border border-[#F6C7C7] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150">
                <option value="">-- โปรโมชั่น (ถ้ามี) --</option>
                {promotions.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.discount_type === 'PERCENT' ? `ลด ${p.discount_value}%` : `ลด ฿${p.discount_value}`})</option>)}
              </select>
              <button onClick={handleApplyPromo} disabled={!selectedPromoId || promoLoading} className="px-3 py-2 bg-[#F12B6B] hover:bg-[#FF467E] text-white text-xs font-semibold rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-40">{promoLoading ? '...' : 'ใช้โค้ด'}</button>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-emerald-700">🏷️ {appliedPromo.name} (-฿{appliedPromo.discount_amount.toFixed(2)})</p>
              <button onClick={handleRemovePromo} className="p-1 text-red-400 hover:bg-red-50 rounded-lg transition-colors duration-150"><X size={14} /></button>
            </div>
          )}

          {/* Redeem points */}
          {currentMember && currentMember.points > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
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

          {/* ⭐️ FIX: ปุ่มเลือกวิธีจ่ายเงิน — ปรับให้ตรงกับสไตล์หน้าจอง (rounded-lg แทน rounded-xl, สีตัวอักษร
              ตอนเลือกเงินสดเป็น #FF467E ให้เหมือนกันทั้ง 2 หน้า) */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setPaymentMethod('CASH'); setAmountReceived(''); }} className={`py-2 rounded-lg text-xs font-semibold border-2 transition-all duration-150 ${paymentMethod === 'CASH' ? 'border-[#F12B6B] bg-[#FFF5F7] text-[#FF467E]' : 'border-gray-200 text-gray-400'}`}>💵 เงินสด</button>
            <button onClick={() => { setPaymentMethod('QR'); setAmountReceived(finalTotal); }} className={`py-2 rounded-lg text-xs font-semibold border-2 transition-all duration-150 ${paymentMethod === 'QR' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'}`}>📱 สแกนจ่าย</button>
          </div>

          {/* Cash input or QR */}
          {paymentMethod === 'CASH' ? (
            <div>
              {/* ⭐️ FIX: เดิม readOnly + inputMode="none" บังคับใช้คีย์แพดในแอปเท่านั้น (กิน 4 แถวจอ ทำให้
                  รายการสินค้าด้านบนเหลือพื้นที่น้อยมาก) — เปลี่ยนเป็นพิมพ์ตรงด้วยคีย์บอร์ดตัวเลขของมือถือแทน
                  ปุ่มลัด (10/20/50/100/500/พอดี) — "พอดี" = ใส่ยอดสุทธิเป๊ะ (จ่ายพอดี ไม่ปัดขึ้น) */}
              <input type="number" inputMode="decimal" value={amountReceived} onChange={e => setAmountReceived(e.target.value ? Number(e.target.value) : '')} placeholder="0.00"
                className="w-full text-right text-xl font-bold px-4 py-3 bg-[#FFF5F7] border border-[#F6C7C7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150" />
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {[10, 20, 50, 100, 500].map(v => (
                  <button key={v} onClick={() => setAmountReceived(v)} className="flex-1 min-w-[40px] py-1.5 bg-[#FFF5F7] border border-[#F6C7C7] text-[#F12B6B] font-semibold rounded-lg text-xs hover:bg-[#F12B6B] hover:text-white transition-all duration-150">฿{v}</button>
                ))}
                <button onClick={() => setAmountReceived(finalTotal)} className="flex-1 min-w-[40px] py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold rounded-lg text-xs hover:bg-emerald-500 hover:text-white transition-all duration-150">พอดี</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-blue-800 mb-2">สแกนเพื่อชำระเงิน (PromptPay)</p>
              <div className="bg-white p-2 rounded-lg"><QRCode value={generatePayload(PROMPTPAY_ID, { amount: finalTotal })} size={130} /></div>
              <p className="text-[10px] text-blue-500 mt-2">รบกวนลูกค้าโชว์สลิปหลังโอนสำเร็จ</p>
            </div>
          )}

          {/* Checkout button */}
          {/* ⭐️ F5 — เพิ่ม !!checkoutValidationError เข้าเงื่อนไข disabled (เช่น payment_method ผิด/items ว่าง/quantity ผิดรูปแบบ) */}
          <button onClick={handleCheckout} disabled={cart.length === 0 || loading || !!checkoutValidationError || (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal))}
            className={`w-full py-3.5 rounded-xl text-sm font-bold text-white transition-all duration-150 active:scale-95 flex items-center justify-center gap-2 ${cart.length === 0 || !!checkoutValidationError || (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal)) ? 'bg-gray-300 cursor-not-allowed' : paymentMethod === 'QR' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-[#F12B6B] hover:bg-[#FF467E]'}`}>
            {loading ? 'กำลังประมวลผล...' : <><CheckCircle size={18} /> {paymentMethod === 'QR' ? 'ยืนยันตรวจสอบสลิปแล้ว' : 'ชำระเงิน'}</>}
          </button>
          </div>
        </div>
      </div>

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
                <div className="flex justify-between"><span>วันที่:</span><span>{formatBangkokTime(receiptData.created_at)}</span></div>
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
    </>
  );
}
