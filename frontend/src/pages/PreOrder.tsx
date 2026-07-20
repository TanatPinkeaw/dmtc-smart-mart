import { useState, useEffect } from 'react';
import { ShoppingCart, ShoppingBag, Search } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { useSocket } from '../SocketContext';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { toSatang, fromSatang, lineTotalSatang } from '../utils/money'; // ⭐️ Sprint 1 — B3
import { validatePaymentSlip } from '../utils/fileValidator'; // ⭐️ Sprint 2 — B9
import { PromoPopularRow } from '../components/preorder/PromoPopularRow';
import { ProductGrid } from '../components/preorder/ProductGrid';
import { CartPanel } from '../components/preorder/CartPanel';
import { MyOrdersModal } from '../components/preorder/MyOrdersModal';
import { OrderDetailModal } from '../components/preorder/OrderDetailModal';

interface Category { id: number; name: string; }
interface Product { id: number; name: string; price: string | number; image_url: string; stock: number; category_id: number | null; }
interface CartItem extends Product { quantity: number; }

// ⭐️ ข้อความแจ้งเตือนฝั่งลูกค้าให้เป็นกันเอง แทนการโชว์รหัสสถานะดิบ (PREPARING ฯลฯ)
const CUSTOMER_STATUS_MESSAGE: Record<string, { icon: 'info' | 'success' | 'warning'; text: string }> = {
  PENDING_VERIFY:   { icon: 'info',    text: 'ได้รับออเดอร์แล้ว กำลังตรวจสอบสลิปให้นะ 🧾' },
  WAITING_CASH:     { icon: 'info',    text: 'ยืนยันออเดอร์แล้ว รอชำระเงินสดที่ร้านได้เลย' },
  PREPARING:        { icon: 'info',    text: 'ร้านกำลังจัดเตรียมสินค้าให้คุณอยู่ 🛍️' },
  READY:            { icon: 'success', text: 'สินค้าพร้อมแล้ว มารับที่ร้านได้เลย 🎉' },
  COMPLETED:        { icon: 'success', text: 'รับสินค้าเรียบร้อย ขอบคุณที่ใช้บริการนะ 😊' },
  SLIP_REJECTED:    { icon: 'warning', text: 'สลิปยังไม่ผ่าน รบกวนส่งใหม่อีกครั้งนะ' },
  REFUND_REQUESTED: { icon: 'info',    text: 'กำลังดำเนินการคืนเงินให้คุณอยู่' },
  CANCELLED:        { icon: 'warning', text: 'ออเดอร์นี้ถูกยกเลิกแล้ว' },
};

export default function PreOrder() {
  const socket = useSocket();
  const [products, setProducts] = useState<Product[]>([]);
  const [highlights, setHighlights] = useState<{ popular: Product[]; promo: Product[] }>({ popular: [], promo: [] });
  const [storePromos, setStorePromos] = useState<any[]>([]); // ⭐️ Phase 2 — โปรร้าน (ลดทั้งบิล/BOGO) โชว์แบนเนอร์
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | 'ALL'>('ALL');
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false); // ⭐️ มือถือ: ยุบ/ขยายแผงชำระเงิน (กันจอสั้นล้น)
  const [loading, setLoading] = useState(false);

  // State สำหรับการชำระเงิน
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'QR'>('QR');
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [slipUploadProgress, setSlipUploadProgress] = useState(0); // ⭐️ Sprint 2 — B9
  const [slipDimensions, setSlipDimensions] = useState<{ width: number; height: number } | null>(null); // ⭐️ Sprint 2 — B9
  const [slipProcessing, setSlipProcessing] = useState(false); // ⭐️ กำลังตรวจ/เตรียมสลิป — ล็อกปุ่มยืนยันไว้ก่อน

  // State สำหรับสะสมแต้ม
  const [phoneNumber, setPhoneNumber] = useState('');

  // ⭐️ State สำหรับแลกแต้มเป็นส่วนลด (1 แต้ม = ฿1) — pattern เดียวกับ POS.tsx
  const [myPoints, setMyPoints] = useState(0);
  const [redeemPoints, setRedeemPoints] = useState<number | ''>('');
  const [phoneVerified, setPhoneVerified] = useState<any>(null); // ผลตรวจเบอร์ (แสดงชื่อ+แต้มยืนยัน)
  const [verifying, setVerifying] = useState(false);

  const PROMPTPAY_ID = "0803610120"; // 👈 เบอร์พร้อมเพย์ร้าน
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2

  const [showMyOrders, setShowMyOrders] = useState(false);
  const [myOrders, setMyOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null); // ✅ CHANGED: modal order detail
  const [refundReason, setRefundReason] = useState(''); // ✅ CHANGED: refund reason input

  useEffect(() => {
    fetchProducts();
    fetchMyPoints();

    if (!socket) return;

    let debounceTimer: ReturnType<typeof setTimeout>;

    // ⭐️ realtime สต๊อก: เวลามีคนอื่นซื้อ/แอดมินตัดสต๊อก ให้รีเฟรชรายการสินค้าใหม่ทันที
    // debounce ไว้กันกรณี event ยิงรัวๆ (เช่นหลายรายการโดนตัดพร้อมกัน)
    socket.on('stock_updated', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchProducts, 300);
    });

    // ⭐️ WebSocket ฟังเสียงสวรรค์ (เวลามีอัปเดตสถานะจากพนักงาน)
    socket.on(`order_update_user_${user.id}`, (data) => {
      // ⭐️ แปลงรหัสสถานะเป็นข้อความเป็นกันเอง แทนโชว์ PREPARING/READY ดิบๆ
      const msg = CUSTOMER_STATUS_MESSAGE[data.status] || { icon: 'info' as const, text: 'ออเดอร์ของคุณมีการอัปเดต' };
      const isReject = data.status === 'SLIP_REJECTED';
      // ⭐️ แตะที่แจ้งเตือน → เด้งเข้าออเดอร์นั้นทันที (โดยเฉพาะ SLIP_REJECTED จะเห็นปุ่มส่งสลิปใหม่เลย)
      Swal.fire({
        toast: true, position: 'top-end', icon: msg.icon,
        title: msg.text,
        text: `ออเดอร์ #${data.order_id} • ${isReject ? '👉 แตะเพื่อส่งสลิปใหม่' : '👉 แตะเพื่อดู'}`,
        showConfirmButton: false,
        timer: isReject ? 8000 : 4500,
        timerProgressBar: true,
        didOpen: (el) => {
          el.style.cursor = 'pointer';
          el.addEventListener('click', () => { Swal.close(); openMyOrder(data.order_id); });
        },
      });
    });
    socket.on(`notification_user_${user.id}`, (data) => {
      Swal.fire({ icon: 'warning', title: 'แจ้งเตือนจากร้านค้า', text: data.message });
    });

    return () => {
      clearTimeout(debounceTimer);
      socket.off('stock_updated');
      socket.off(`order_update_user_${user.id}`);
      socket.off(`notification_user_${user.id}`);
    };
  }, [user.id, socket]);

  const fetchProducts = async () => {
    try {
      const [prodRes, catRes] = await Promise.all([api.get('/products'), api.get('/categories')]);
      const fresh: Product[] = prodRes.data;
      setProducts(fresh.filter((p) => p.stock > 0));
      setCategories(catRes.data);

      // ⭐️ ไฮไลต์ (ยอดนิยม/โปร) = ไม่ critical — แยกออกมา ถ้า backend ยังไม่มี endpoint (404) หรือพลาด
      // จะได้ "ไม่ทำให้รายการสินค้าทั้งหน้าหายไป" (เดิมรวมใน Promise.all เดียวกัน พอ 404 = จอว่างทั้งหน้า)
      try {
        const hlRes = await api.get('/products/highlights');
        setHighlights({
          popular: (hlRes.data.popular || []).filter((p: Product) => p.stock > 0),
          promo: (hlRes.data.promo || []).filter((p: Product) => p.stock > 0),
        });
      } catch {
        setHighlights({ popular: [], promo: [] });
      }
      // ⭐️ Phase 2 — โปรร้าน (ลดทั้งบิล/BOGO) — non-critical เช่นกัน
      try {
        const prRes = await api.get('/promotions/active');
        setStorePromos(prRes.data || []);
      } catch {
        setStorePromos([]);
      }

      // ⭐️ sync ตะกร้ากับสต๊อกล่าสุด กันข้อมูลเพี้ยน (สินค้าหมด/สต๊อกลดระหว่างที่ลูกค้ากำลังเลือกอยู่)
      setCart((prevCart) => {
        let changed = false;
        const nextCart = prevCart
          .map((item) => {
            const latest = fresh.find((p) => p.id === item.id);
            if (!latest || latest.stock <= 0) { changed = true; return null; }
            if (item.quantity > latest.stock) { changed = true; return { ...item, stock: latest.stock, quantity: latest.stock }; }
            if (item.stock !== latest.stock) { changed = true; return { ...item, stock: latest.stock }; }
            return item;
          })
          .filter((item): item is CartItem => item !== null);

        if (changed) {
          Swal.fire({
            toast: true, position: 'top-end', icon: 'warning',
            title: 'สต๊อกสินค้าบางรายการมีการเปลี่ยนแปลง ระบบปรับตะกร้าให้อัตโนมัติ',
            showConfirmButton: false, timer: 2500
          });
        }
        return nextCart;
      });
    } catch (e) { console.error(e); }
  };

  // 🐛 FIX (Sprint 0 — A2) — เดิมใช้ /api/users/search (staff-only, ค้นข้ามคนได้ + คืนแต้ม/เบอร์โทร
  // เต็มๆ) มายืนยันเบอร์โทรก่อนสั่งจอง ทำให้ MEMBER โดน 403 ทุกครั้งที่กด "ยืนยันเบอร์" — เปลี่ยนไปใช้
  // POST /api/users/verify-phone ที่เปิดให้ทุก role เรียกได้ และคืนข้อมูลน้อยกว่ามาก (แค่ matched +
  // ชื่อ ไม่มีแต้ม ไม่มีเบอร์คนอื่น) กันไม่ให้เป็นช่องทาง enumerate ข้อมูลสมาชิกคนอื่นเหมือน endpoint เดิม
  const handleVerifyPhone = async () => {
    if (!phoneNumber.trim()) return Swal.fire({ icon: 'warning', title: 'กรุณากรอกเบอร์โทรก่อน' });
    setVerifying(true);
    try {
      const res = await api.post('/users/verify-phone', { phone_number: phoneNumber.trim() });
      if (res.data.matched) {
        setPhoneVerified(res.data);
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `พบสมาชิก: ${res.data.member_name}`, showConfirmButton: false, timer: 2500 });
      } else {
        setPhoneVerified(null);
        Swal.fire({ icon: 'error', title: 'ไม่พบสมาชิก', text: 'ไม่พบเบอร์นี้ในระบบ (แต้มจะสะสมให้เมื่อเบอร์ตรงกับบัญชีสมาชิก)' });
      }
    } catch (e: any) {
      setPhoneVerified(null);
      Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: getErrorMessage(e) });
    } finally { setVerifying(false); }
  };

  const fetchMyPoints = async () => {
    if (!user.id) return;
    try {
      const res = await api.get('/users/me');
      setMyPoints(res.data.points || 0);
    } catch (e) {
      setMyPoints(0);
    }
  };

  // ⭐️ ล้างแต้มที่แลกไว้ถ้าตะกร้าว่าง (กันเผลอแลกแต้มค้างจากตะกร้ารอบก่อน)
  useEffect(() => {
    if (cart.length === 0 && redeemPoints) setRedeemPoints('');
  }, [cart.length]);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'สต๊อกไม่พอ!', showConfirmButton: false, timer: 1500 });
          return prev;
        }
        return prev.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart((prev) => prev.map(item => {
      if (item.id === id) {
        const newQ = item.quantity + delta;
        if (newQ > item.stock) { Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: 'สินค้าหมดสต๊อกแค่นี้', showConfirmButton: false, timer: 1500 }); return item; }
        return { ...item, quantity: newQ };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  // ⭐️ Sprint 2 — B9: Validate payment slip before upload
  const handleSlipChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSlipProcessing(true); // ⭐️ ล็อกปุ่มยืนยันระหว่างตรวจ/เตรียมสลิป
    try {
      // Validate
      const validation = await validatePaymentSlip(file);
      if (!validation.valid) {
        Swal.fire('Invalid File', validation.error, 'warning');
        e.target.value = ''; // Reset input
        setSlipFile(null); setSlipPreview(null); setSlipDimensions(null);
        return;
      }

      setSlipFile(file);
      setSlipDimensions(validation.dimensions || null);

      // Show preview
      const reader = new FileReader();
      reader.onload = (event) => {
        setSlipPreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    } finally {
      setSlipProcessing(false);
    }
  };

  // ⭐️ Sprint 2 — B9: Upload payment slip to specific order
  const handleUploadSlip = async (orderId: number) => {
    if (!slipFile) return;

    const formData = new FormData();
    formData.append('slip', slipFile);

    try {
      await api.post(`/orders/${orderId}/upload-slip`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded / progressEvent.total!) * 100);
          setSlipUploadProgress(percent);
        }
      });

      Swal.fire('Success', `Payment slip uploaded (${slipDimensions?.width}×${slipDimensions?.height})`, 'success');
    } catch (err: any) {
      Swal.fire('Upload Failed', err.response?.data?.error || 'Unknown error', 'error');
      throw err; // Re-throw to handle in handleCheckout
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (paymentMethod === 'QR' && !slipFile) return Swal.fire({ icon: 'warning', text: 'กรุณาแนบสลิปการโอนเงินก่อนยืนยันออเดอร์ครับ' });

    setLoading(true);
    try {
      // 1. สั่งสร้างออเดอร์
      const payload = {
        items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })),
        payment_method: paymentMethod,
        slip_image: null, // ⭐️ Sprint 2 — B9: Upload slip separately after order creation
        use_phone_for_points: phoneNumber.trim().length >= 9, // ถ้ากรอกเบอร์มา ถือว่าสะสมแต้ม
        redeem_points: pointsDiscount > 0 ? pointsDiscount : 0 // 👈 แต้มที่จะแลกเป็นส่วนลด
      };

      const orderRes = await api.post('/orders', payload);
      const orderId = orderRes.data.id || orderRes.data.order_id;

      // 2. ⭐️ Sprint 2 — B9: Upload payment slip to the created order (if QR payment)
      if (paymentMethod === 'QR' && slipFile) {
        await handleUploadSlip(orderId);
      }

      Swal.fire({
        icon: 'success', title: 'ส่งออเดอร์สำเร็จ! 🎉',
        text: (paymentMethod === 'QR' ? 'สลิปอัปโหลดสำเร็จ กรุณารอพนักงานตรวจสอบสักครู่นะครับ' : 'กรุณานำเงินสดมาชำระที่หน้าร้านได้เลยครับ')
          + (pointsDiscount > 0 ? ` (ใช้แต้มลดไปแล้ว ${pointsDiscount} บาท)` : '')
      });

      // รีเซ็ตค่าทั้งหมด
      setCart([]); setSlipFile(null); setSlipPreview(null); setSlipUploadProgress(0); setSlipDimensions(null); setPhoneNumber(''); setRedeemPoints(''); setIsCartOpen(false);
      fetchProducts(); // ดึงสต๊อกใหม่
      fetchMyPoints(); // ⭐️ แต้มถูกหักไปแล้วถ้ามีการแลก ต้องดึงยอดคงเหลือใหม่
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: error.response?.data?.error || 'ไม่สามารถสั่งซื้อได้' });
    } finally {
      setLoading(false);
    }
  };

  const fetchMyOrders = async () => {
    try {
      const res = await api.get(`/orders?t=${Date.now()}`);
      setMyOrders(res.data);
    } catch (err) { console.error(err); }
  };

  // ⭐️ เปิดออเดอร์เจาะจง (จากการกดแจ้งเตือน) → เด้งเข้า modal รายละเอียดเลย
  // ถ้าออเดอร์เป็น SLIP_REJECTED จะเห็นปุ่ม "แตะเพื่อส่งสลิปใหม่" ทันที ไม่ต้องหาเอง
  const openMyOrder = async (orderId: number) => {
    try {
      const res = await api.get(`/orders?t=${Date.now()}`);
      setMyOrders(res.data);
      const found = (res.data || []).find((o: any) => Number(o.id) === Number(orderId));
      if (found) { setSelectedOrder(found); setRefundReason(''); }
      else setShowMyOrders(true);
    } catch (err) { console.error(err); setShowMyOrders(true); }
  };

  // ✅ CHANGED: accept refund reason from modal input
  const handleCancelMyOrder = async (order: any, reason: string) => {
    if (!reason.trim()) {
      Swal.fire({ icon: 'warning', title: 'ต้องระบุเหตุผล', text: 'กรุณาใส่เหตุผลการยกเลิกออเดอร์' });
      return;
    }

    try {
      await api.put(`/orders/${order.id}/cancel-by-user`, { refund_info: reason });
      Swal.fire({ icon: 'success', title: 'ยกเลิกออเดอร์สำเร็จ', showConfirmButton: false, timer: 1500 });
      setSelectedOrder(null); // ✅ CHANGED: close modal
      setRefundReason(''); // ✅ CHANGED: reset input
      fetchMyOrders();
      fetchProducts();
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) });
    }
  };

  // ⭐️ Sprint 1 — B3: บวกยอดตะกร้าในหน่วยสตางค์ (integer) กัน float drift สะสมข้ามหลายรายการ
  const grandTotalSatang = cart.reduce((total, item) => total + lineTotalSatang(item.price, item.quantity), 0);
  const grandTotal = fromSatang(grandTotalSatang);

  // ⭐️ ส่วนลดจากแต้ม (1 แต้ม = ฿1) ห้ามเกินแต้มที่มี และห้ามเกินยอดที่ต้องจ่าย (cap เหมือนฝั่ง backend)
  const maxRedeemable = Math.min(myPoints, Math.floor(grandTotal));
  const pointsDiscount = redeemPoints ? Math.min(Number(redeemPoints), maxRedeemable) : 0;
  const finalTotal = fromSatang(Math.max(0, grandTotalSatang - toSatang(pointsDiscount)));

  return (
    <div className="flex h-screen bg-brand-bg font-sans relative">
      {/* ================= ฝั่งซ้าย: เลือกสินค้า ================= */}
      <div className="w-full md:w-2/3 flex flex-col h-full">
        {/* ⭐️ FIX: ปรับ header ให้เหมือนหน้า POS — แถวเดียว icon box + title ซ้าย ปุ่มขวา ไม่ค่อยสตัดเป็น 2 บรรทัด */}
        <div className="bg-gradient-to-r from-brand to-brand-dark px-4 py-3.5 flex justify-between items-center shrink-0 shadow-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <ShoppingBag size={16} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-white truncate">สั่งจองสินค้า (Pre-order)</h1>
          </div>
          {/* ⭐️ ปุ่มกดดูประวัติของตัวเอง */}
          <button onClick={() => { setShowMyOrders(true); fetchMyOrders(); }} className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-white bg-white/15 border border-white/20 hover:bg-white/25 px-3 py-1.5 rounded-full transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
            ประวัติของฉัน
          </button>
        </div>

        <div className="flex-1 p-4 md:p-6 overflow-y-auto pb-24 md:pb-6">
          {/* ⭐️ ค้นหา */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            {/* ⭐️ FIX: เดิม border-none กลืนกับพื้นหลัง เพิ่มกรอบให้เหมือนช่องค้นหาหน้า POS */}
            <input type="text" placeholder="ค้นหาสินค้า..." value={productSearch} onChange={e => setProductSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-brand-bg border border-brand-border rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150" />
          </div>

          <PromoPopularRow
            selectedCategory={selectedCategory}
            productSearch={productSearch}
            storePromos={storePromos}
            highlights={highlights}
            onAddToCart={addToCart}
          />

          <ProductGrid
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            products={products}
            productSearch={productSearch}
            onAddToCart={addToCart}
          />
        </div>
      </div>

      {/* ⭐️ FIX: เดิม bottom-6 ทับ bottom nav bar (h-14 + z-50) เพราะปุ่มนี้ z-40 ต่ำกว่า — เปลี่ยนเป็น
          bottom-20 ให้ตรงกับปุ่มลอยหน้าอื่น (POS.tsx, Inventory.tsx) ที่แก้ถูกไว้แล้ว */}
      <button onClick={() => setIsCartOpen(true)} className="md:hidden fixed bottom-20 right-4 bg-brand text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-40 hover:bg-brand-dark active:scale-90 transition">
        <ShoppingCart size={24} />
        {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-6 h-6 flex items-center justify-center rounded-full border-2 border-white">{cart.reduce((a, c) => a + c.quantity, 0)}</span>}
      </button>

      <CartPanel
        isCartOpen={isCartOpen}
        onCloseCart={() => setIsCartOpen(false)}
        payOpen={payOpen}
        onTogglePay={() => setPayOpen(v => !v)}
        cart={cart}
        onUpdateQuantity={updateQuantity}
        grandTotal={grandTotal}
        pointsDiscount={pointsDiscount}
        finalTotal={finalTotal}
        phoneNumber={phoneNumber}
        onPhoneNumberChange={(value) => { setPhoneNumber(value); setPhoneVerified(null); }}
        phoneVerified={phoneVerified}
        verifying={verifying}
        onVerifyPhone={handleVerifyPhone}
        myPoints={myPoints}
        maxRedeemable={maxRedeemable}
        redeemPoints={redeemPoints}
        onRedeemPointsChange={setRedeemPoints}
        paymentMethod={paymentMethod}
        onSetPaymentMethod={setPaymentMethod}
        promptpayId={PROMPTPAY_ID}
        slipFile={slipFile}
        slipPreview={slipPreview}
        slipDimensions={slipDimensions}
        slipUploadProgress={slipUploadProgress}
        slipProcessing={slipProcessing}
        onSlipChange={handleSlipChange}
        onClearSlip={() => { setSlipFile(null); setSlipPreview(null); setSlipDimensions(null); }}
        onCheckout={handleCheckout}
        loading={loading}
      />

      {/* ⭐️ Modal ประวัติออเดอร์ของลูกค้า */}
      {showMyOrders && (
        <MyOrdersModal
          myOrders={myOrders}
          onClose={() => setShowMyOrders(false)}
          onSelectOrder={(order) => { setSelectedOrder(order); setRefundReason(''); setShowMyOrders(false); }}
        />
      )}

      {/* ✅ CHANGED: new order detail modal - refactored UI */}
      {selectedOrder && (
        <OrderDetailModal
          selectedOrder={selectedOrder}
          refundReason={refundReason}
          onRefundReasonChange={setRefundReason}
          onClose={() => setSelectedOrder(null)}
          onCancelOrder={handleCancelMyOrder}
          fetchMyOrders={fetchMyOrders}
        />
      )}
    </div>
  );
}
