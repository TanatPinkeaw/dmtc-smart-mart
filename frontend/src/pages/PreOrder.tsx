// 📄 pages/PreOrder.tsx — หน้าสั่งจองสินค้า (สมาชิกสั่งเองผ่านเว็บ/LINE)
//    ทำอะไร: เลือกสินค้า, ใส่เบอร์สะสมแต้ม/แลกแต้ม, จ่าย QR แนบสลิป หรือเงินสดรับที่ร้าน, สร้างออเดอร์ (POST /orders),
//    ดูประวัติออเดอร์ตัวเอง; realtime อัปเดตสถานะ; ราคา/ส่วนลด backend คำนวณใหม่เสมอ (frontend แค่ preview)
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { performLogout } from '../utils/logout'; // ⭐️ staff สลับไปบัญชีสมาชิก (ใช้สิทธิ์แต้ม)
import { ShoppingCart, ShoppingBag, Search } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { BRAND } from '../theme'; // ⭐️ สีปุ่มยืนยัน Swal ใช้ token กลาง ไม่ใช่ hex hardcode
import { useSocket } from '../hooks/useSocket';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { toSatang, fromSatang, lineTotalSatang, effectiveUnitPrice } from '../utils/money'; // ⭐️ Sprint 1 — B3
import { validatePaymentSlip } from '../validators/fileValidator'; // ⭐️ Sprint 2 — B9
import { PageHeader } from '../components/layout/PageHeader';
import { PromoPopularRow } from '../components/preorder/PromoPopularRow';
import { ProductGrid } from '../components/preorder/ProductGrid';
import { CartPanel } from '../components/preorder/CartPanel';
import { MyOrdersModal } from '../components/preorder/MyOrdersModal';
import { OrderDetailModal } from '../components/preorder/OrderDetailModal';
import { UploadSlipModal } from '../components/preorder/UploadSlipModal';

interface Category { id: number; name: string; }
interface Product { id: number; name: string; price: string | number; image_url: string; stock: number; category_id: number | null; expiry_status?: string; promo_active?: boolean; }
interface StorePromo { id: number; label: string; }
// ⭐️ /users/verify-phone คืนแค่ matched + member_name (กันข้อมูลรั่ว) — field อื่น (full_name/points)
// ไม่มีใน response จริง การประกาศไว้แค่ทำให้หลงคิดว่ามี ให้ประกาศตาม response จริง
interface PhoneVerified { member_name?: string; }
interface PreOrderItem { id: number; product_name: string; quantity: number; subtotal: number | string; }
interface PreOrderRow {
  id: number;
  status: string;
  created_at: string;
  payment_method?: string;
  slip_image?: string | null;
  items?: PreOrderItem[];
  points_discount?: number | string;
  points_redeemed?: number | string;
  total_amount?: number | string;
  reject_reason?: string | null;
}
interface CartItem extends Product { quantity: number; }

// ⭐️ ข้อความแจ้งเตือนฝั่งลูกค้าให้เป็นกันเอง แทนการโชว์รหัสสถานะดิบ (PREPARING ฯลฯ)
const CUSTOMER_STATUS_MESSAGE: Record<string, { icon: 'info' | 'success' | 'warning'; text: string }> = {
  PENDING_VERIFY:   { icon: 'info',    text: 'ได้รับออเดอร์แล้ว กำลังตรวจสอบสลิปให้นะ 🧾' },
  WAITING_CASH:     { icon: 'info',    text: 'ยืนยันออเดอร์แล้ว รอชำระเงินสดที่ร้านได้เลย' },
  WAITING_ACCEPT:   { icon: 'info',    text: 'สลิปตรวจสอบแล้ว กำลังรอพนักงานรับงาน 📋' },
  PREPARING:        { icon: 'info',    text: 'ร้านกำลังจัดเตรียมสินค้าให้คุณอยู่ 🛍️' },
  READY:            { icon: 'success', text: 'สินค้าพร้อมแล้ว มารับที่ร้านได้เลย 🎉' },
  COMPLETED:        { icon: 'success', text: 'รับสินค้าเรียบร้อย ขอบคุณที่ใช้บริการนะ 😊' },
  SLIP_REJECTED:    { icon: 'warning', text: 'สลิปยังไม่ผ่าน รบกวนส่งใหม่อีกครั้งนะ' },
  REFUND_REQUESTED: { icon: 'info',    text: 'กำลังดำเนินการคืนเงินให้คุณอยู่' },
  CANCELLED:        { icon: 'warning', text: 'ออเดอร์นี้ถูกยกเลิกแล้ว' },
};

export default function PreOrder() {
  const navigate = useNavigate();
  const socket = useSocket();
  const [products, setProducts] = useState<Product[]>([]);
  const [highlights, setHighlights] = useState<{ popular: Product[]; promo: Product[] }>({ popular: [], promo: [] });
  const [storePromos, setStorePromos] = useState<StorePromo[]>([]); // ⭐️ Phase 2 — โปรร้าน (ลดทั้งบิล/BOGO) โชว์แบนเนอร์
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | 'ALL'>('ALL');
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false); // ⭐️ มือถือ: ยุบ/ขยายแผงชำระเงิน (กันจอสั้นล้น)
  const [loading, setLoading] = useState(false);
  // ⭐️ Phase 2 — โหลดสินค้าครั้งแรก (แยกจาก `loading` ที่ใช้ตอนกดยืนยันคำสั่งซื้อ): กันจอว่างเปล่า
  // ระหว่างรอ fetchProducts() รอบแรก (เน็ตช้า/backend cold start) เป็นเท็จถาวรหลังจบรอบแรกรอบเดียว
  // ไม่โชว์ซ้ำตอน refetch จาก socket 'stock_updated' หรือหลังเช็คเอาท์สำเร็จ
  const [initialLoading, setInitialLoading] = useState(true);

  // State สำหรับการชำระเงิน
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'QR'>('QR');
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [slipUploadProgress, setSlipUploadProgress] = useState(0); // ⭐️ Sprint 2 — B9
  const [slipDimensions, setSlipDimensions] = useState<{ width: number; height: number } | null>(null); // ⭐️ Sprint 2 — B9
  const [slipProcessing, setSlipProcessing] = useState(false); // ⭐️ กำลังตรวจ/เตรียมสลิป — ล็อกปุ่มยืนยันไว้ก่อน

  // State สำหรับสะสมแต้ม
  const [phoneNumber, setPhoneNumber] = useState('');

  // 🐛 FIX — เดิม hardcode "1 แต้ม = ฿1" ตรงๆ ไม่ได้ดึงจาก settings เลย (ต่างจาก POS.tsx ที่ fetch
  // redeemRate จริงจาก /settings/loyalty) พอแอดมินปรับอัตราแลกเป็นค่าอื่น (เช่น 100 แต้ม = ฿1)
  // หน้านี้ยังคำนวณเหมือนเดิมอยู่ (1:1) แล้วส่ง "จำนวนบาทที่อยากลด" ไปเป็น redeem_points ตรงๆ
  // (บาท≠แต้ม) ทำให้แต้มที่หักจริงกับส่วนลดที่ลูกค้าเห็นไม่ตรงกันเลยหลังปรับอัตรา
  const [redeemRate, setRedeemRate] = useState(1);
  const [myPoints, setMyPoints] = useState(0);
  const [redeemPoints, setRedeemPoints] = useState<number | ''>('');
  const [phoneVerified, setPhoneVerified] = useState<PhoneVerified | null>(null); // ผลตรวจเบอร์ (แสดงชื่อ+แต้มยืนยัน)
  const [verifying, setVerifying] = useState(false);

  const PROMPTPAY_ID = import.meta.env.VITE_PROMPTPAY_ID || '';
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  // ⭐️ นโยบายแต้ม: เฉพาะ MEMBER มีสิทธิ์สะสม/แลกแต้ม — staff (CASHIER/MANAGER/ADMIN) สั่งจองของ
  //   ตัวเองได้แต่ไม่มีสิทธิ์แต้ม (backend บังคับอีกชั้นที่ POST /orders — ดู utils/preorderPolicy.js)
  const isMember = user.role === 'MEMBER';

  const [showMyOrders, setShowMyOrders] = useState(false);
  const [myOrders, setMyOrders] = useState<PreOrderRow[]>([]);
  // ⭐️ Phase 3 — แยก loading/error ของประวัติออเดอร์ออกจากกัน: เดิม fetchMyOrders พังแล้วเงียบ
  // (console.error เฉยๆ) ทำให้ myOrders ค้างค่าเดิม (ว่างเปล่าถ้ายังไม่เคยโหลดสำเร็จ) หน้า modal
  // จะโชว์ "ยังไม่มีประวัติการสั่งจอง" ทั้งที่จริงๆ แค่โหลดไม่สำเร็จ — คนละความหมายกันสิ้นเชิง
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PreOrderRow | null>(null); // ✅ CHANGED: modal order detail
  // ⭐️ ออเดอร์ที่กำลังจะส่งสลิปใหม่ (เปิดจากการ์ดประวัติออเดอร์ตรงๆ)
  const [slipOrder, setSlipOrder] = useState<PreOrderRow | null>(null);
  const [storeInfo, setStoreInfo] = useState<Record<string, unknown> | null>(null);
  const [refundReason, setRefundReason] = useState(''); // ✅ CHANGED: refund reason input

  // ⭐️ staff ที่มีบัญชีสมาชิกแยก (คนละบัญชีกับบัญชีพนักงาน) → สลับไปล็อกอินด้วยบัญชีสมาชิก
  // เพื่อใช้สิทธิ์สะสม/แลกแต้ม — แต้มเป็นสิทธิ์สมาชิก (นโยบาย utils/preorderPolicy.js) บัญชี
  // พนักงานใช้สิทธิ์นี้ไม่ได้จริงๆ การ "สลับบัญชี" จึงเป็นทางเดียวที่ถูกต้อง ไม่ใช่ปลอม role
  const handleSwitchToMember = async () => {
    const r = await Swal.fire({
      title: 'สลับไปใช้บัญชีสมาชิก?',
      text: 'ระบบจะออกจากบัญชีพนักงานปัจจุบัน แล้วให้คุณล็อกอินด้วยบัญชีสมาชิก (เพื่อใช้สิทธิ์สะสม/แลกแต้ม)',
      icon: 'question', showCancelButton: true, confirmButtonColor: BRAND, cancelButtonColor: '#9ca3af',
      confirmButtonText: 'สลับบัญชี', cancelButtonText: 'ยกเลิก',
    });
    if (!r.isConfirmed) return;
    await performLogout();
    navigate('/login');
  };
  // ⭐️ Phase 3 — กันกดปุ่ม "ยกเลิกออเดอร์" ซ้ำระหว่างที่ request แรกยังไม่จบ (double-submit)
  const [cancelling, setCancelling] = useState(false);
  // ⭐️ Deep link จากหน้า Home — 'slip' = ดันออเดอร์ที่สลิปไม่ผ่านขึ้นบนสุดของประวัติ (ไม่ได้กรองออก
  //   รายการอื่นทิ้ง แค่จัดลำดับใหม่ ยังเห็นออเดอร์อื่นได้เหมือนเดิม)
  const [orderFilter, setOrderFilter] = useState<'slip' | null>(null);
  // ⭐️ Deep link จากหน้า Home — 'promo' = โชว์เฉพาะสินค้าที่มีโปรกำลัง active (product.promo_active
  //   จาก /api/products คำนวณมาให้แล้วฝั่ง backend) มี chip ให้กดล้างกลับไปดูสินค้าทั้งหมดได้
  const [promoOnlyFilter, setPromoOnlyFilter] = useState(false);
  // 🐛 FIX — in-flight lock กัน double-submit ตอนยืนยันคำสั่งซื้อ (disabled ปุ่มมีผลหลัง re-render
  // เท่านั้น คลิกถี่ๆ/Enter ซ้ำอาจหลุด 2 request = 2 ออเดอร์ เพราะ idempotency-key ใหม่ทุก request)
  const checkoutInFlight = useRef(false);

  // ⭐️ Deep link จากหน้า Home — หน้านี้เป็นเจ้าของทั้งตะกร้าและโมดัลประวัติออเดอร์ Home จึงส่ง
  //   เจตนามาทาง query param แทนที่จะยกสถานะขึ้นไปไว้ระดับบน
  //     ?view=orders        = เปิดโมดัลประวัติการสั่งจองทันที
  //     ?view=orders&filter=slip = เปิดโมดัลประวัติ + ดันออเดอร์สลิปไม่ผ่านขึ้นบนสุด
  //     ?filter=promo       = กรองสินค้าเหลือเฉพาะที่มีโปรกำลัง active
  //     ?add=<id>           = หยิบสินค้าชิ้นนั้นลงตะกร้าให้เลย (ปุ่ม "เพิ่มลงตะกร้า" บนการ์ดสินค้าขายดี)
  //   ล้าง param ทิ้งหลังทำงานเสร็จ กันการรีเฟรช/กดย้อนกลับแล้วสั่งซ้ำ
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const view = searchParams.get('view');
    const filter = searchParams.get('filter');
    const addId = searchParams.get('add');
    if (!view && !filter && !addId) return;

    // ⭐️ ?add=<id> ต้องรอ products โหลดเสร็จก่อนถึงจะรู้ว่าหยิบชิ้นไหน — ค้าง effect ไว้ (ไม่ล้าง
    // query) จนกว่าจะมีสินค้าอย่างน้อย 1 ชิ้นให้ค้นหา ส่วน view/filter อย่างอื่นไม่ต้องรอ
    if (addId && products.length === 0) return;

    if (view === 'orders') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deep-link effect: ต้อง sync state ตาม URL params ตอน mount (ตั้งใจ — มี side effect fetchMyOrders/addToCart ด้วย)
      setShowMyOrders(true);
      fetchMyOrders();
      if (filter === 'slip') setOrderFilter('slip');
    }
    if (filter === 'promo') setPromoOnlyFilter(true);
    if (addId) {
      const target = products.find(p => String(p.id) === addId);
      if (target) { addToCart(target); setIsCartOpen(true); }
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, products]);

  // ⭐️ ดันออเดอร์สลิปไม่ผ่านขึ้นก่อน ไม่ตัดรายการอื่นทิ้ง (sort เสถียร คงลำดับเดิมของกลุ่มที่เท่ากัน)
  const displayedOrders = orderFilter === 'slip'
    ? [...myOrders].sort((a, b) => (a.status === 'SLIP_REJECTED' ? 0 : 1) - (b.status === 'SLIP_REJECTED' ? 0 : 1))
    : myOrders;

  // ⭐️ product.promo_active มาจาก backend (/api/products คำนวณ WHERE ช่วงวันที่ promo ให้แล้ว)
  const visibleProducts = promoOnlyFilter ? products.filter(p => p.promo_active) : products;

  useEffect(() => {
    api.get('/settings/store').then(res => setStoreInfo(res.data)).catch(() => {});
    api.get('/settings/loyalty').then(res => setRedeemRate(Number(res.data?.points_redeem_value_per_point) || 1)).catch(() => {});
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

    // 🐛 FIX — ฟัง products_expired เหมือน POS กันสินค้าหมดอายุค้างการ์ดสถานะเก่า (badge/block มีแล้ว
    // แต่หน้าไม่ได้ refetch ถ้าไม่มีการตัดสต๊อก) — refetch เงียบๆ ไม่เด้ง Swal ใส่ลูกค้า
    socket.on('products_expired', () => {
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
      socket.off('products_expired');
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
    } catch (e) {
      console.error(e);
    } finally {
      setInitialLoading(false);
    }
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
    } catch (e) {
      setPhoneVerified(null);
      Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: getErrorMessage(e) });
    } finally { setVerifying(false); }
  };

  const fetchMyPoints = async () => {
    if (!user.id) return;
    try {
      const res = await api.get('/users/me');
      setMyPoints(res.data.points || 0);
    } catch {
      setMyPoints(0);
    }
  };

  // ⭐️ ล้างแต้มที่แลกไว้ถ้าตะกร้าว่าง (กันเผลอแลกแต้มค้างจากตะกร้ารอบก่อน)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset สถานะที่ผูกกับตะกร้าเมื่อตะกร้าว่าง (ตั้งใจ sync ตามสัญญา UI)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset สถานะที่ผูกกับตะกร้าเมื่อตะกร้าว่าง (ตั้งใจ sync ตามสัญญา UI)
    if (cart.length === 0 && redeemPoints) setRedeemPoints('');
  }, [cart.length]);

  const addToCart = (product: Product) => {
    // 🐛 FIX — เดิมหน้าจองเพิ่มสินค้าหมดอายุเข้าตะกร้าได้ (backend reject ตอนสั่งทีหลัง) — block
    // ตั้งแต่หน้านี้เหมือน POS.tsx
    if (product.expiry_status === 'expired') {
      Swal.fire({ icon: 'error', title: 'สินค้าหมดอายุ', text: 'ไม่สามารถเพิ่มสินค้าที่หมดอายุแล้ว' });
      return;
    }
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'สต๊อกไม่พอ!', showConfirmButton: false, timer: 1500 });
          return prev;
        }
        return prev.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      // 🐛 FIX — เดิมเก็บ product.price เต็ม ไม่หักส่วนลดระดับสินค้า (ใกล้หมดอายุ/โปรช่วงวันที่) ทำให้
      // ตะกร้า+ยอดรวมโชว์ราคาเต็ม ทั้งที่ backend คิดส่วนลดให้จริงตอน checkout (best_discount_percent)
      // ยอดที่ลูกค้าเห็นเลยไม่ตรงกับที่จ่ายจริง — เก็บราคาต่อชิ้นหลังหักส่วนลดระดับสินค้าให้ตรงกับ POS
      return [...prev, { ...product, price: effectiveUnitPrice(product), quantity: 1 }];
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
    } catch (err) {
      Swal.fire('Upload Failed', getErrorMessage(err, 'Unknown error'), 'error');
      throw err; // Re-throw to handle in handleCheckout
    }
  };

  const handleCheckout = async () => {
    // 🐛 FIX — in-flight lock กัน double-submit (ดู checkoutInFlight ข้างบน) — เดิมกันได้แค่
    // disabled ปุ่มซึ่งมีผลหลัง re-render คลิกถี่ๆ/Enter ซ้ำ = ส่ง 2 request = ออเดอร์ซ้ำ
    if (checkoutInFlight.current) return;
    if (cart.length === 0) return;
    if (paymentMethod === 'QR' && !slipFile) return Swal.fire({ icon: 'warning', text: 'กรุณาแนบสลิปการโอนเงินก่อนยืนยันออเดอร์ครับ' });

    checkoutInFlight.current = true;
    setLoading(true);
    try {
      // 1. สั่งสร้างออเดอร์
      const payload = {
        items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })),
        payment_method: paymentMethod,
        slip_image: null, // ⭐️ Sprint 2 — B9: Upload slip separately after order creation
        // ⭐️ staff ไม่มีสิทธิ์แต้ม — บังคับปิดสะสม/แลกฝั่ง client ด้วย (backend กันอีกชั้น)
        use_phone_for_points: isMember && phoneNumber.trim().length >= 9, // ถ้ากรอกเบอร์มา ถือว่าสะสมแต้ม
        // 🐛 FIX — เดิมส่ง pointsDiscount (หน่วยบาท) เป็น redeem_points ที่ backend คาดว่าเป็นหน่วย
        // "แต้ม" ตรงๆ พอ redeemRate ไม่ใช่ 1:1 อีกต่อไป สองหน่วยนี้เลขไม่เท่ากันแล้ว ต้องส่งแต้มจริง
        redeem_points: isMember && redeemPointsUsed > 0 ? redeemPointsUsed : 0
      };

      const orderRes = await api.post('/orders', payload);
      const orderId = orderRes.data.id || orderRes.data.order_id;

      // 🐛 FIX (ออเดอร์ซ้ำ) — ออเดอร์ถูกสร้างแล้ว (ตัดสต๊อกแล้ว): เคลียร์ตะกร้า/ฟอร์มทันที ไม่รอ
      // อัปโหลดสลิปเสร็จ เดิมล้างทีหลัง พอสลิปพัง catch จะโชว์ error ทั่วไปแล้วปล่อยตะกร้าไว้ ลูกค้า
      // คิดว่าสั่งไม่สำเร็จกดยืนยันอีก = ออเดอร์ใบที่ 2 ตัดสต๊อกซ้ำ
      setCart([]); setSlipFile(null); setSlipPreview(null); setSlipUploadProgress(0); setSlipDimensions(null); setPhoneNumber(''); setRedeemPoints(''); setIsCartOpen(false);
      fetchProducts(); // ดึงสต๊อกใหม่
      fetchMyPoints(); // ⭐️ แต้มถูกหักไปแล้วถ้ามีการแลก ต้องดึงยอดคงเหลือใหม่

      // 2. ⭐️ Sprint 2 — B9: Upload payment slip to the created order (if QR payment)
      if (paymentMethod === 'QR' && slipFile) {
        try {
          await handleUploadSlip(orderId);
        } catch {
          // 🐛 FIX — สลิปพัง ≠ ออเดอร์พัง ออเดอร์ #orderId ยังอยู่ (backend อนุญาตอัปสลิปตอน
          // PENDING_VERIFY) เปิดโมดัลส่งสลิปใหม่ให้กับออเดอร์นี้เลย กันลูกค้ากดสั่งซ้ำ
          Swal.fire({
            icon: 'warning',
            title: `ออเดอร์ #${orderId} ถูกสร้างแล้ว แต่ส่งสลิปไม่สำเร็จ`,
            text: 'เลือกไฟล์สลิปแล้วส่งใหม่ให้ออเดอร์นี้ได้เลย (ห้ามกดยืนยันคำสั่งซื้อซ้ำ — จะได้ออเดอร์ใหม่)',
            confirmButtonText: 'ส่งสลิปใหม่',
            showCancelButton: true,
            cancelButtonText: 'ทีหลัง',
          }).then((result) => {
            if (result.isConfirmed) setSlipOrder({ id: orderId } as PreOrderRow);
          });
          return;
        }
      }

      // ⭐️ Phase 2 — success modal โชว์เลขออเดอร์อ้างอิงด้วย (เดิมไม่มี ผู้ใช้ไม่มีเลขไว้ติดต่อ/ค้นประวัติ)
      Swal.fire({
        icon: 'success', title: 'ส่งออเดอร์สำเร็จ! 🎉',
        html: `<b>หมายเลขออเดอร์ #${orderId}</b><br/>`
          + (paymentMethod === 'QR' ? 'สลิปอัปโหลดสำเร็จ กรุณารอพนักงานตรวจสอบสักครู่นะครับ' : 'กรุณานำเงินสดมาชำระที่หน้าร้านได้เลยครับ')
          + (pointsDiscount > 0 ? ` (ใช้แต้มลดไปแล้ว ${pointsDiscount} บาท)` : '')
      });
    } catch (error) {
      // ⭐️ Phase 2 — ใช้ getErrorMessage เหมือนจุดอื่นในไฟล์นี้ (handleVerifyPhone/handleCancelMyOrder)
      // เดิมอ่าน error.response?.data?.error ตรงๆ พลาดเคส "เน็ตหลุด/เชื่อมเซิร์ฟเวอร์ไม่ได้" (ไม่มี
      // response เลย) ไปเห็นแค่ fallback ทั่วไปที่ไม่บอกสาเหตุจริง ระหว่างขั้นตอนสำคัญที่สุดของ flow
      // หมายเหตุ: มาถึง catch นี้ = ยังไม่ได้สร้างออเดอร์ (สร้างสำเร็จจะ return ไปก่อน) ตะกร้าจึงยังอยู่
      Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: getErrorMessage(error, 'ไม่สามารถสั่งซื้อได้') });
    } finally {
      setLoading(false);
      checkoutInFlight.current = false;
    }
  };

  const fetchMyOrders = async () => {
    setOrdersLoading(true);
    try {
      // ⭐️ ?mine=1 — หน้านี้ดูได้แค่ออเดอร์ของตัวเองเสมอ (staff ที่สั่งจองได้แล้ว default ของ GET /orders
      //   คือ "ดูทั้งหมด" สำหรับหน้า OrderManagement ต้องบังคับ scope ไม่งั้นเห็นออเดอร์ลูกค้าคนอื่น)
      const res = await api.get(`/orders?mine=1&t=${Date.now()}`);
      setMyOrders(res.data);
      setOrdersError(false);
    } catch (err) {
      console.error(err);
      // ⭐️ Phase 3 — โหลดไม่สำเร็จ ≠ ไม่มีประวัติ ต้องแยกให้ modal บอกผู้ใช้ถูกต้อง ไม่ทำให้ myOrders
      // เป็น [] เอง (เก็บของเก่าที่เคยโหลดได้ไว้ ถ้ามี ดีกว่าล้างทิ้งจนดูเหมือนประวัติหายไปเฉยๆ)
      setOrdersError(true);
    } finally {
      setOrdersLoading(false);
    }
  };

  // ⭐️ เปิดออเดอร์เจาะจง (จากการกดแจ้งเตือน) → เด้งเข้า modal รายละเอียดเลย
  // ถ้าออเดอร์เป็น SLIP_REJECTED จะเห็นปุ่ม "แตะเพื่อส่งสลิปใหม่" ทันที ไม่ต้องหาเอง
  const openMyOrder = async (orderId: number) => {
    try {
      const res = await api.get(`/orders?mine=1&t=${Date.now()}`);
      setMyOrders(res.data);
      const found = (res.data || []).find((o: PreOrderRow) => Number(o.id) === Number(orderId));
      if (found) { setSelectedOrder(found); setRefundReason(''); }
      else setShowMyOrders(true);
    } catch (err) { console.error(err); setShowMyOrders(true); }
  };

  // ✅ CHANGED: accept refund reason from modal input
  const handleCancelMyOrder = async (order: PreOrderRow, reason: string) => {
    if (!reason.trim()) {
      Swal.fire({ icon: 'warning', title: 'ต้องระบุเหตุผล', text: 'กรุณาใส่เหตุผลการยกเลิกออเดอร์' });
      return;
    }
    if (cancelling) return; // ⭐️ Phase 3 — กันกดซ้ำระหว่าง request แรกยังไม่จบ (double-submit)

    setCancelling(true);
    try {
      await api.put(`/orders/${order.id}/cancel-by-user`, { refund_info: reason });
      Swal.fire({ icon: 'success', title: 'ยกเลิกออเดอร์สำเร็จ', showConfirmButton: false, timer: 1500 });
      setSelectedOrder(null); // ✅ CHANGED: close modal
      setRefundReason(''); // ✅ CHANGED: reset input
      fetchMyOrders();
      fetchProducts();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) });
    } finally {
      setCancelling(false);
    }
  };

  // ⭐️ Sprint 1 — B3: บวกยอดตะกร้าในหน่วยสตางค์ (integer) กัน float drift สะสมข้ามหลายรายการ
  const grandTotalSatang = cart.reduce((total, item) => total + lineTotalSatang(item.price, item.quantity), 0);
  const grandTotal = fromSatang(grandTotalSatang);

  // 🐛 FIX — ต้องคูณ/หารด้วย redeemRate จริง (ไม่ใช่ 1:1 ตายตัว) ตาม pattern เดียวกับ POS.tsx:
  // maxRedeemable = แต้มสูงสุดที่แลกได้ (หน่วย: แต้ม) redeemPointsUsed = แต้มที่แลกจริง (แต้ม)
  // pointsDiscount = มูลค่าส่วนลด (หน่วย: บาท) = redeemPointsUsed * redeemRate
  const maxRedeemable = Math.min(myPoints, Math.floor(grandTotal / redeemRate));
  const redeemPointsUsed = redeemPoints ? Math.min(Number(redeemPoints), maxRedeemable) : 0;
  const pointsDiscount = fromSatang(toSatang(redeemPointsUsed * redeemRate));
  const finalTotal = fromSatang(Math.max(0, grandTotalSatang - toSatang(pointsDiscount)));

  return (
    <div className="flex h-screen bg-brand-bg font-sans relative">
      {/* ================= ฝั่งซ้าย: เลือกสินค้า ================= */}
      <div className="w-full md:w-2/3 flex flex-col h-full">
        {/* ⭐️ FIX: ปรับ header ให้เหมือนหน้า POS — แถวเดียว icon box + title ซ้าย ปุ่มขวา ไม่ค่อยสตัดเป็น 2 บรรทัด
            + ชายคาหยักใต้แถบ (awning-edge — signature เดียวกับหน้า Home) */}
        <PageHeader
          icon={ShoppingBag}
          title="สั่งจองสินค้า (Pre-order)"
          titleClassName="font-display"
          className="sticky top-0 z-10 awning-edge"
          actions={
            /* ⭐️ ปุ่มกดดูประวัติของตัวเอง */
            <button onClick={() => { setShowMyOrders(true); fetchMyOrders(); }} className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-white bg-white/15 border border-white/20 hover:bg-white/25 px-3 py-1.5 rounded-full transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
              ประวัติของฉัน
            </button>
          }
        />

        {/* pt-5 เผื่อชายคาหยัก (awning) ยื่นลงมา 12px กันครุยทับช่องค้นหา */}
        <div className="flex-1 px-4 md:px-6 pt-5 overflow-y-auto pb-24 md:pb-6">
          {/* ⭐️ ค้นหา */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            {/* ⭐️ FIX: เดิม border-none กลืนกับพื้นหลัง เพิ่มกรอบให้เหมือนช่องค้นหาหน้า POS */}
            <input type="text" placeholder="ค้นหาสินค้า..." value={productSearch} onChange={e => setProductSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-brand-bg border border-brand-border rounded-full text-sm font-medium outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150" />
          </div>

          {/* ⭐️ Deep link ?filter=promo — chip บอกว่ากำลังกรองอยู่ + ปุ่มล้างกลับไปดูสินค้าทั้งหมด */}
          {promoOnlyFilter && (
            <button
              onClick={() => setPromoOnlyFilter(false)}
              className="mb-3 inline-flex items-center gap-1.5 bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1.5 rounded-full active:scale-95 transition-all duration-150"
            >
              🏷️ กำลังแสดงเฉพาะสินค้าโปรโมชั่น <span className="text-amber-500">✕</span>
            </button>
          )}

          {/* ⭐️ Phase 2 — skeleton ตอนโหลดสินค้ารอบแรก กันจอว่างเปล่าถ้าเน็ตช้า/backend cold start */}
          {initialLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 animate-pulse">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white border border-brand-border rounded-3xl p-3 shadow-sm">
                  <div className="w-full aspect-square bg-brand-bg rounded-lg mb-2" />
                  <div className="h-3 bg-brand-bg rounded-full w-3/4 mb-2 mx-auto" />
                  <div className="h-7 bg-brand-bg rounded-lg" />
                </div>
              ))}
            </div>
          ) : (
            <>
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
                products={visibleProducts}
                productSearch={productSearch}
                onAddToCart={addToCart}
              />
            </>
          )}
        </div>
      </div>

      {/* ⭐️ FIX: เดิม bottom-6 ทับ bottom nav bar (h-14 + z-50) เพราะปุ่มนี้ z-40 ต่ำกว่า — เปลี่ยนเป็น
          bottom-20 ให้ตรงกับปุ่มลอยหน้าอื่น (POS.tsx, Inventory.tsx) ที่แก้ถูกไว้แล้ว */}
      <button onClick={() => setIsCartOpen(true)} className="md:hidden fixed bottom-28 right-4 z-40 w-14 h-14 bg-gradient-to-br from-brand to-brand-dark text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90">
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
        redeemPointsUsed={redeemPointsUsed}
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
        pointsEnabled={isMember}
        onSwitchToMember={handleSwitchToMember}
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
          myOrders={displayedOrders}
          loading={ordersLoading}
          error={ordersError}
          onRetry={fetchMyOrders}
          onClose={() => { setShowMyOrders(false); setOrderFilter(null); }}
          onSelectOrder={(order) => { setSelectedOrder(order); setRefundReason(''); setShowMyOrders(false); setOrderFilter(null); }}
          onResubmitSlip={(order) => setSlipOrder(order)}
        />
      )}

      {/* ⭐️ ส่งสลิปใหม่จากการ์ดประวัติออเดอร์โดยตรง ไม่ต้องเข้าหน้ารายละเอียดก่อน */}
      {slipOrder && (
        <UploadSlipModal
          orderId={slipOrder.id}
          rejectReason={slipOrder.reject_reason}
          onClose={() => setSlipOrder(null)}
          onUploaded={fetchMyOrders}
        />
      )}

      {/* ✅ CHANGED: new order detail modal - refactored UI */}
      {selectedOrder && (
        <OrderDetailModal
          selectedOrder={selectedOrder}
          storeInfo={storeInfo ?? undefined}
          refundReason={refundReason}
          onRefundReasonChange={setRefundReason}
          onClose={() => setSelectedOrder(null)}
          onCancelOrder={handleCancelMyOrder}
          cancelling={cancelling}
          fetchMyOrders={fetchMyOrders}
        />
      )}
    </div>
  );
}
