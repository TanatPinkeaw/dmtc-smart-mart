import { useState, useEffect } from 'react';
import { ShoppingCart, Plus, Minus, CheckCircle, PackagePlus, Upload, X, Image as ImageIcon, Search } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import generatePayload from 'promptpay-qr';
import QRCode from 'react-qr-code';
import { useSocket } from '../SocketContext';

interface Category { id: number; name: string; }
interface Product { id: number; name: string; price: string | number; image_url: string; stock: number; category_id: number | null; }
interface CartItem extends Product { quantity: number; }

export default function PreOrder() {
  const socket = useSocket();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | 'ALL'>('ALL');
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // State สำหรับการชำระเงิน
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'QR'>('QR');
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);

  // State สำหรับสะสมแต้ม
  const [phoneNumber, setPhoneNumber] = useState('');

  // ⭐️ State สำหรับแลกแต้มเป็นส่วนลด (1 แต้ม = ฿1) — pattern เดียวกับ POS.tsx
  const [myPoints, setMyPoints] = useState(0);
  const [redeemPoints, setRedeemPoints] = useState<number | ''>('');
  const [phoneVerified, setPhoneVerified] = useState<any>(null); // ผลตรวจเบอร์ (แสดงชื่อ+แต้มยืนยัน)
  const [verifying, setVerifying] = useState(false);

  const PROMPTPAY_ID = "0803610120"; // 👈 เบอร์พร้อมเพย์ร้าน
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [showMyOrders, setShowMyOrders] = useState(false);
  const [myOrders, setMyOrders] = useState<any[]>([]);

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
      Swal.fire({
        toast: true, position: 'top-end', icon: 'info',
        title: `ออเดอร์ #${data.order_id} อัปเดตสถานะเป็น: ${data.status}`,
        showConfirmButton: false, timer: 3000
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

  // ⭐️ ดึงแต้มสะสมปัจจุบันของตัวเอง (ใช้ endpoint เดิม /users/search ที่มีอยู่แล้ว ค้นด้วย student_id ของตัวเอง)
  // ⭐️ ตรวจเบอร์โทร (ค้นหาสมาชิกด้วยเบอร์ เหมือน POS) เพื่อยืนยันชื่อ+แต้มก่อนสั่งจอง
  const handleVerifyPhone = async () => {
    if (!phoneNumber.trim()) return Swal.fire({ icon: 'warning', title: 'กรุณากรอกเบอร์โทรก่อน' });
    setVerifying(true);
    try {
      const res = await api.get(`/users/search?q=${phoneNumber.trim()}`);
      setPhoneVerified(res.data);
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `พบสมาชิก: ${res.data.full_name} (มี ${res.data.points || 0} แต้ม)`, showConfirmButton: false, timer: 2500 });
    } catch (e: any) {
      setPhoneVerified(null);
      Swal.fire({ icon: 'error', title: 'ไม่พบสมาชิก', text: 'ไม่พบเบอร์นี้ในระบบ (แต้มจะสะสมให้เมื่อเบอร์ตรงกับบัญชีสมาชิก)' });
    } finally { setVerifying(false); }
  };

  const fetchMyPoints = async () => {
    if (!user.student_id) return;
    try {
      const res = await api.get(`/users/search?q=${user.student_id}`);
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

  const handleSlipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSlipFile(file);
      setSlipPreview(URL.createObjectURL(file));
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (paymentMethod === 'QR' && !slipFile) return Swal.fire({ icon: 'warning', text: 'กรุณาแนบสลิปการโอนเงินก่อนยืนยันออเดอร์ครับ' });

    setLoading(true);
    try {
      let slip_url = null;

      // 1. ถ้าสแกนจ่าย ต้องอัปโหลดรูปก่อน
      if (paymentMethod === 'QR' && slipFile) {
        const formData = new FormData();
        formData.append('slip', slipFile);
        const uploadRes = await api.post('/orders/upload-slip', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        slip_url = uploadRes.data.slip_url;
      }

      // 2. สั่งสร้างออเดอร์
      const payload = {
        items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })),
        payment_method: paymentMethod,
        slip_image: slip_url,
        use_phone_for_points: phoneNumber.trim().length >= 9, // ถ้ากรอกเบอร์มา ถือว่าสะสมแต้ม
        redeem_points: pointsDiscount > 0 ? pointsDiscount : 0 // 👈 แต้มที่จะแลกเป็นส่วนลด
      };

      await api.post('/orders', payload);

      Swal.fire({
        icon: 'success', title: 'ส่งออเดอร์สำเร็จ! 🎉',
        text: (paymentMethod === 'QR' ? 'กรุณารอพนักงานตรวจสอบสลิปสักครู่นะครับ' : 'กรุณานำเงินสดมาชำระที่หน้าร้านได้เลยครับ')
          + (pointsDiscount > 0 ? ` (ใช้แต้มลดไปแล้ว ${pointsDiscount} บาท)` : '')
      });

      // รีเซ็ตค่าทั้งหมด
      setCart([]); setSlipFile(null); setSlipPreview(null); setPhoneNumber(''); setRedeemPoints(''); setIsCartOpen(false);
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

  const handleCancelMyOrder = async (order: any) => {
    let refundInfo = '';
    // ถ้าจ่ายผ่าน QR (หรือสถานะกำลังรอตรวจสลิป) — แจ้งว่าต้องนำสลิปมาที่ร้านเพื่อรับเงินคืนเป็นเงินสด
    if (order.payment_method === 'QR') {
      const res = await Swal.fire({
        title: 'ยกเลิกออเดอร์ที่ชำระผ่าน QR',
        html: `<p class="text-sm text-gray-600">ถ้าท่านโอนเงินมาแล้ว กรุณานำ <strong>หลักฐานการโอน (สลิป)</strong> มาที่ร้านสหกรณ์<br>เพื่อรับเงินคืนเป็น <strong>เงินสด</strong> ครับ</p>`,
        icon: 'info',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'รับทราบ ยืนยันยกเลิก',
        cancelButtonText: 'ไม่ยกเลิก'
      });
      if (!res.isConfirmed) return;
      refundInfo = 'นำสลิปมารับเงินสดที่ร้าน';
    } else {
      const res = await Swal.fire({ title: 'ต้องการยกเลิกออเดอร์นี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'ใช่, ยกเลิกเลย' });
      if (!res.isConfirmed) return;
    }

    try {
      await api.put(`/orders/${order.id}/cancel-by-user`, { refund_info: refundInfo });
      Swal.fire({ icon: 'success', title: 'ยกเลิกออเดอร์สำเร็จ', showConfirmButton: false, timer: 1500 });
      fetchMyOrders();
      fetchProducts();
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: err.response?.data?.error });
    }
  };

  const grandTotal = cart.reduce((total, item) => total + (Number(item.price) * item.quantity), 0);

  // ⭐️ ส่วนลดจากแต้ม (1 แต้ม = ฿1) ห้ามเกินแต้มที่มี และห้ามเกินยอดที่ต้องจ่าย (cap เหมือนฝั่ง backend)
  const maxRedeemable = Math.min(myPoints, Math.floor(grandTotal));
  const pointsDiscount = redeemPoints ? Math.min(Number(redeemPoints), maxRedeemable) : 0;
  const finalTotal = Math.max(0, grandTotal - pointsDiscount);

  return (
    <div className="flex h-screen bg-pink-50 font-sans relative">
      {/* ================= ฝั่งซ้าย: เลือกสินค้า ================= */}
      <div className="w-full md:w-2/3 flex flex-col h-full">
        <div className="bg-white p-4 shadow-sm flex justify-between items-center z-10 shrink-0 border-b border-pink-100">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-pink-600">สั่งจองสินค้า (Pre-order)</h1>
            <p className="text-xs md:text-sm text-gray-500">เลือกสินค้าลงตะกร้า แล้วรอรับที่สหกรณ์ได้เลย</p>
          </div>
          {/* ⭐️ ปุ่มกดดูประวัติของตัวเอง */}
          <button onClick={() => { setShowMyOrders(true); fetchMyOrders(); }} className="bg-pink-100 text-pink-700 px-4 py-2 rounded-xl font-bold hover:bg-pink-200 transition text-sm flex items-center gap-2">
            ประวัติของฉัน
          </button>
        </div>

        <div className="flex-1 p-4 md:p-6 overflow-y-auto pb-24 md:pb-6">
          {/* ⭐️ ค้นหา */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input type="text" placeholder="ค้นหาสินค้า..." value={productSearch} onChange={e => setProductSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-pink-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-pink-500 focus:bg-white transition border-none" />
          </div>

          {/* ⭐️ หมวดหมู่ */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
            <button onClick={() => setSelectedCategory('ALL')} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition ${selectedCategory === 'ALL' ? 'bg-pink-600 text-white' : 'bg-pink-50 text-pink-600 hover:bg-pink-100'}`}>ทั้งหมด</button>
            {categories.map(c => (
              <button key={c.id} onClick={() => setSelectedCategory(c.id)} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition ${selectedCategory === c.id ? 'bg-pink-600 text-white' : 'bg-pink-50 text-pink-600 hover:bg-pink-100'}`}>{c.name}</button>
            ))}
          </div>

          {(() => {
            const filtered = products
              .filter(p => selectedCategory === 'ALL' || p.category_id === selectedCategory)
              .filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()));
            return (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {filtered.map((product) => (
              <div key={product.id} onClick={() => addToCart(product)} className="bg-white p-3 md:p-4 rounded-2xl shadow-sm border border-pink-100 cursor-pointer hover:shadow-md transition active:scale-95 flex flex-col items-center relative overflow-hidden group">
                <div className="w-full aspect-square bg-pink-50 rounded-xl mb-3 flex items-center justify-center overflow-hidden">
                  {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover group-hover:scale-110 transition duration-300" /> : <PackagePlus size={32} className="text-gray-300" />}
                </div>
                <h3 className="font-semibold text-center text-gray-700 line-clamp-2 text-sm">{product.name}</h3>
                <div className="w-full flex justify-between items-end mt-2">
                  <p className="text-pink-600 font-bold text-lg">฿{Number(product.price).toFixed(2)}</p>
                  <p className="text-xs bg-pink-100 text-pink-600 px-2 py-1 rounded-md font-bold">เหลือ {product.stock}</p>
                </div>
              </div>
            ))}
          </div>
            ); // end return
          })()} {/* end IIFE */}
        </div>
      </div>

      {/* ⭐️ ปุ่มตะกร้าลอย (มือถือ) */}
      <button onClick={() => setIsCartOpen(true)} className="md:hidden fixed bottom-6 right-4 bg-pink-600 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-40 hover:bg-pink-700 active:scale-90 transition">
        <ShoppingCart size={24} />
        {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-6 h-6 flex items-center justify-center rounded-full border-2 border-white">{cart.reduce((a, c) => a + c.quantity, 0)}</span>}
      </button>

      {/* ================= ฝั่งขวา: ตะกร้าและชำระเงิน ================= */}
      <div className={`${isCartOpen ? 'fixed inset-0 z-50 flex animate-fade-in' : 'hidden'} md:flex md:relative md:w-1/3 flex-col bg-white border-l border-pink-100 shadow-xl`}>
        <div className="p-4 bg-pink-600 text-white flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2"><ShoppingCart size={20} /> ตะกร้าของฉัน</h2>
          <button onClick={() => setIsCartOpen(false)} className="md:hidden p-1 bg-pink-700 rounded-lg hover:bg-pink-800"><X size={20} /></button>
        </div>

        {/* รายการในตะกร้า */}
        <div className="flex-1 overflow-y-auto p-4 bg-pink-50 space-y-3">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50"><ShoppingCart size={48} className="mb-2" /> <p>ยังไม่มีสินค้า</p></div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="bg-white p-3 rounded-xl shadow-sm border border-pink-100 flex flex-col gap-2">
                <div className="flex justify-between">
                  <p className="font-bold text-gray-800 text-sm line-clamp-1">{item.name}</p>
                  <p className="font-bold text-pink-600">฿{(Number(item.price) * item.quantity).toFixed(2)}</p>
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-500">฿{Number(item.price).toFixed(2)} / ชิ้น</p>
                  <div className="flex items-center gap-2 bg-pink-50 rounded-lg p-1">
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
        <div className="p-5 bg-white border-t border-pink-100 shrink-0">
          <div className="mb-4 space-y-1">
            <div className="flex justify-between text-sm text-gray-500">
              <span>ยอดรวมสินค้า:</span> <span>฿{grandTotal.toFixed(2)}</span>
            </div>
            {pointsDiscount > 0 && (
              <div className="flex justify-between text-sm text-yellow-600 font-bold">
                <span>แลกแต้ม ({pointsDiscount} 🌟):</span> <span>-฿{pointsDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold text-gray-800 pt-1 border-t border-pink-100">
              <span>ยอดสุทธิ:</span> <span className="text-pink-600">฿{finalTotal.toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-4 mb-4">
            {/* ช่องกรอกเบอร์สะสมแต้ม + ปุ่มตรวจสอบ */}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">เบอร์โทรศัพท์ (เพื่อสะสมแต้ม)</label>
              <div className="flex gap-2">
                <input type="tel" placeholder="ถ้าไม่ใส่จะไม่ได้รับแต้ม" value={phoneNumber} onChange={e => { setPhoneNumber(e.target.value); setPhoneVerified(null); }} className="flex-1 p-2.5 border border-pink-200 rounded-lg text-sm outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500" />
                <button type="button" onClick={handleVerifyPhone} disabled={verifying} className="shrink-0 bg-pink-100 text-pink-700 px-3 py-2 rounded-lg text-sm font-bold hover:bg-pink-200 transition disabled:opacity-50">
                  {verifying ? '...' : 'ตรวจสอบ'}
                </button>
              </div>
              {phoneVerified && (
                <p className="text-xs text-green-600 font-bold mt-1">✓ {phoneVerified.full_name} • มี {phoneVerified.points || 0} แต้ม</p>
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

            {/* เลือกวิธีจ่ายเงิน */}
            <div className="flex gap-2">
              <button onClick={() => setPaymentMethod('CASH')} className={`flex-1 py-2 rounded-lg font-bold text-sm border-2 transition ${paymentMethod === 'CASH' ? 'border-pink-600 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-400'}`}>
                💵 จ่ายเงินสดหน้าร้าน
              </button>
              <button onClick={() => setPaymentMethod('QR')} className={`flex-1 py-2 rounded-lg font-bold text-sm border-2 transition ${paymentMethod === 'QR' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'}`}>
                📱 สแกนจ่าย
              </button>
            </div>

            {/* โซนอัปโหลดสลิป (แสดงเฉพาะตอนสแกนจ่าย) */}
            {paymentMethod === 'QR' && (
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 text-center animate-fade-in">
                <div className="bg-white p-2 rounded-lg shadow-sm inline-block mb-2">
                  <QRCode value={generatePayload(PROMPTPAY_ID, { amount: finalTotal })} size={120} />
                </div>
                <p className="text-xs text-blue-800 font-bold mb-3">สแกนจ่าย {finalTotal.toFixed(2)} บาท</p>

                <label className="cursor-pointer bg-white border-2 border-dashed border-blue-300 rounded-lg p-3 flex flex-col items-center justify-center hover:bg-blue-100 transition">
                  <input type="file" accept="image/*" className="hidden" onChange={handleSlipChange} />
                  {slipPreview ? (
                    <img src={slipPreview} alt="Slip" className="max-h-24 object-contain rounded" />
                  ) : (
                    <>
                      <ImageIcon className="text-blue-400 mb-1" size={24} />
                      <span className="text-xs font-bold text-blue-600">กดเพื่ออัปโหลดสลิปโอนเงิน</span>
                    </>
                  )}
                </label>
              </div>
            )}
          </div>

          <button onClick={handleCheckout} disabled={cart.length === 0 || loading} className={`w-full py-4 rounded-xl text-lg font-bold text-white transition flex justify-center items-center gap-2 ${cart.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-pink-600 hover:bg-pink-700 active:scale-95 shadow-md'}`}>
            {loading ? 'กำลังส่งข้อมูล...' : <><CheckCircle size={24} /> ยืนยันคำสั่งซื้อ</>}
          </button>
        </div>
      </div>
      {/* ⭐️ Modal ประวัติออเดอร์ของลูกค้า */}
      {showMyOrders && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 bg-pink-50 border-b border-pink-100 flex justify-between items-center shrink-0">
              <h2 className="font-bold text-lg text-gray-800">ประวัติการสั่งจองของฉัน</h2>
              <button onClick={() => setShowMyOrders(false)} className="p-1 hover:bg-pink-200 text-gray-500 rounded-lg"><X size={20} /></button>
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
                  <div key={order.id} className="bg-white p-4 rounded-xl border border-pink-100 shadow-sm">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-bold text-gray-800">บิล #{order.id}</h3>
                        <p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleString('th-TH')}</p>
                      </div>
                      <span className={`px-2 py-1 rounded-md text-[10px] md:text-xs font-bold ${statusBadge[order.status] || 'bg-gray-100 text-gray-600'}`}>
                        {statusLabel[order.status] || order.status}
                      </span>
                    </div>

                    <div className="text-sm text-gray-600 mb-3 space-y-1">
                      {order.items?.map((item: any) => (
                        <div key={item.id} className="flex justify-between">
                          <span>{item.quantity}x {item.product_name}</span>
                          <span>฿{Number(item.subtotal).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>

                    {Number(order.points_discount) > 0 && (
                      <p className="text-xs text-yellow-600 font-bold mb-2">ใช้แต้มลด {order.points_redeemed} 🌟 (-฿{Number(order.points_discount).toFixed(2)})</p>
                    )}

                    {/* ⭐️ SLIP_REJECTED — ให้ลูกค้าส่งสลิปใหม่ */}
                    {order.status === 'SLIP_REJECTED' && (
                      <div className="mb-3 bg-red-50 border border-red-100 rounded-lg p-3">
                        <p className="text-xs text-red-700 font-bold mb-2">⚠️ สลิปของท่านไม่ถูกต้อง กรุณาแนบสลิปใหม่ที่ถูกต้อง</p>
                        {order.reject_reason && <p className="text-xs text-gray-500 mb-2">เหตุผล: {order.reject_reason}</p>}
                        <label className="block cursor-pointer">
                          <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            try {
                              const fd = new FormData(); fd.append('slip', file);
                              const upRes = await api.post('/orders/upload-slip', fd);
                              await api.put(`/orders/${order.id}/resubmit-slip`, { slip_image: upRes.data.slip_url });
                              Swal.fire({ icon: 'success', title: 'ส่งสลิปใหม่สำเร็จ', text: 'รอพนักงานตรวจสอบสักครู่', showConfirmButton: false, timer: 2000 });
                              fetchMyOrders();
                            } catch (err: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: err.response?.data?.error }); }
                          }} />
                          <span className="block w-full text-center bg-red-600 text-white font-bold py-2 rounded-lg text-sm hover:bg-red-700 transition cursor-pointer">📎 แนบสลิปใหม่</span>
                        </label>
                      </div>
                    )}

                    {order.status === 'REFUND_REQUESTED' && (
                      <div className="mb-3 bg-purple-50 border border-purple-100 rounded-lg p-3 text-xs text-purple-700 font-bold">
                        💰 กรุณานำหลักฐานการโอนเงินมาที่ร้านสหกรณ์เพื่อรับเงินสดคืน
                      </div>
                    )}

                    <div className="flex justify-between items-center border-t border-gray-100 pt-3">
                      <span className="font-bold text-pink-600">ยอดรวม: ฿{Number(order.total_amount).toFixed(2)}</span>
                      {/* ⭐️ ยกเลิกได้เฉพาะก่อนเริ่มเตรียมของ (ยังไม่ผ่าน PREPARING) */}
                      {['PENDING_VERIFY', 'WAITING_CASH', 'SLIP_REJECTED'].includes(order.status) && (
                        <button onClick={() => handleCancelMyOrder(order)} className="bg-red-50 text-red-500 px-4 py-2 rounded-lg text-xs font-bold hover:bg-red-100 transition">
                          ขอยกเลิกออเดอร์
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}