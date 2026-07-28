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
import { saveOfflineSale, getOfflineSalesCount, type OfflineSale } from '../utils/offlineSalesDb'; // ⭐️ POS ออฟไลน์
import { syncOfflineSales } from '../utils/syncOfflineSales'; // ⭐️ POS ออฟไลน์
import { ProductGrid } from '../components/pos/ProductGrid';
import { CartPanel } from '../components/pos/CartPanel';
import { RegisterMemberModal } from '../components/pos/RegisterMemberModal';
import { ReceiptModal } from '../components/pos/ReceiptModal';
import { RewardModal } from '../components/pos/RewardModal';

interface Category { id: number; name: string; }
interface Product { id: number; barcode: string; name: string; price: string | number; image_url: string; category_id: number | null; stock?: number; }
// ⭐️ redeem_reward: บรรทัดของรางวัล (ราคา 0, จ่ายด้วยแต้ม) points_required เก็บไว้โชว์
interface CartItem extends Product { quantity: number; redeem_reward?: boolean; points_required?: number; }

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
  const PROMPTPAY_ID = "004666002113797";
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
  // ⭐️ Part 2 — อัตราแลกแต้มเป็นส่วนลด (1 แต้ม = redeemRate บาท) ดึงจาก settings ตอน mount
  const [redeemRate, setRedeemRate] = useState(1);
  const [showRewardModal, setShowRewardModal] = useState(false);
  // ⭐️ POS ออฟไลน์ — จำนวนบิลที่ค้างอยู่ใน IndexedDB รอซิงค์
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);

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
    fetchCategories(); fetchProducts(); fetchPromotions(); fetchStoreInfo(); fetchLoyaltyRate();
    // ⭐️ POS ออฟไลน์ — เช็คคิวค้างตอน mount ด้วย เผื่อรีเฟรชหน้าหลังขายออฟไลน์ไปแล้วแต่ยังไม่ทันซิงค์
    getOfflineSalesCount().then(setPendingOfflineCount).catch(() => {});
  }, [navigate]);

  // ⭐️ POS ออฟไลน์ — พอเน็ตกลับมา (isOnline true) ซิงค์คิวที่ค้างไว้ทั้งหมดเป็น batch เดียว
  useEffect(() => {
    if (!isOnline) return;
    (async () => {
      const summary = await syncOfflineSales();
      if (!summary || summary.attempted === 0) return;
      setPendingOfflineCount(await getOfflineSalesCount());
      fetchProducts(); // ⭐️ รีเฟรชสต๊อกให้ตรงกับ server หลัง sync (สต๊อกฝั่ง client ตอนออฟไลน์เป็นแค่ค่าประมาณ)
      if (summary.synced > 0) {
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `ซิงค์บิลออฟไลน์สำเร็จ ${summary.synced} บิล`, showConfirmButton: false, timer: 2500 });
      }
      if (summary.failed > 0) {
        Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: `ซิงค์บิลออฟไลน์ไม่สำเร็จ ${summary.failed} บิล — ลองใหม่รอบหน้า`, showConfirmButton: false, timer: 3500 });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const fetchStoreInfo = async () => { try { const res = await api.get('/settings/store'); setStoreInfo(res.data); } catch (e) {} };
  // ⭐️ อัตราแลกแต้ม — ให้ preview ฝั่ง client ตรงกับที่ backend คำนวณ (server ยังเป็น authority)
  const fetchLoyaltyRate = async () => { try { const res = await api.get('/settings/loyalty'); setRedeemRate(Number(res.data?.points_redeem_value_per_point) || 1); } catch (e) {} };
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

  // ⭐️ Part 5 — เพิ่มของรางวัลลงตะกร้า (ราคา 0, ธง redeem_reward) กันเพิ่มซ้ำเกิน 1
  const addRewardToCart = (r: { id: number; name: string; image_url: string | null; points_required: number }) => {
    setCart(prev => {
      if (prev.find(i => i.id === r.id && i.redeem_reward)) return prev; // มีอยู่แล้ว
      return [...prev, { id: r.id, name: r.name, image_url: r.image_url || '', price: 0, barcode: '', category_id: null, quantity: 1, redeem_reward: true, points_required: r.points_required }];
    });
  };

  // ⭐️ Sprint 1 — B3: คำนวณยอดเงินทั้งหมดในหน่วยสตางค์ (integer) กัน float drift สะสมข้ามหลายรายการ
  //   ของรางวัลราคา 0 จึงไม่กระทบ grandTotal
  const grandTotalSatang = cart.reduce((t, i) => t + lineTotalSatang(i.price, i.quantity), 0);
  const grandTotal = fromSatang(grandTotalSatang);
  const netTotalSatang = Math.max(0, grandTotalSatang - toSatang(appliedPromo?.discount_amount || 0));
  const netTotal = fromSatang(netTotalSatang);
  // ⭐️ แต้มที่ต้องใช้แลกของรางวัลในบิลนี้ (หักจากแต้มที่ใช้แลกส่วนลดเงินสดได้)
  const rewardPointsUsed = cart.reduce((t, i) => t + (i.redeem_reward ? (Number(i.points_required) || 0) * i.quantity : 0), 0);
  const availableForCash = currentMember ? Math.max(0, currentMember.points - rewardPointsUsed) : 0;
  // ⭐️ แลกส่วนลดเงินสด: 1 แต้ม = redeemRate บาท → จำนวนแต้มสูงสุด = floor(ยอด / redeemRate)
  const maxRedeemable = currentMember ? Math.min(availableForCash, Math.floor(netTotal / redeemRate)) : 0;
  const redeemPointsUsed = currentMember && redeemPoints ? Math.min(Number(redeemPoints), maxRedeemable) : 0;
  const pointsDiscount = fromSatang(toSatang(redeemPointsUsed * redeemRate)); // มูลค่าส่วนลด (บาท)
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
    promotion_id: appliedPromo?.id || null, redeem_points: redeemPointsUsed > 0 ? redeemPointsUsed : 0,
    payment_method: paymentMethod, amount_received: paymentMethod === 'CASH' ? Number(amountReceived) || 0 : finalTotal,
    items: cart.map(i => ({ product_id: i.id, quantity: i.quantity })),
  });
  const checkoutValidationError = validateCheckout(buildCheckoutPayload());

  // ⭐️ POS ออฟไลน์ — บันทึกบิลลง IndexedDB แทนการยิง API (ไม่มีเน็ตยิงไม่ได้อยู่แล้ว) เลียนแบบ flow
  // ตอนขายสำเร็จออนไลน์ทุกอย่าง (ใบเสร็จ + ล้างตะกร้า) ยกเว้นเลขที่บิลจริงที่ต้องรอ sync ก่อนถึงจะมี
  const handleOfflineCheckout = async () => {
    setLoading(true);
    try {
      const clientOfflineId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const amountReceivedNum = paymentMethod === 'CASH' ? Number(amountReceived) : finalTotal;
      const offlineSale: OfflineSale = {
        client_offline_id: clientOfflineId,
        payment_method: paymentMethod,
        amount_received: amountReceivedNum,
        total_amount: finalTotal,
        created_at_offline: nowIso,
        items: cart.map(i => ({ product_id: i.id, quantity: i.quantity, unit_price: Number(i.price) })),
      };
      await saveOfflineSale(offlineSale);
      setPendingOfflineCount(c => c + 1);

      // ⭐️ ลดสต๊อกฝั่ง client ทันทีแค่กันขายเกินสต๊อกที่เห็นในเครื่องเดียวกันระหว่างที่ยังออฟไลน์อยู่ —
      //   ค่าจริงยึดตามเซิร์ฟเวอร์เสมอ ตรวจซ้ำ + ตัดจริงตอน sync
      setProducts(prev => prev.map(p => {
        const cartItem = cart.find(i => i.id === p.id);
        return cartItem ? { ...p, stock: Math.max(0, (p.stock ?? 0) - cartItem.quantity) } : p;
      }));

      setReceiptData({
        sale_id: `OFFLINE-${clientOfflineId.slice(0, 8)}`,
        subtotal: grandTotal,
        discount_amount: 0,
        points_discount: 0,
        points_redeemed: 0,
        total_amount: finalTotal,
        amount_received: amountReceivedNum,
        change_amount: Math.max(0, amountReceivedNum - finalTotal),
        earn_points: 0,
        payment_method: paymentMethod,
        items: cart.map(i => ({ name: i.name, price: Number(i.price), quantity: i.quantity })),
        cashier_name: user.full_name,
        member_name: null,
        promo_name: null,
        created_at: nowIso,
        offline: true,
      });
      setCart([]); setAmountReceived(''); setIsCartOpen(false);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'บันทึกบิลออฟไลน์ไม่สำเร็จ', text: 'กรุณาลองใหม่อีกครั้ง' });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return Swal.fire({ icon: 'warning', title: 'ตะกร้าว่างเปล่า!' });
    if (paymentMethod === 'CASH' && (!amountReceived || Number(amountReceived) < finalTotal)) return Swal.fire({ icon: 'error', title: 'รับเงินมาไม่พอ!' });

    // ⭐️ POS ออฟไลน์ — รองรับเฉพาะบิลง่ายๆ (ไม่มีสมาชิก/โปรโมชั่น/แต้ม/ของรางวัล) เพราะฟีเจอร์พวกนี้
    //   ต้องเช็คยอดจริงกับเซิร์ฟเวอร์ (แต้มคงเหลือ/โควตาโปร/สต๊อกของรางวัล) ซึ่งไม่มีเน็ตเช็คไม่ได้ ถ้าปล่อย
    //   ให้ทำได้จากข้อมูล cache เก่าจะเสี่ยงแลกแต้ม/ใช้โปรเกินสิทธิ์จริงตอน sync ย้อนหลัง
    if (!isOnline) {
      if (currentMember || appliedPromo || redeemPointsUsed > 0 || cart.some(i => i.redeem_reward)) {
        return Swal.fire({
          icon: 'warning',
          title: 'ขายออฟไลน์ไม่รองรับสมาชิก/โปรโมชั่น/แต้ม',
          text: 'กรุณาล้างสมาชิก/โปรโมชั่น/แต้ม/ของรางวัลออกจากบิลก่อน หรือรอเน็ตกลับมาแล้วค่อยขาย',
        });
      }
      return handleOfflineCheckout();
    }

    // ⭐️ F5 — validate ตาม schema เดียวกับ backend ก่อนยิง API จริง กัน payload ผิดรูปแบบหลุดไปถึง server
    if (checkoutValidationError) return Swal.fire({ icon: 'error', title: 'ข้อมูลไม่ถูกต้อง', text: checkoutValidationError });
    setLoading(true);
    try {
      // ⭐️ Sprint 2 — B6: Add 30-second timeout for checkout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await api.post('/sales/checkout', {
        cashier_id: user.id, member_id: currentMember?.id || null,
        promotion_id: appliedPromo?.id || null, redeem_points: redeemPointsUsed > 0 ? redeemPointsUsed : 0,
        payment_method: paymentMethod, amount_received: paymentMethod === 'CASH' ? Number(amountReceived) : finalTotal,
        // ⭐️ ของรางวัลติดธง redeem_reward ให้ backend หักแต้ม+ตั้งราคา 0
        items: cart.map(i => ({ product_id: i.id, quantity: i.quantity, ...(i.redeem_reward ? { redeem_reward: true } : {}) }))
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
      <OfflineBanner isOnline={isOnline} pendingCount={pendingOfflineCount} />

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
      <button onClick={() => setIsCartOpen(true)} className="md:hidden fixed bottom-28 right-4 z-40 w-14 h-14 bg-gradient-to-br from-brand to-brand-dark text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90">
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
        onOpenRewardModal={() => setShowRewardModal(true)}
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

      {showRewardModal && currentMember && (
        <RewardModal
          memberPoints={currentMember.points || 0}
          onClose={() => setShowRewardModal(false)}
          onRedeem={addRewardToCart}
        />
      )}

      <style>{`.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none} @media print{body *{visibility:hidden}#receipt-print-area,#receipt-print-area *{visibility:visible}#receipt-print-area{position:absolute;top:0;left:0;width:80mm;padding:4mm}}`}</style>
      </div>
    </>
  );
}
