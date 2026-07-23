// ✅ CHANGED: colors, layout → DMTC Mart theme (#F12B6B primary)
// 🔒 UNCHANGED: all handlers (handleCheckout, handleSearchMember, handleRegister, handleApplyPromo, handleCloseShift, finishAndLogout), socket listeners, all state, filteredProducts, price calculations

import { useState, useEffect } from 'react';
import { ShoppingCart, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Swal from '../swal';
import { BRAND } from '../theme';
import { useSocket } from '../SocketContext';
import { validateCheckout, type CheckoutPayload } from '../validators/checkoutValidator'; // ⭐️ F5
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { toSatang, fromSatang, lineTotalSatang } from '../utils/money'; // ⭐️ Sprint 1 — B3
import { useOnlineStatus } from '../hooks/useOnlineStatus'; // ⭐️ Sprint 2 — B6
import OfflineBanner from '../components/OfflineBanner'; // ⭐️ Sprint 2 — B6
import { ProductGrid } from '../components/pos/ProductGrid';
import { CartPanel } from '../components/pos/CartPanel';
import { RegisterMemberModal } from '../components/pos/RegisterMemberModal';
import { ReceiptModal } from '../components/pos/ReceiptModal';

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
  const [storePromos, setStorePromos] = useState<any[]>([]); // ⭐️ Phase 2 — โปรร้าน (ลดทั้งบิล/BOGO) โชว์แบนเนอร์
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
    // ⭐️ Security remediation — token ย้ายไป httpOnly cookie อ่านจาก JS ไม่ได้แล้ว
    // getCurrentUserOrRedirect() ข้างบนเด้งไป /login ให้แล้วถ้าไม่มี user session
    if (localStorage.getItem('session_mode') === 'shop') { navigate('/pre-order'); return; }
    fetchCategories(); fetchProducts(); fetchPromotions(); fetchStoreInfo();
  }, [navigate]);

  const fetchStoreInfo = async () => { try { const res = await api.get('/settings/store'); setStoreInfo(res.data); } catch (e) {} };
  const fetchPromotions = async () => {
    try { const res = await api.get('/promotions'); setPromotions(res.data); } catch (e) {}
    try { const r = await api.get('/promotions/active'); setStorePromos(r.data || []); } catch (e) {}
  };

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
            <div class="text-left mt-2.5">
              <table class="w-full text-[13px] border-collapse">
                <tbody>
                  ${issues.map(issue => `
                    <tr class="border-b border-gray-300">
                      <td class="py-1.5 px-1.5 font-bold text-brand">${issue.product_name}</td>
                      <td class="py-1.5 px-1.5 text-right">
                        <span class="text-red-500">ขอ: ${issue.requested}</span> |
                        <span class="text-emerald-500">มี: ${issue.available}</span>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `,
          confirmButtonText: 'แก้ไขตะกร้า',
          confirmButtonColor: BRAND
        });
      }
      // ⭐️ Sprint 2 — B7: Handle 409 race condition
      else if (error.response?.status === 409) {
        Swal.fire({
          icon: 'error',
          title: 'ขัดแย้ง',
          text: 'สต๊อกถูกแก้ไขโดยระบบอื่นพร้อมกัน กรุณาลองใหม่ (หน้าจะโหลดข้อมูลใหม่)',
          confirmButtonText: 'โหลดใหม่',
          confirmButtonColor: BRAND,
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

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ⭐️ Sprint 2 — B6: Offline Banner */}
      <OfflineBanner isOnline={isOnline} />

      <div className="flex h-full bg-brand-bg relative">

      {/* ── Left: Products ─────────────────────────────────────────────────── */}
      <div className="w-full md:w-3/5 flex flex-col h-full">
        {/* Header */}
        <div className="bg-gradient-to-r from-brand to-brand-dark px-4 py-3.5 flex justify-between items-center shrink-0 shadow-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
              <ShoppingCart size={16} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-white">POS ขายสินค้า</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-white bg-white/15 border border-white/20 px-3 py-1.5 rounded-full">
              <User size={13} /> {user.full_name || 'CASHIER'}
            </span>
            {/* ⭐️ FIX: ปุ่มปิดกะเดิมอยู่ตรงนี้ด้วย — ตามคำขอผู้ใช้ ย้ายให้เหลือจุดเดียวที่หน้า Dashboard */}
          </div>
        </div>

        <ProductGrid
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          storePromos={storePromos}
          productSearchQuery={productSearchQuery}
          onSearchChange={setProductSearchQuery}
          filteredProducts={filteredProducts}
          priceOverride={priceOverride}
          onPriceOverrideChange={(productId, value) => setPriceOverride({ ...priceOverride, [productId]: value })}
          onAddToCart={addToCart}
        />
      </div>

      {/* ── Mobile cart FAB ───────────────────────────────────────────────── */}
      <button onClick={() => setIsCartOpen(true)} className="md:hidden fixed bottom-20 right-4 z-40 w-14 h-14 bg-brand hover:bg-brand-dark text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90">
        <ShoppingCart size={22} />
        {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white">{cart.reduce((a, c) => a + c.quantity, 0)}</span>}
      </button>

      <CartPanel
        isCartOpen={isCartOpen}
        onCloseCart={() => setIsCartOpen(false)}
        payOpen={payOpen}
        onTogglePay={() => setPayOpen(v => !v)}
        cart={cart}
        products={products}
        onUpdateQuantity={updateQuantity}
        currentMember={currentMember}
        onClearMember={() => { setCurrentMember(null); setSearchMemberQuery(''); }}
        searchMemberQuery={searchMemberQuery}
        onSearchMemberQueryChange={setSearchMemberQuery}
        memberLoading={memberLoading}
        onSearchMember={handleSearchMember}
        onOpenRegisterModal={() => setShowRegisterModal(true)}
        promotions={promotions}
        selectedPromoId={selectedPromoId}
        onSelectPromoId={setSelectedPromoId}
        appliedPromo={appliedPromo}
        promoLoading={promoLoading}
        onApplyPromo={handleApplyPromo}
        onRemovePromo={handleRemovePromo}
        maxRedeemable={maxRedeemable}
        redeemPoints={redeemPoints}
        onRedeemPointsChange={setRedeemPoints}
        grandTotal={grandTotal}
        pointsDiscount={pointsDiscount}
        finalTotal={finalTotal}
        paymentMethod={paymentMethod}
        onSetPaymentMethod={setPaymentMethod}
        amountReceived={amountReceived}
        onAmountReceivedChange={setAmountReceived}
        promptpayId={PROMPTPAY_ID}
        onCheckout={handleCheckout}
        loading={loading}
        checkoutDisabled={cart.length === 0 || loading || !!checkoutValidationError || (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal))}
      />

      {showRegisterModal && (
        <RegisterMemberModal
          regForm={regForm}
          onRegFormChange={setRegForm}
          regLoading={regLoading}
          onSubmit={handleRegister}
          onClose={() => setShowRegisterModal(false)}
        />
      )}

      {receiptData && (
        <ReceiptModal
          receiptData={receiptData}
          storeInfo={storeInfo}
          onClose={() => setReceiptData(null)}
        />
      )}

      <style>{`.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none} @media print{body *{visibility:hidden}#receipt-print-area,#receipt-print-area *{visibility:visible}#receipt-print-area{position:absolute;top:0;left:0;width:80mm;padding:4mm}}`}</style>
      </div>
    </>
  );
}
