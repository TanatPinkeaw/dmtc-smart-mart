import { useState, useEffect } from 'react';
import { ShoppingCart, ShoppingBag, Plus, Minus, CheckCircle, PackagePlus, Upload, X, Image as ImageIcon, Search, ChevronUp, ChevronDown } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import generatePayload from 'promptpay-qr';
import QRCode from 'react-qr-code';
import { useSocket } from '../SocketContext';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { toSatang, fromSatang, lineTotalSatang } from '../utils/money'; // ⭐️ Sprint 1 — B3
import { formatBangkokTime } from '../utils/timezone'; // ⭐️ Sprint 2 — B8
import { validatePaymentSlip } from '../utils/fileValidator'; // ⭐️ Sprint 2 — B9
import AuthImage from '../components/AuthImage'; // ⭐️ SECURITY FIX #1 — โหลดสลิปผ่าน JWT

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

// ⭐️ Construct slip image path from created_at date + filename
// รูปใหม่เก็บเป็น URL/พาธเต็ม (https://cloudinary... หรือ /uploads/...) → คืนตรงๆ
// รูปเก่าเก็บเป็นชื่อไฟล์ล้วน → ประกอบพาธจากวันที่เหมือนเดิม
function getSlipImagePath(createdAt: string, filename: string): string {
  if (!filename) return '';
  if (/^https?:\/\//i.test(filename) || filename.startsWith('/')) return filename;
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `/uploads/slips/${year}-${month}-${day}/${filename}`;
}

export default function PreOrder() {
  const socket = useSocket();
  const [products, setProducts] = useState<Product[]>([]);
  const [highlights, setHighlights] = useState<{ popular: Product[]; promo: Product[] }>({ popular: [], promo: [] });
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
        <div className="bg-white border-b border-brand-border px-4 py-3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 bg-brand rounded-lg flex items-center justify-center shrink-0">
              <ShoppingBag size={15} className="text-white" />
            </div>
            <h1 className="text-base font-bold text-gray-900 truncate">สั่งจองสินค้า (Pre-order)</h1>
          </div>
          {/* ⭐️ ปุ่มกดดูประวัติของตัวเอง */}
          <button onClick={() => { setShowMyOrders(true); fetchMyOrders(); }} className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-brand bg-brand-bg border border-brand-border hover:bg-brand-border px-3 py-1.5 rounded-full transition-colors duration-150">
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

          {/* ⭐️ ไฮไลต์: สินค้ามีโปร + ยอดนิยม (โชว์เฉพาะตอน browse ปกติ ไม่ค้นหา/ไม่กรองหมวด) */}
          {selectedCategory === 'ALL' && !productSearch && (highlights.promo.length > 0 || highlights.popular.length > 0) && (
            <div className="space-y-4 mb-4">
              {highlights.promo.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-amber-600 mb-2 flex items-center gap-1.5">🏷️ สินค้ามีโปร <span className="text-[10px] font-normal text-gray-400">(ใกล้หมดอายุ ลดราคา)</span></h3>
                  <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                    {highlights.promo.map(p => (
                      <div key={`promo-${p.id}`} onClick={() => addToCart(p)} className="shrink-0 w-28 bg-white border border-amber-200 rounded-xl p-2 cursor-pointer hover:shadow-sm active:scale-95 transition relative">
                        <span className="absolute top-1 left-1 z-10 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">-{(p as any).discount_percent || 40}%</span>
                        <div className="w-full aspect-square bg-brand-bg rounded-lg mb-1 flex items-center justify-center overflow-hidden">
                          {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <PackagePlus size={22} className="text-brand-mid opacity-50" />}
                        </div>
                        <p className="text-[11px] font-medium text-gray-800 line-clamp-1">{p.name}</p>
                        <p className="text-xs font-bold text-brand">฿{Number(p.price).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {highlights.popular.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1.5">🔥 สินค้ายอดนิยม</h3>
                  <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                    {highlights.popular.map((p, i) => (
                      <div key={`pop-${p.id}`} onClick={() => addToCart(p)} className="shrink-0 w-28 bg-white border border-brand-border rounded-xl p-2 cursor-pointer hover:shadow-sm active:scale-95 transition relative">
                        <span className="absolute top-1 left-1 z-10 bg-brand text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{i + 1}</span>
                        <div className="w-full aspect-square bg-brand-bg rounded-lg mb-1 flex items-center justify-center overflow-hidden">
                          {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <PackagePlus size={22} className="text-brand-mid opacity-50" />}
                        </div>
                        <p className="text-[11px] font-medium text-gray-800 line-clamp-1">{p.name}</p>
                        <p className="text-xs font-bold text-brand">฿{Number(p.price).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ⭐️ FIX: หมวดหมู่ — ใส่กรอบขาวรอบแท็บให้ดูเป็นกล่องแยกชัดเจน (เหมือนหน้า POS) เดิมลอยอยู่บนพื้น
              ชมพูเฉยๆ กลืนกับพื้นหลัง มองไม่ออกว่าเป็นส่วนควบคุมแยก + ยังคง fade gradient บอกว่าเลื่อนได้ */}
          <div className="relative bg-white border border-brand-border rounded-xl p-2.5 mb-4 shadow-sm">
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              <button onClick={() => setSelectedCategory('ALL')} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition ${selectedCategory === 'ALL' ? 'bg-brand text-white' : 'bg-brand-bg text-brand hover:bg-brand-border'}`}>ทั้งหมด</button>
              {categories.map(c => (
                <button key={c.id} onClick={() => setSelectedCategory(c.id)} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition ${selectedCategory === c.id ? 'bg-brand text-white' : 'bg-brand-bg text-brand hover:bg-brand-border'}`}>{c.name}</button>
              ))}
            </div>
            <div className="pointer-events-none absolute right-2.5 top-2.5 bottom-2.5 w-8 bg-gradient-to-l from-white to-transparent rounded-r-xl" />
          </div>

          {(() => {
            const filtered = products
              .filter(p => selectedCategory === 'ALL' || p.category_id === selectedCategory)
              .filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()));
            return (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {filtered.map((product) => (
              // ⭐️ FIX: เปลี่ยนการ์ดให้เหมือนหน้า POS ทั้งหมด — ขนาด/ระยะห่างเท่ากัน + มีปุ่ม "เพิ่มลงตะกร้า"
              // ชัดเจนแทนการต้องแตะทั้งการ์ด (ปุ่มมี stopPropagation กัน addToCart ยิงซ้อน 2 ครั้งตอนกดปุ่ม)
              <div key={product.id} onClick={() => addToCart(product)} className="bg-white border border-brand-border rounded-xl p-3 transition-all duration-150 flex flex-col items-center cursor-pointer hover:border-brand-mid hover:shadow-sm active:scale-95 h-full">
                <div className="w-full aspect-square bg-brand-bg rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                  {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <PackagePlus size={28} className="text-brand-mid opacity-50" />}
                </div>
                <p className="text-xs font-medium text-gray-800 text-center line-clamp-2 mb-1">{product.name}</p>

                <div className="w-full flex justify-between items-end mb-1 gap-1 mt-auto">
                  <p className="text-sm font-bold text-brand">฿{Number(product.price).toFixed(2)}</p>
                  <p className="shrink-0 text-[10px] bg-brand-bg text-brand px-1.5 py-0.5 rounded-md font-bold">เหลือ {product.stock}</p>
                </div>

                <button
                  onClick={(e) => { e.stopPropagation(); addToCart(product); }}
                  className="w-full py-1 rounded text-xs font-medium bg-brand text-white hover:bg-brand-dark active:scale-95 transition-colors duration-150"
                >
                  เพิ่มลงตะกร้า
                </button>
              </div>
            ))}
          </div>
            ); // end return
          })()} {/* end IIFE */}
        </div>
      </div>

      {/* ⭐️ FIX: เดิม bottom-6 ทับ bottom nav bar (h-14 + z-50) เพราะปุ่มนี้ z-40 ต่ำกว่า — เปลี่ยนเป็น
          bottom-20 ให้ตรงกับปุ่มลอยหน้าอื่น (POS.tsx, Inventory.tsx) ที่แก้ถูกไว้แล้ว */}
      <button onClick={() => setIsCartOpen(true)} className="md:hidden fixed bottom-20 right-4 bg-brand text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-40 hover:bg-brand-dark active:scale-90 transition">
        <ShoppingCart size={24} />
        {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-6 h-6 flex items-center justify-center rounded-full border-2 border-white">{cart.reduce((a, c) => a + c.quantity, 0)}</span>}
      </button>

      {/* ================= ฝั่งขวา: ตะกร้าและชำระเงิน ================= */}
      {/* ⭐️ FIX: z-50 เดิมชนกับ bottom nav (z-50) เหมือน modal รายละเอียดออเดอร์ — ยกเป็น z-[60] ให้เหนือ nav
          แน่นอน (ตรงกับ z-[60] ที่ตะกร้าหน้า POS ใช้อยู่แล้ว) */}
      <div className={`${isCartOpen ? 'fixed inset-0 z-[60] flex animate-fade-in' : 'hidden'} md:flex md:relative md:w-1/3 flex-col bg-white border-l border-brand-border shadow-xl`}>
        <div className="p-4 bg-brand text-white flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2"><ShoppingCart size={20} /> ตะกร้าของฉัน</h2>
          <button onClick={() => setIsCartOpen(false)} className="md:hidden p-1 bg-brand-dark rounded-lg hover:bg-brand-dark"><X size={20} /></button>
        </div>

        {/* รายการในตะกร้า */}
        <div className="flex-1 overflow-y-auto p-4 bg-brand-bg space-y-3">
          {cart.length === 0 ? (
            // ⭐️ FIX: เดิม h-full ยืดเต็มพื้นที่ scroll ทำให้กล่องว่างดูสูงเกินไป เปลี่ยนเป็น min-h คงที่แทน
            // ⭐️ FIX: ลดต่ออีก 220px ยังดูสูงเกินไปเมื่อเทียบกับแผงชำระเงินด้านล่างที่กระชับแล้ว ย่อเหลือ 100px + ไอคอนเล็กลง
            <div className="min-h-[100px] flex flex-col items-center justify-center text-gray-400 opacity-50"><ShoppingCart size={32} className="mb-1.5" /> <p className="text-xs">ยังไม่มีสินค้า</p></div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="bg-white p-3 rounded-xl shadow-sm border border-brand-border flex flex-col gap-2">
                <div className="flex justify-between">
                  <p className="font-bold text-gray-800 text-sm line-clamp-1">{item.name}</p>
                  <p className="font-bold text-brand">฿{(Number(item.price) * item.quantity).toFixed(2)}</p>
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-500">฿{Number(item.price).toFixed(2)} / ชิ้น</p>
                  <div className="flex items-center gap-2 bg-brand-bg rounded-lg p-1">
                    <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:bg-white rounded text-gray-600"><Minus size={14} /></button>
                    <span className="w-6 text-center font-bold text-sm">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:bg-white rounded text-gray-600"><Plus size={14} /></button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ส่วนการชำระเงิน */}
        <div className="bg-white border-t border-brand-border shrink-0">
          {/* ⭐️ มือถือ: แถบสรุป + ปุ่มยุบ/ขยายแผงชำระเงิน — จอสั้นจะได้เห็นรายการสินค้าเต็มๆ แล้วค่อยกดขยายตอนจะจ่าย */}
          <div className="md:hidden flex items-center justify-between gap-2 px-4 py-2 border-b border-brand-border">
            <div className="text-sm"><span className="text-gray-500">ยอดสุทธิ </span><span className="font-bold text-brand">฿{finalTotal.toFixed(2)}</span></div>
            <button onClick={() => setPayOpen(v => !v)} className="flex items-center gap-1 text-xs font-bold text-brand bg-brand-bg border border-brand-border px-3 py-1.5 rounded-full active:scale-95 transition-all duration-150">
              {payOpen ? <><ChevronDown size={14} /> ย่อลง</> : <><ChevronUp size={14} /> ชำระเงิน</>}
            </button>
          </div>
          <div className={`${payOpen ? 'block' : 'hidden'} md:block p-5 pt-3 md:pt-5 overflow-y-auto max-h-[72vh] md:max-h-none md:overflow-visible`}>
          <div className="mb-4 space-y-1">
            <div className="flex justify-between text-sm text-gray-500">
              <span>ยอดรวมสินค้า:</span> <span>฿{grandTotal.toFixed(2)}</span>
            </div>
            {pointsDiscount > 0 && (
              <div className="flex justify-between text-sm text-yellow-600 font-bold">
                <span>แลกแต้ม ({pointsDiscount} 🌟):</span> <span>-฿{pointsDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold text-gray-800 pt-1 border-t border-brand-border">
              <span>ยอดสุทธิ:</span> <span className="text-brand">฿{finalTotal.toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-4 mb-4">
            {/* ช่องกรอกเบอร์สะสมแต้ม + ปุ่มตรวจสอบ */}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">เบอร์โทรศัพท์ (เพื่อสะสมแต้ม)</label>
              <div className="flex gap-2">
                <input type="tel" placeholder="ถ้าไม่ใส่จะไม่ได้รับแต้ม" value={phoneNumber} onChange={e => { setPhoneNumber(e.target.value); setPhoneVerified(null); }} className="flex-1 p-2.5 border border-brand-border rounded-lg text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
                <button type="button" onClick={handleVerifyPhone} disabled={verifying} className="shrink-0 bg-brand-bg text-brand-dark px-3 py-2 rounded-lg text-sm font-bold hover:bg-brand-border transition disabled:opacity-50">
                  {verifying ? '...' : 'ตรวจสอบ'}
                </button>
              </div>
              {/* 🐛 FIX (Sprint 0 — A2): /users/verify-phone ไม่คืนแต้มแล้ว (กันข้อมูลรั่ว) แสดงแค่ชื่อยืนยัน */}
              {phoneVerified && (
                <p className="text-xs text-green-600 font-bold mt-1">✓ ยืนยันตัวตน: {phoneVerified.member_name}</p>
              )}
            </div>

            {/* ⭐️ แลกแต้มเป็นส่วนลด (แสดงเฉพาะตอนมีแต้มอยู่จริง) */}
            {myPoints > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <span className="block text-xs font-bold text-yellow-700 mb-2">แลกแต้มเป็นส่วนลด (มี {myPoints} 🌟)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={0} max={maxRedeemable} value={redeemPoints}
                    onChange={e => setRedeemPoints(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0"
                    className="w-24 p-2 border border-yellow-300 rounded-lg text-sm text-center outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
                  />
                  <button type="button" onClick={() => setRedeemPoints(maxRedeemable)} className="text-xs font-bold text-yellow-700 bg-yellow-100 px-3 py-2 rounded-lg hover:bg-yellow-200 transition">
                    ใช้สูงสุด ({maxRedeemable})
                  </button>
                </div>
              </div>
            )}

            {/* ⭐️ FIX: เลือกวิธีจ่ายเงิน — เดิม text-sm ยาวเกิน ตัวหนังสือชนกันในปุ่มแคบบนมือถือ ลดขนาด + leading-tight */}
            <div className="flex gap-2">
              <button onClick={() => setPaymentMethod('CASH')} className={`flex-1 py-2 px-1 rounded-lg font-bold text-xs sm:text-sm leading-tight border-2 transition ${paymentMethod === 'CASH' ? 'border-brand bg-brand-bg text-brand-dark' : 'border-gray-200 text-gray-400'}`}>
                💵 จ่ายเงินสดหน้าร้าน
              </button>
              <button onClick={() => setPaymentMethod('QR')} className={`flex-1 py-2 px-1 rounded-lg font-bold text-xs sm:text-sm leading-tight border-2 transition ${paymentMethod === 'QR' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'}`}>
                📱 สแกนจ่าย
              </button>
            </div>

            {/* โซนอัปโหลดสลิป (แสดงเฉพาะตอนสแกนจ่าย) — ⭐️ Sprint 2 — B9: Enhanced with validation */}
            {paymentMethod === 'QR' && (
              // ⭐️ FIX: ขยาย QR ให้สแกนง่ายขึ้น (96→140) และลดขนาดช่องอัปโหลดสลิปลงอีก (ตัดคำอธิบายรอง,
              // ไอคอน/padding เล็กลง, เหลือแค่ปุ่มเดียวไม่กินพื้นที่) ให้สมดุลกัน
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 text-center animate-fade-in">
                <div className="bg-white p-2 rounded-lg shadow-sm inline-block mb-1.5">
                  <QRCode value={generatePayload(PROMPTPAY_ID, { amount: finalTotal })} size={140} />
                </div>
                <p className="text-xs text-blue-800 font-bold mb-2">สแกนจ่าย {finalTotal.toFixed(2)} บาท</p>

                {/* Upload zone */}
                <div className="border-2 border-dashed border-blue-300 rounded-lg p-1.5">
                  <label className="cursor-pointer flex items-center justify-center gap-1.5 hover:bg-blue-100 transition py-1">
                    <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={handleSlipChange} />
                    {slipPreview ? (
                      <img src={slipPreview} alt="Slip" className="max-h-16 object-contain rounded" />
                    ) : (
                      <>
                        <Upload className="text-blue-600" size={14} />
                        <span className="text-xs font-bold text-blue-600">แตะเพื่ออัปโหลดสลิป</span>
                      </>
                    )}
                  </label>
                </div>

                {/* File info and progress — ⭐️ Sprint 2 — B9 */}
                {slipFile && (
                  <div className="bg-white p-3 rounded-lg border border-blue-200 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-gray-700">{slipFile.name}</span>
                      <button onClick={() => { setSlipFile(null); setSlipPreview(null); setSlipDimensions(null); }} className="text-red-500 hover:bg-red-50 p-1 rounded">
                        <X size={16} />
                      </button>
                    </div>
                    {slipDimensions && (
                      <p className="text-xs text-green-600 font-bold">✓ ขนาดรูปถูกต้อง: {slipDimensions.width}×{slipDimensions.height}</p>
                    )}
                    {slipUploadProgress > 0 && slipUploadProgress < 100 && (
                      <div className="w-full bg-gray-200 rounded h-2">
                        <div className="bg-blue-600 h-full rounded transition-all" style={{ width: `${slipUploadProgress}%` }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ⭐️ FIX: ปุ่มยืนยัน — ปรับให้ตรงกับปุ่ม "ชำระเงิน" หน้า POS: ขนาด/ฟอนต์เล็กลง (py-3.5, text-sm,
              ไอคอน 18px), เปลี่ยนเป็นสีฟ้าตอนเลือกสแกนจ่าย (เหมือน POS ที่สลับสีตาม paymentMethod) */}
          {/* ⭐️ QR: ล็อกปุ่มจนกว่าสลิปจะแนบ+ตรวจเสร็จ กันกดยืนยันก่อนสลิปพร้อม (รูปสลิปจะไม่ขึ้น) */}
          {(() => {
            const qrNotReady = paymentMethod === 'QR' && (slipProcessing || !slipFile || !slipDimensions);
            return (
              <button onClick={handleCheckout} disabled={cart.length === 0 || loading || qrNotReady} className={`w-full py-3.5 rounded-xl text-sm font-bold text-white transition-all duration-150 active:scale-95 flex items-center justify-center gap-2 ${(cart.length === 0 || qrNotReady) ? 'bg-gray-300 cursor-not-allowed' : paymentMethod === 'QR' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-brand hover:bg-brand-dark'}`}>
                {loading ? 'กำลังส่งข้อมูล...'
                  : slipProcessing ? 'กำลังเตรียมสลิป...'
                  : (paymentMethod === 'QR' && !slipFile) ? <><Upload size={18} /> แนบสลิปก่อนยืนยัน</>
                  : <><CheckCircle size={18} /> ยืนยันคำสั่งซื้อ</>}
              </button>
            );
          })()}
          </div>
        </div>
      </div>
      {/* ⭐️ Modal ประวัติออเดอร์ของลูกค้า */}
      {showMyOrders && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-fade-in">
          {/* ⭐️ FIX: vh → dvh กันโดน URL bar มือถือตัด (เหมือน modal รายละเอียดออเดอร์) */}
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[80dvh] flex flex-col overflow-hidden">
            <div className="p-4 bg-brand-bg border-b border-brand-border flex justify-between items-center shrink-0">
              <h2 className="font-bold text-lg text-gray-800">ประวัติการสั่งจองของฉัน</h2>
              <button onClick={() => setShowMyOrders(false)} className="p-1 hover:bg-brand-border text-gray-500 rounded-lg"><X size={20} /></button>
            </div>
            <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-4 bg-gray-50">
              {myOrders.length === 0 ? (
                <p className="text-center text-gray-400 py-10">ยังไม่มีประวัติการสั่งจอง</p>
              ) : (
                myOrders.map(order => {
                  const statusBadge: Record<string, string> = {
                    PENDING_VERIFY: 'bg-blue-100 text-blue-700',
                    WAITING_CASH: 'bg-yellow-100 text-yellow-700',
                    PREPARING: 'bg-orange-100 text-orange-700',
                    READY: 'bg-green-100 text-green-700',
                    COMPLETED: 'bg-gray-100 text-gray-500',
                    CANCELLED: 'bg-red-100 text-red-600',
                    SLIP_REJECTED: 'bg-red-100 text-red-700',
                    REFUND_REQUESTED: 'bg-purple-100 text-purple-700',
                  };
                  const statusLabel: Record<string, string> = {
                    PENDING_VERIFY: '⏳ รอตรวจสลิป',
                    WAITING_CASH: '💵 รอชำระเงิน',
                    PREPARING: '📦 กำลังเตรียมของ',
                    READY: '✅ พร้อมรับสินค้า!',
                    COMPLETED: 'สำเร็จ',
                    CANCELLED: 'ยกเลิกแล้ว',
                    SLIP_REJECTED: '⚠️ สลิปผิด — ส่งสลิปใหม่',
                    REFUND_REQUESTED: '💰 รอคืนเงิน',
                  };
                  return (
                  <div key={order.id} className="bg-white p-4 rounded-2xl border border-brand-border shadow-md hover:shadow-lg hover:border-brand-mid transition-all cursor-pointer"
                    onClick={() => { setSelectedOrder(order); setRefundReason(''); setShowMyOrders(false); }}>
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-bold text-lg text-gray-800">ออเดอร์ #{order.id}</h3>
                        <p className="text-xs text-gray-500 mt-1">{formatBangkokTime(order.created_at)}</p>
                      </div>
                      <span className={`px-3 py-1.5 rounded-full text-[11px] md:text-xs font-bold whitespace-nowrap ${statusBadge[order.status] || 'bg-gray-100 text-gray-600'}`}>
                        {statusLabel[order.status] || order.status}
                      </span>
                    </div>

                    <div className="text-sm text-gray-600 mb-3 space-y-1.5 bg-gray-50 p-2.5 rounded-lg">
                      {order.items?.map((item: any) => (
                        <div key={item.id} className="flex justify-between text-xs md:text-sm">
                          <span className="text-gray-700">{item.quantity}x {item.product_name}</span>
                          <span className="font-semibold text-gray-800">฿{Number(item.subtotal).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>

                    {Number(order.points_discount) > 0 && (
                      <p className="text-xs text-yellow-600 font-bold mb-2 bg-yellow-50 p-2 rounded-lg">🌟 ใช้แต้มลด {order.points_redeemed} (-฿{Number(order.points_discount).toFixed(2)})</p>
                    )}

                    <div className="flex justify-between items-center border-t border-gray-200 pt-3">
                      <span className="font-bold text-brand text-base">฿{Number(order.total_amount).toFixed(2)}</span>
                      <span className="text-xs text-gray-500">แตะเพื่อดูละเอียด →</span>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ✅ CHANGED: new order detail modal - refactored UI */}
      {/* ✅ CHANGED: Refactored modal JSX — typography, spacing, interactive states, animations */}
      {selectedOrder && (
        // ⭐️ FIX: z-50 เดิมเท่ากับ bottom nav (z-50 ใน Layout.tsx) — เพราะ nav อยู่หลัง <main> ใน DOM ทำให้
        // แม้ backdrop คลุมเต็มจอ nav ก็ยังโผล่ทับด้านบนอยู่ (ตามภาพที่แจ้ง) ยกเป็น z-[80] ให้อยู่เหนือ nav แน่นอน
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300">
          {/* ⭐️ FIX: ปรับให้เหมือนสไตล์การ์ด/หัวข้อหน้า POS — แบนขึ้น ตัดไล่สีออก ใช้ theme token ตรงๆ
              เดิม max-h-[90vh] บนมือถือจริง vh นับรวมแถบ URL bar ทำให้ modal โดนตัดปุ่มด้านล่าง เปลี่ยนเป็น dvh */}
          {/* ⭐️ FIX: เดิมไม่มี overflow-hidden — header สีชมพูมุมตรง (ไม่ได้ใส่ rounded-t) เลยล้นทับมุมโค้ง
              ของการ์ดแม่ (rounded-2xl) ทำให้ขอบบนดูเหลี่ยม ไม่มน ใส่ overflow-hidden ให้ครอบตัดตามการ์ดแม่ */}
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[85dvh] flex flex-col overflow-hidden animate-fade-in">
            {/* Header - Sticky */}
            <div className="shrink-0 bg-brand px-4 py-3 flex justify-between items-center gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-white font-bold text-base truncate">ออเดอร์ #{selectedOrder.id}</h2>
                <p className="text-white/80 text-xs mt-0.5">{formatBangkokTime(selectedOrder.created_at)}</p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="shrink-0 p-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-white transition-colors duration-150"
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* ⭐️ FIX: เอาคำว่า "สำเร็จแล้ว" ออก — ซ่อนป้ายสถานะทั้งอันตอน COMPLETED เพราะดูซ้ำซ้อน
                  ในมุมมองประวัติออเดอร์ที่รู้อยู่แล้วว่าสำเร็จ (สถานะอื่นที่ยังต้องติดตามยังโชว์ตามปกติ) */}
              {selectedOrder.status !== 'COMPLETED' && (
              <div className="flex justify-center">
                <span className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs sm:text-sm font-semibold shadow-sm transition-transform duration-150 ${
                  selectedOrder.status === 'PENDING_VERIFY' ? 'bg-blue-100 text-blue-800' :
                  selectedOrder.status === 'WAITING_CASH' ? 'bg-yellow-100 text-yellow-800' :
                  selectedOrder.status === 'PREPARING' ? 'bg-orange-100 text-orange-800' :
                  selectedOrder.status === 'READY' ? 'bg-green-100 text-green-800' :
                  selectedOrder.status === 'COMPLETED' ? 'bg-gray-100 text-gray-700' :
                  selectedOrder.status === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                  selectedOrder.status === 'SLIP_REJECTED' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {selectedOrder.status === 'PENDING_VERIFY' && '⏳ รอตรวจสลิป'}
                  {selectedOrder.status === 'WAITING_CASH' && '💵 รอชำระเงิน'}
                  {selectedOrder.status === 'PREPARING' && '📦 กำลังเตรียมของ'}
                  {selectedOrder.status === 'READY' && '✅ พร้อมรับสินค้า'}
                  {selectedOrder.status === 'CANCELLED' && '❌ ยกเลิกแล้ว'}
                  {selectedOrder.status === 'SLIP_REJECTED' && '⚠️ สลิปผิด'}
                </span>
              </div>
              )}

              {/* Slip Image Section */}
              {(selectedOrder.payment_method === 'QR' || selectedOrder.slip_image) && (
                <div className="bg-brand-bg rounded-xl p-4 text-center border border-brand-border">
                  <p className="text-xs sm:text-sm text-gray-600 font-semibold mb-3 flex items-center justify-center gap-2">
                    <span className="text-lg">🧾</span> หลักฐานการชำระเงิน
                  </p>
                  {selectedOrder.slip_image ? (
                    // ⭐️ FIX: เดิมไม่มี max-height เลย ถ้าสลิปเป็นรูปแนวตั้ง/ความละเอียดสูงจะดันความสูงทั้ง
                    // modal บวมจนต้องเลื่อนไกลกว่าจะเจอปุ่มด้านล่าง — จำกัดความสูงไว้ + object-contain
                    // ⭐️ SECURITY FIX #1 — โหลดผ่าน AuthImage (แนบ JWT) แทน <img src> ตรงๆ
                    <AuthImage
                      path={getSlipImagePath(selectedOrder.created_at, selectedOrder.slip_image)}
                      alt="slip"
                      className="w-full max-h-64 sm:max-h-80 object-contain rounded-xl border border-brand-border bg-white"
                      fallback={<p className="text-gray-500 text-sm py-8">โหลดรูปสลิปไม่ได้</p>}
                    />
                  ) : (
                    <p className="text-gray-500 text-sm py-8">ยังไม่ได้อัปโหลดสลิป</p>
                  )}
                </div>
              )}

              {/* Upload Slip Section */}
              {selectedOrder.status === 'PENDING_VERIFY' && !selectedOrder.slip_image && (
                <label className="block cursor-pointer group">
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    try {
                      const fd = new FormData(); fd.append('slip', file);
                      await api.post(`/orders/${selectedOrder.id}/upload-slip`, fd);
                      // ⭐️ Fetch updated orders BEFORE closing modal to avoid stale selectedOrder
                      await fetchMyOrders();
                      setSelectedOrder(null);
                      Swal.fire({ icon: 'success', title: 'อัปโหลดสลิปสำเร็จ', text: 'รอพนักงานตรวจสอบสักครู่', showConfirmButton: false, timer: 2000 });
                    } catch (err: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
                  }} />
                  <div className="border-2 border-dashed border-brand-mid rounded-2xl p-6 sm:p-7 text-center bg-brand-bg group-hover:bg-brand-border group-active:bg-brand-border transition-colors duration-150">
                    <p className="text-brand font-bold text-sm sm:text-base">📎 แตะเพื่ออัปโหลดสลิป</p>
                    <p className="text-brand text-xs sm:text-sm mt-2">(รูปภาพขนาดไม่เกิน 5 MB)</p>
                  </div>
                </label>
              )}

              {/* Resubmit Slip */}
              {selectedOrder.status === 'SLIP_REJECTED' && (
                <label className="block cursor-pointer group">
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    try {
                      const fd = new FormData(); fd.append('slip', file);
                      await api.post(`/orders/${selectedOrder.id}/upload-slip`, fd);
                      // ⭐️ Fetch updated orders BEFORE closing modal to avoid stale selectedOrder
                      await fetchMyOrders();
                      setSelectedOrder(null);
                      Swal.fire({ icon: 'success', title: 'ส่งสลิปใหม่สำเร็จ', text: 'รอพนักงานตรวจสอบสักครู่', showConfirmButton: false, timer: 2000 });
                    } catch (err: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
                  }} />
                  <div className="border-2 border-dashed border-red-300 rounded-2xl p-6 sm:p-7 text-center bg-red-50 group-hover:bg-red-100 group-active:bg-red-75 transition-colors duration-150">
                    <p className="text-red-600 font-bold text-sm sm:text-base">📎 แตะเพื่อส่งสลิปใหม่</p>
                    <p className="text-red-500 text-xs sm:text-sm mt-2">สลิปของท่านไม่ถูกต้อง กรุณาส่งสลิปใหม่</p>
                  </div>
                </label>
              )}

              {/* Items Section */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <h3 className="font-bold text-gray-800 text-sm mb-3 flex items-center gap-2">
                  <span className="text-lg">📦</span> รายการสินค้า ({selectedOrder.items?.length})
                </h3>
                <div className="space-y-2">
                  {selectedOrder.items?.map((item: any) => (
                    <div key={item.id} className="flex justify-between items-center gap-3 py-2.5 px-3 bg-white rounded-lg border border-gray-100">
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-800 font-medium text-sm truncate">{item.product_name}</p>
                        <p className="text-gray-500 text-xs mt-0.5">จำนวน: {item.quantity} ชิ้น</p>
                      </div>
                      <p className="font-bold text-brand text-sm whitespace-nowrap">฿{Number(item.subtotal).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Points Discount */}
              {Number(selectedOrder.points_discount) > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                  <p className="text-sm text-yellow-800 font-semibold flex items-center gap-2">
                    <span className="text-lg">🌟</span> ใช้แต้มลด {selectedOrder.points_redeemed} แต้ม
                  </p>
                  <p className="text-base font-bold text-yellow-700 mt-2">ลด ฿{Number(selectedOrder.points_discount).toFixed(2)}</p>
                </div>
              )}

              {/* Reject Reason */}
              {selectedOrder.status === 'SLIP_REJECTED' && selectedOrder.reject_reason && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-xs sm:text-sm text-red-700 font-bold">⚠️ เหตุผลที่ปฏิเสธ:</p>
                  <p className="text-sm text-red-800 mt-2 leading-relaxed">{selectedOrder.reject_reason}</p>
                </div>
              )}

              {/* Total Amount */}
              <div className="bg-brand-bg border border-brand-border rounded-xl p-4">
                <p className="text-gray-700 text-xs sm:text-sm font-medium mb-1">ยอดรวมทั้งสิ้น</p>
                <p className="text-2xl sm:text-3xl font-bold text-brand">
                  ฿{Number(selectedOrder.total_amount).toFixed(2)}
                </p>
              </div>

              {/* Refund Reason Input */}
              {['PENDING_VERIFY', 'WAITING_CASH', 'SLIP_REJECTED'].includes(selectedOrder.status) && (
                <div className="space-y-2.5 pt-2">
                  <label className="block text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                    🔍 เหตุผลในการยกเลิก
                    <span className="text-red-500 font-bold">*</span>
                  </label>
                  <textarea
                    placeholder="ระบุเหตุผลการยกเลิก เช่น เปลี่ยนใจ, ส่วนลดน้อยเกินไป, ฯลฯ"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-border transition-colors duration-150 resize-none h-24 bg-gray-50 placeholder:text-gray-400"
                  />
                  <p className="text-xs text-gray-500 text-right">{refundReason.length} / 200</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2.5 pt-2 pb-1">
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 active:scale-95 text-gray-800 font-bold rounded-xl transition-all duration-150 text-sm"
                >
                  ปิด
                </button>
                {['PENDING_VERIFY', 'WAITING_CASH', 'SLIP_REJECTED'].includes(selectedOrder.status) && (
                  <button
                    onClick={() => handleCancelMyOrder(selectedOrder, refundReason)}
                    disabled={!refundReason.trim()}
                    className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 active:scale-95 text-white font-bold rounded-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    ยกเลิกออเดอร์
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}