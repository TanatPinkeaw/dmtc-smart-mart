import { useState, useEffect } from 'react';
import { PackageSearch, CheckCircle, Clock, Eye, AlertCircle, X, Search, User, Phone, Wallet } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { useSocket } from '../SocketContext';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { formatBangkokTime } from '../utils/timezone'; // ⭐️ Sprint 2 — B8
import AuthImage, { openAuthImage } from '../components/AuthImage'; // ⭐️ SECURITY FIX #1 — โหลดสลิปผ่าน JWT

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

// ⭐️ ป้ายสถานะไทยไว้ขึ้นในป๊อปอัปยืนยัน/สำเร็จ ให้พนักงานอ่านรู้เรื่องแทนรหัสดิบ
const STAFF_STATUS_LABEL: Record<string, string> = {
  PENDING_VERIFY: 'รอตรวจสลิป',
  WAITING_CASH: 'รอรับเงินสด',
  PREPARING: 'กำลังเตรียมของ',
  READY: 'พร้อมให้มารับ',
  COMPLETED: 'รับของแล้ว',
  SLIP_REJECTED: 'สลิปไม่ผ่าน',
  REFUND_REQUESTED: 'ขอคืนเงิน',
  CANCELLED: 'ยกเลิก',
};

export default function OrderManagement() {
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  const socket = useSocket();
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);

  // ⭐️ เพิ่ม State สำหรับช่องค้นหา
  const [searchTerm, setSearchTerm] = useState('');

  // ⭐️ F3 — แท็บ: รอดำเนินการ / รอตรวจสลิป / เสร็จสมบูรณ์
  const [activeTab, setActiveTab] = useState<'pending' | 'slips' | 'rejected' | 'completed'>('pending');
  // ⭐️ F3 — หมายเหตุตอนตรวจสลิปผ่าน (บังคับ 5 ตัวอักษรขึ้นไป)
  const [verifyNotes, setVerifyNotes] = useState('');

  useEffect(() => {
    fetchOrders();

    if (!socket) return;

    socket.on('new_order_received', (data) => {
      Swal.fire({
        toast: true, position: 'top-end', icon: 'info',
        title: '🔔 มีออเดอร์ใหม่เข้ามา!',
        text: `ออเดอร์ #${data.order_id}`,
        showConfirmButton: false, timer: 3000
      });
      fetchOrders();
    });

    // ⭐️ ดักฟังกรณีมีพนักงานอีกคน (หรือเครื่องอื่น) กดอัปเดตสถานะออเดอร์ไปแล้ว
    socket.on('order_status_changed', () => {
      fetchOrders(); // สั่งให้ดึงข้อมูลออเดอร์ใหม่ทั้งหมดทันที
    });

    return () => {
      socket.off('new_order_received');
      socket.off('order_status_changed');
    };
  }, [socket]);

  // ⭐️ Auto-refresh orders ทุก 5 วินาที (fallback ถ้า socket miss event)
  useEffect(() => {
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchOrders = async () => {
    try {
      // ⭐️ เติม ?t=${Date.now()} เพื่อบังคับให้ดึงข้อมูลใหม่จาก Server 100% ไม่ใช่จากแคช
      const res = await api.get(`/orders?t=${Date.now()}`);
      setOrders(res.data);
      
      setSelectedOrder((prevSelected: any) => {
        if (!prevSelected) return null;
        const updatedOrder = res.data.find((o: any) => o.id === prevSelected.id);
        return updatedOrder || null;
      });
    } catch (err) {
      console.error(err);
    }
  };
  const handleClaim = async (orderId: number) => {
    setClaiming(true);
    try {
      await api.post(`/orders/${orderId}/assign`);
      fetchOrders();
      // refresh selected order
      setSelectedOrder((prev: any) => prev?.id === orderId ? { ...prev, assigned_to: user.id, assigned_name: user.full_name } : prev);
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'รับงานไม่ได้', text: getErrorMessage(err) });
    } finally { setClaiming(false); }
  };

  const handleUpdateStatus = async (orderId: number, status: string, isReject = false, notes?: string) => {
    if (isReject && !rejectReason.trim()) {
      return Swal.fire({ icon: 'warning', title: 'กรุณาระบุเหตุผล', text: 'ต้องใส่เหตุผลที่ยกเลิกบิล เพื่อแจ้งให้ลูกค้าแก้ไขครับ' });
    }

    const confirm = await Swal.fire({
      title: 'ยืนยันการทำรายการ?',
      text: isReject ? `ยกเลิกออเดอร์นี้เพราะ: ${rejectReason}` : 'ต้องการเปลี่ยนสถานะออเดอร์ใช่หรือไม่?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: isReject ? '#ef4444' : '#10b981',
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ปิด'
    });

    if (!confirm.isConfirmed) return;

    setLoading(true);
    try {
      // ⭐️ F3 — ส่ง notes แนบไปด้วยถ้ามี (เช่น หมายเหตุตอนตรวจสลิปผ่าน) backend รับเป็น alias ของ reject_reason
      await api.put(`/orders/${orderId}/status`, { status, reject_reason: rejectReason, notes });
      Swal.fire({
        icon: 'success',
        title: isReject ? 'ปฏิเสธออเดอร์แล้ว' : 'เรียบร้อย!',
        text: isReject ? 'แจ้งเหตุผลให้ลูกค้าแล้ว' : `เปลี่ยนสถานะเป็น “${STAFF_STATUS_LABEL[status] || status}” แล้ว`,
        showConfirmButton: false, timer: 1600
      });
      setSelectedOrder(null);
      setRejectReason('');
      setVerifyNotes('');
      fetchOrders(); // ⭐️ ดึงข้อมูลใหม่ทันที ไม่รอ socket round-trip (เดิมรอ socket เด้งกลับมาสั่ง fetch เอง ทำให้ต้องกด 2 รอบ)
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: getErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'WAITING_CASH': return <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-fit"><Clock size={14}/> รอจ่ายเงินสดหน้าร้าน</span>;
      case 'PENDING_VERIFY': return <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-fit"><AlertCircle size={14}/> รอตรวจสลิป</span>;
      case 'PREPARING': return <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-fit"><PackageSearch size={14}/> กำลังเตรียมของ</span>;
      case 'READY': return <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-fit"><CheckCircle size={14}/> ของพร้อมรับ</span>;
      case 'COMPLETED': return <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs font-bold w-fit">สำเร็จแล้ว</span>;
      case 'CANCELLED': return <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-bold w-fit">ยกเลิก</span>;
      case 'SLIP_REJECTED': return <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold w-fit">⚠️ รอสลิปใหม่</span>;
      case 'REFUND_REQUESTED': return <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-xs font-bold w-fit">💰 รอคืนเงิน</span>;
      default: return <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs font-bold w-fit">{status}</span>;
    }
  };

  // ⭐️ ฟังก์ชันเปลี่ยนคำในปุ่มตามสถานะของบิล
  const getButtonActionText = (status: string) => {
    switch (status) {
      case 'PENDING_VERIFY': return <><Eye size={18}/> ดูรายละเอียด & ตรวจสลิป</>;
      case 'WAITING_CASH': return <><Eye size={18}/> ดูรายละเอียด & รับเงินสด</>;
      case 'PREPARING': return <><Eye size={18}/> ดูรายละเอียด & อัปเดตเตรียมของ</>;
      case 'READY': return <><Eye size={18}/> ดูรายละเอียด & ยืนยันลูกค้ามารับ</>;
      default: return <><Eye size={18}/> ดูรายละเอียดบิล</>;
    }
  };

  // ⭐️ ระบบค้นหา: กรองออเดอร์ก่อนเอาไปแยกกลุ่ม
  const filteredOrders = orders.filter(o => 
    String(o.id).includes(searchTerm) || 
    (o.customer_name && o.customer_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (o.phone_number && o.phone_number.includes(searchTerm))
  );

  const TERMINAL = ['COMPLETED', 'CANCELLED'];
  // ⭐️ F3 — PENDING_VERIFY (รอตรวจสลิป) แยกออกมาเป็นแท็บของตัวเอง ไม่ปนกับ "รอดำเนินการ" ทั่วไป
  const pendingSlipOrders = filteredOrders.filter(o => o.status === 'PENDING_VERIFY');
  // ⭐️ SLIP_REJECTED (รอสลิปใหม่) — ให้ลูกค้าส่งสลิปใหม่ แยกแท็บเป็นของตัวเอง
  const rejectedSlipOrders = filteredOrders.filter(o => o.status === 'SLIP_REJECTED');
  const activeOrders = filteredOrders.filter(o => !TERMINAL.includes(o.status) && o.status !== 'PENDING_VERIFY' && o.status !== 'SLIP_REJECTED');
  // ⭐️ F3 — "เสร็จสมบูรณ์" รวม CANCELLED ด้วย (ของเดิม historyOrders ก็แสดงทั้งคู่) กันบิลที่ยกเลิกแล้วหายไปจากหน้าจอ
  // ไม่ได้กรองเฉพาะ slip_verification_status='VERIFIED' ตามสเปกตรงตัว เพราะจะซ่อนบิลจ่ายเงินสด (ไม่มี slip เลย) ไปด้วย — ใช้ badge บอกแทน
  const completedOrders = filteredOrders.filter(o => TERMINAL.includes(o.status));

  return (
    // ⭐️ FIX: ปรับให้เหมือนหน้า POS/จอง — header เป็นแถบขาวกะทัดรัด (icon box + title), ช่องค้นหาเป็น
    // bg-brand-bg แบบเดียวกัน และแท็บเปลี่ยนจากขีดเส้นใต้เป็นแบบเม็ดยา (pill) ในกรอบขาวเหมือนแท็บหมวดหมู่
    <div className="bg-brand-bg min-h-screen pb-24">
      <div className="bg-white border-b border-brand-border px-4 py-3 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 bg-brand rounded-lg flex items-center justify-center shrink-0">
            <PackageSearch size={15} className="text-white" />
          </div>
          <h1 className="text-base font-bold text-gray-900 truncate">จัดการออเดอร์สั่งจอง</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* ⭐️ กล่องค้นหา */}
        <div className="relative mb-4">
          <input
            type="text"
            placeholder="ค้นหา เลขบิล, ชื่อ, เบอร์โทร..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-brand-bg rounded-lg border border-brand-border outline-none focus:outline-none focus:ring-2 focus:ring-brand text-sm transition-colors duration-150"
          />
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>

        {/* ⭐️ F3 — แท็บสลับมุมมอง (เม็ดยาในกรอบขาว + fade เลื่อน เหมือนแท็บหมวดหมู่หน้า POS/จอง) */}
        <div className="relative bg-white border border-brand-border rounded-xl p-2.5 mb-6 shadow-sm">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {[
              { key: 'pending' as const, label: 'รอดำเนินการ', count: activeOrders.length },
              { key: 'slips' as const, label: '📋 รอตรวจสลิป', count: pendingSlipOrders.length },
              { key: 'rejected' as const, label: '⚠️ รอสลิปใหม่', count: rejectedSlipOrders.length },
              { key: 'completed' as const, label: 'เสร็จสมบูรณ์', count: completedOrders.length },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${activeTab === tab.key ? 'bg-brand text-white' : 'bg-brand-bg text-brand hover:bg-brand-border'}`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === tab.key ? 'bg-white/25 text-white' : 'bg-white text-brand-dark'}`}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute right-2.5 top-2.5 bottom-2.5 w-8 bg-gradient-to-l from-white to-transparent rounded-r-xl" />
        </div>

        {/* 🔴 ออเดอร์ที่กำลังดำเนินการ */}
        {activeTab === 'pending' && (<>
        <h2 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></span> ออเดอร์รอดำเนินการ
        </h2>

        {activeOrders.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl border border-brand-border text-center text-gray-400 mb-8 shadow-sm">
            <CheckCircle size={48} className="mx-auto mb-3 opacity-30"/>
            <p>{searchTerm ? 'ไม่พบออเดอร์ที่ค้นหา' : 'ยังไม่มีออเดอร์ใหม่ในขณะนี้'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {activeOrders.map(order => (
              // ⭐️ FIX: ออกแบบการ์ดใหม่ให้อ่านง่ายขึ้น — แยกชื่อลูกค้าเป็นแถวมีไอคอน แทนบล็อกตัวหนา
              // ทับกันหมด, ดึงยอดรวมออกมาเป็นแถบไฮไลต์แยกให้เด่นสุดในสายตา (ไม่ใช่แค่บรรทัดสุดท้ายในกล่อง)
              <div key={order.id} className="bg-white p-4 rounded-2xl shadow-sm border border-brand-border hover:shadow-md transition-all duration-150">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">ออเดอร์ #{order.id}</h3>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><Clock size={11} /> {formatBangkokTime(order.created_at)}</p>
                  </div>
                  {getStatusBadge(order.status)}
                </div>

                <div className="space-y-2 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-brand-bg rounded-lg flex items-center justify-center shrink-0"><User size={14} className="text-brand" /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-800 truncate">{order.customer_name}</p>
                      {order.assigned_name && <p className="text-[10px] text-blue-600 font-bold">👤 {order.assigned_name} รับงานนี้</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-1 text-xs text-gray-500">
                    <Phone size={13} className="text-gray-400 shrink-0" /> {order.phone_number || '-'}
                  </div>
                  <div className="flex items-center gap-2 pl-1 text-xs text-gray-500">
                    <Wallet size={13} className="text-gray-400 shrink-0" /> {order.payment_method === 'QR' ? 'สแกนจ่าย' : 'เงินสดหน้าร้าน'}
                  </div>
                </div>

                {/* ⭐️ FIX: เดิมไม่มีเส้นขอบ พื้นชมพูอ่อนกลืนกับพื้นขาวของการ์ดจนดูไม่มีขอบเขต เพิ่ม
                    border ให้ทั้งกล่องยอดรวมและปุ่มดูรายละเอียดเห็นขอบชัดเจนขึ้น */}
                <div className="flex justify-between items-center bg-brand-bg border border-brand-border rounded-xl px-3 py-2.5 mb-3">
                  <span className="text-xs text-gray-500 font-medium">ยอดรวม</span>
                  <span className="text-lg font-bold text-brand">฿{Number(order.total_amount).toFixed(2)}</span>
                </div>

                {/* ⭐️ ปุ่มกดที่จะเปลี่ยนคำพูดตามสถานะบิล */}
                <button onClick={() => setSelectedOrder(order)} className="w-full bg-brand-bg border border-brand-border text-brand-dark font-bold py-2.5 rounded-xl hover:bg-brand-border transition-colors duration-150 flex items-center justify-center gap-2">
                  {getButtonActionText(order.status)}
                </button>
              </div>
            ))}
          </div>
        )}
        </>)}

        {/* ⭐️ F3 — แท็บ "รอตรวจสลิป" (status = PENDING_VERIFY) */}
        {activeTab === 'slips' && (<>
        <h2 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></span> ออเดอร์รอตรวจสลิป
        </h2>
        {pendingSlipOrders.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl border border-brand-border text-center text-gray-400 mb-8 shadow-sm">
            <CheckCircle size={48} className="mx-auto mb-3 opacity-30"/>
            <p>ไม่มีสลิปรอตรวจสอบในขณะนี้</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {pendingSlipOrders.map(order => (
              <div key={order.id} className="bg-white p-4 rounded-2xl shadow-sm border border-brand-border hover:shadow-md transition-all duration-150">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">ออเดอร์ #{order.id}</h3>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><Clock size={11} /> อัปโหลดสลิป {new Date(order.created_at).toLocaleString('th-TH')}</p>
                  </div>
                  {getStatusBadge(order.status)}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 bg-brand-bg rounded-lg flex items-center justify-center shrink-0"><User size={14} className="text-brand" /></div>
                  <p className="text-sm font-bold text-gray-800 truncate">{order.customer_name}</p>
                </div>

                <div className="flex justify-between items-center bg-brand-bg border border-brand-border rounded-xl px-3 py-2.5 mb-3">
                  <span className="text-xs text-gray-500 font-medium">ยอดรวม</span>
                  <span className="text-lg font-bold text-brand">฿{Number(order.total_amount).toFixed(2)}</span>
                </div>

                <button onClick={() => setSelectedOrder(order)} className="w-full bg-blue-50 border border-blue-200 text-blue-700 font-bold py-2.5 rounded-xl hover:bg-blue-100 transition-colors duration-150 flex items-center justify-center gap-2">
                  <Eye size={18}/> ดูสลิป & ตรวจสอบ
                </button>
              </div>
            ))}
          </div>
        )}
        </>)}

        {/* ⚠️ F3 — แท็บ "รอสลิปใหม่" (status = SLIP_REJECTED) ให้ลูกค้าส่งสลิปใหม่ */}
        {activeTab === 'rejected' && (<>
        <h2 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></span> ออเดอร์รอสลิปใหม่
        </h2>
        {rejectedSlipOrders.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl border border-brand-border text-center text-gray-400 mb-8 shadow-sm">
            <CheckCircle size={48} className="mx-auto mb-3 opacity-30"/>
            <p>ไม่มีสลิปที่ถูกปฏิเสธในขณะนี้</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {rejectedSlipOrders.map(order => (
              <div key={order.id} className="bg-white p-4 rounded-2xl shadow-sm border border-brand-border hover:shadow-md transition-all duration-150">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">ออเดอร์ #{order.id}</h3>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><Clock size={11} /> รอสลิปใหม่ {new Date(order.created_at).toLocaleString('th-TH')}</p>
                  </div>
                  {getStatusBadge(order.status)}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 bg-brand-bg rounded-lg flex items-center justify-center shrink-0"><User size={14} className="text-brand" /></div>
                  <p className="text-sm font-bold text-gray-800 truncate">{order.customer_name}</p>
                </div>

                <div className="flex justify-between items-center bg-brand-bg border border-brand-border rounded-xl px-3 py-2.5 mb-3">
                  <span className="text-xs text-gray-500 font-medium">ยอดรวม</span>
                  <span className="text-lg font-bold text-brand">฿{Number(order.total_amount).toFixed(2)}</span>
                </div>

                {order.reject_reason && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">
                    <p className="text-xs text-red-600"><span className="font-bold">เหตุผล:</span> {order.reject_reason}</p>
                  </div>
                )}

                <button onClick={() => setSelectedOrder(order)} className="w-full bg-red-50 border border-red-200 text-red-700 font-bold py-2.5 rounded-xl hover:bg-red-100 transition-colors duration-150 flex items-center justify-center gap-2">
                  <Eye size={18}/> ดูสลิปเดิม & รับสลิปใหม่
                </button>
              </div>
            ))}
          </div>
        )}
        </>)}

        {/* ⚪️ แท็บ "เสร็จสมบูรณ์" */}
        {activeTab === 'completed' && (<>
        <h2 className="text-lg font-bold text-gray-700 mb-4">ออเดอร์ที่เสร็จสมบูรณ์แล้ว</h2>

        {/* ⭐️ FIX: เดิม table มีแค่ overflow-x-auto ไม่มี mobile fallback บนมือถือต้องเลื่อนซ้ายขวา
            อ่านยาก เพิ่ม card list สำหรับ mobile (< sm) ตรงนี้ */}
        <div className="sm:hidden space-y-3 mb-8">
          {completedOrders.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-brand-border text-center text-gray-400 shadow-sm">
              <CheckCircle size={40} className="mx-auto mb-3 opacity-30" />
              <p>{searchTerm ? 'ไม่พบออเดอร์ที่ค้นหา' : 'ยังไม่มีออเดอร์ที่เสร็จสมบูรณ์'}</p>
            </div>
          ) : completedOrders.map(order => (
            <div key={`m-${order.id}`} className="bg-white border border-brand-border rounded-xl p-4 shadow-sm">
              <div className="flex justify-between items-start mb-2 gap-2">
                <h3 className="font-bold text-gray-800">#{order.id}</h3>
                {getStatusBadge(order.status)}
              </div>
              <p className="text-sm text-gray-600 mb-1">{order.customer_name}</p>
              {order.slip_verification_status === 'VERIFIED' && <span className="text-[10px] font-bold text-green-600">✅ ตรวจสลิปแล้ว</span>}
              <div className="flex justify-between items-center mt-3">
                <span className="font-bold text-brand">฿{Number(order.total_amount).toFixed(2)}</span>
                <button onClick={() => setSelectedOrder(order)} className="text-brand hover:text-brand-dark font-bold text-sm bg-brand-bg px-3 py-1.5 rounded-lg">ดูบิล</button>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden sm:block bg-white rounded-2xl shadow-sm border border-brand-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-600 text-sm">
                <tr>
                  <th className="p-4 border-b">เลขที่บิล</th>
                  <th className="p-4 border-b">ชื่อลูกค้า</th>
                  <th className="p-4 border-b">ยอดรวม</th>
                  <th className="p-4 border-b">สถานะ</th>
                  <th className="p-4 border-b text-center">ดูบิล</th>
                </tr>
              </thead>
              <tbody>
                {completedOrders.map(order => (
                  <tr key={order.id} className="border-b last:border-0 hover:bg-brand-bg">
                    <td className="p-4 font-bold">#{order.id}</td>
                    <td className="p-4 text-sm">{order.customer_name}</td>
                    <td className="p-4 font-bold text-brand">฿{Number(order.total_amount).toFixed(2)}</td>
                    <td className="p-4">
                      {getStatusBadge(order.status)}
                      {order.slip_verification_status === 'VERIFIED' && <span className="ml-1 text-[10px] font-bold text-green-600">✅ ตรวจสลิปแล้ว</span>}
                    </td>
                    <td className="p-4 text-center">
                      <button onClick={() => setSelectedOrder(order)} className="text-brand hover:text-brand-dark font-bold text-sm bg-brand-bg px-3 py-1.5 rounded-lg">ดูบิล</button>
                    </td>
                  </tr>
                ))}
                {completedOrders.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-400">{searchTerm ? 'ไม่พบออเดอร์ที่ค้นหา' : 'ยังไม่มีออเดอร์ที่เสร็จสมบูรณ์'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        </>)}
      </div>

      {/* ================= ⭐️ Modal แสดงรายละเอียดออเดอร์ ================= */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
            
            <div className="p-4 border-b border-brand-border flex justify-between items-center bg-brand-bg shrink-0">
              <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">รายละเอียดออเดอร์ #{selectedOrder.id}</h2>
              <button onClick={() => {setSelectedOrder(null); setRejectReason(''); setVerifyNotes('');}} className="p-1 hover:bg-brand-border text-gray-500 rounded-lg"><X size={20}/></button>
            </div>

            <div className="p-4 md:p-6 overflow-y-auto flex-1 flex flex-col md:flex-row gap-6">
              
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-bold text-gray-700">สถานะปัจจุบัน:</h3>
                  {getStatusBadge(selectedOrder.status)}
                </div>

                <h3 className="font-bold text-gray-700 mb-3">รายการสินค้า</h3>
                <div className="space-y-3 mb-4">
                  {selectedOrder.items.map((item: any) => (
                    <div key={item.id} className="flex justify-between items-center border-b border-brand-bg pb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-gray-100 rounded-md overflow-hidden flex items-center justify-center">
                          {item.image_url ? <img src={item.image_url} className="w-full h-full object-cover"/> : <PackageSearch size={20} className="text-gray-400"/>}
                        </div>
                        <div>
                          <p className="font-bold text-sm text-gray-800 line-clamp-1">{item.product_name}</p>
                          <p className="text-xs text-gray-500">{item.quantity} x ฿{Number(item.price).toFixed(2)}</p>
                        </div>
                      </div>
                      <p className="font-bold text-brand text-sm">฿{Number(item.subtotal).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-brand-bg p-4 rounded-xl border border-brand-border">
                  <div className="flex justify-between font-bold text-lg">
                    <span>ยอดรวมทั้งสิ้น:</span>
                    <span className="text-brand">฿{Number(selectedOrder.total_amount).toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">วิธีชำระเงิน: {selectedOrder.payment_method === 'QR' ? 'โอนเงิน (แนบสลิป)' : 'เงินสดหน้าร้าน'}</p>
                </div>
              </div>

              <div className="w-full md:w-64 shrink-0 flex flex-col">
                <h3 className="font-bold text-gray-700 mb-3">หลักฐานการชำระเงิน</h3>
                {selectedOrder.payment_method === 'QR' ? (
                  <div className="bg-gray-100 rounded-xl border border-gray-200 overflow-hidden flex-1 min-h-[200px] max-h-[300px] flex items-center justify-center relative group">
                    {selectedOrder.slip_image ? (
                      <AuthImage
                        path={getSlipImagePath(selectedOrder.created_at, selectedOrder.slip_image)}
                        alt="Slip"
                        className="w-full h-full object-contain cursor-pointer"
                        onClick={() => openAuthImage(getSlipImagePath(selectedOrder.created_at, selectedOrder.slip_image))}
                        fallback={<p className="text-sm text-gray-400">โหลดรูปสลิปไม่ได้</p>}
                      />
                    ) : (
                      <p className="text-sm text-gray-400">ไม่พบรูปสลิป</p>
                    )}
                    {selectedOrder.slip_image && (
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition pointer-events-none">
                        <span className="text-white text-xs font-bold"><Eye size={20} className="mx-auto mb-1"/> กดเพื่อดูรูปใหญ่</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-yellow-50 rounded-xl border border-yellow-200 flex-1 min-h-[150px] flex flex-col items-center justify-center p-4 text-center">
                    <Clock size={32} className="text-yellow-400 mb-2"/>
                    <p className="text-sm font-bold text-yellow-700">ชำระด้วยเงินสด</p>
                    <p className="text-xs text-yellow-600 mt-1">ลูกค้าจะนำเงินมาจ่ายที่หน้าร้านตอนรับของ</p>
                  </div>
                )}
              </div>
            </div>

            {/* ================= Assignment Banner ================= */}
            {!['COMPLETED', 'CANCELLED'].includes(selectedOrder.status) && (() => {
              const isMine = selectedOrder.assigned_to === user.id;
              const isUnclaimed = !selectedOrder.assigned_to;
              const isTaken = selectedOrder.assigned_to && !isMine && user.role !== 'ADMIN';
              return (
                // ⭐️ FIX: แถบนี้ pin อยู่นอกกรอบ scroll (ไม่ scroll ตามเนื้อหา) เดิมไม่มี shadow/เส้นแบ่งชัดเจน
                // บนจอเล็กเลยดูเหมือนทับซ้อนกับรูปสลิปด้านบน — เพิ่มเงายกขึ้นให้เห็นชัดว่าเป็นแถบ pin แยกต่างหาก
                <div className={`relative z-10 px-4 py-2.5 border-t text-xs font-bold flex items-center justify-between shadow-[0_-2px_6px_rgba(0,0,0,0.05)] ${isMine ? 'bg-green-50 text-green-700' : isTaken ? 'bg-red-50 text-red-600' : 'bg-yellow-50 text-yellow-700'}`}>
                  {isMine && <span>✅ นายรับงานนี้อยู่</span>}
                  {isUnclaimed && <span>⚡ ยังไม่มีพนักงานรับงาน</span>}
                  {selectedOrder.assigned_name && !isMine && <span>{isTaken ? '🔒 ' : '👤 '}{selectedOrder.assigned_name} รับงานนี้แล้ว</span>}
                  {(isUnclaimed) && (
                    <button onClick={() => handleClaim(selectedOrder.id)} disabled={claiming} className="bg-yellow-400 text-yellow-900 px-3 py-1 rounded-lg hover:bg-yellow-500 transition disabled:opacity-50">
                      {claiming ? '...' : '✋ รับงานนี้'}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* ================= Action Buttons ================= */}
            {!['COMPLETED', 'CANCELLED', 'REFUND_REQUESTED'].includes(selectedOrder.status) && (() => {
              // ⭐️ ถ้ามีคนอื่น claim ไปแล้ว และไม่ใช่ ADMIN → ซ่อนปุ่มทั้งหมด
              const locked = selectedOrder.assigned_to && selectedOrder.assigned_to !== user.id && user.role !== 'ADMIN';
              if (locked) return <div className="p-4 border-t bg-red-50 text-red-600 text-sm text-center font-bold">🔒 ออเดอร์นี้อยู่ในการดูแลของ {selectedOrder.assigned_name}</div>;
              return (
              <div className="p-4 border-t border-brand-border bg-gray-50 shrink-0 space-y-2">

                {/* QR: ตรวจสลิป */}
                {selectedOrder.status === 'PENDING_VERIFY' && (
                  <>
                    <button
                      onClick={() => handleUpdateStatus(selectedOrder.id, 'PREPARING')}
                      disabled={loading}
                      className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ✅ ยืนยันสลิปถูกต้อง → เริ่มเตรียมของ
                    </button>
                    <div className="border border-red-100 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-bold text-red-600">สลิปผิด / มีปัญหา (จำเป็น อย่างน้อย 5 ตัวอักษร):</p>
                      <textarea rows={2} placeholder="ระบุเหตุผล..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-500 resize-none"/>
                      <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => handleUpdateStatus(selectedOrder.id, 'SLIP_REJECTED', true)} disabled={loading || rejectReason.trim().length < 5} className="bg-yellow-500 text-white font-bold py-2 rounded-lg hover:bg-yellow-600 transition text-xs disabled:opacity-40 disabled:cursor-not-allowed">↩️ ขอสลิปใหม่</button>
                        <button onClick={() => handleUpdateStatus(selectedOrder.id, 'REFUND_REQUESTED', true)} disabled={loading || rejectReason.trim().length < 5} className="bg-purple-500 text-white font-bold py-2 rounded-lg hover:bg-purple-600 transition text-xs disabled:opacity-40 disabled:cursor-not-allowed">💰 คืนเงิน</button>
                        <button onClick={() => handleUpdateStatus(selectedOrder.id, 'CANCELLED', true)} disabled={loading || rejectReason.trim().length < 5} className="bg-red-500 text-white font-bold py-2 rounded-lg hover:bg-red-600 transition text-xs disabled:opacity-40 disabled:cursor-not-allowed">🚫 ยกเลิก</button>
                      </div>
                    </div>
                  </>
                )}

                {/* QR: ลูกค้าส่งสลิปใหม่แล้ว (SLIP_REJECTED → ตรวจใหม่) */}
                {selectedOrder.status === 'SLIP_REJECTED' && (
                  <>
                    <p className="text-sm font-bold text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">⚠️ รอลูกค้าส่งสลิปใหม่ — พอลูกค้าส่งสลิปใหม่มาให้กดตรวจสอบ</p>
                    <button onClick={() => handleUpdateStatus(selectedOrder.id, 'PENDING_VERIFY')} disabled={loading} className="w-full bg-blue-100 text-blue-700 font-bold py-3 rounded-xl hover:bg-blue-200 transition">🔍 ตรวจสลิปใหม่</button>
                    <button onClick={() => handleUpdateStatus(selectedOrder.id, 'CANCELLED', true)} disabled={loading} className="w-full bg-gray-200 text-gray-700 font-bold py-2 rounded-xl hover:bg-gray-300 transition text-sm">ยกเลิกบิล</button>
                  </>
                )}

                {/* CASH: ยืนยัน order */}
                {selectedOrder.status === 'WAITING_CASH' && (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button onClick={() => handleUpdateStatus(selectedOrder.id, 'PREPARING')} disabled={loading} className="flex-1 bg-orange-500 text-white font-bold py-3 rounded-xl hover:bg-orange-600 transition">✅ ยืนยัน → เริ่มเตรียมของ</button>
                    <button onClick={() => handleUpdateStatus(selectedOrder.id, 'CANCELLED', true)} disabled={loading} className="bg-gray-400 text-white font-bold px-4 py-3 rounded-xl hover:bg-gray-500 transition text-sm">ยกเลิก</button>
                  </div>
                )}

                {/* เตรียมของเสร็จ — ⭐️ FIX: เอาปุ่ม "ยกเลิกบิล" ออก เพราะ backend บล็อกยกเลิกออเดอร์สถานะ
                    PREPARING/READY ไว้แล้ว (เริ่มเตรียมสินค้าไปแล้ว) กดไปก็เจอ error ทุกครั้ง ปุ่มนี้ไม่มีประโยชน์ */}
                {selectedOrder.status === 'PREPARING' && (
                  <button onClick={() => handleUpdateStatus(selectedOrder.id, 'READY')} disabled={loading} className="w-full bg-green-500 text-white font-bold py-3 rounded-xl hover:bg-green-600 flex items-center justify-center gap-2 transition">
                    <CheckCircle size={20}/> เตรียมของเสร็จ → แจ้งลูกค้ามารับ
                  </button>
                )}

                {/* ลูกค้ามารับ */}
                {selectedOrder.status === 'READY' && (
                  <button onClick={() => handleUpdateStatus(selectedOrder.id, 'COMPLETED')} disabled={loading} className="w-full bg-brand text-white font-bold py-3 rounded-xl hover:bg-brand-dark flex items-center justify-center gap-2 transition">
                    <CheckCircle size={20}/> {selectedOrder.payment_method === 'CASH' ? 'รับเงิน ทอนแล้ว → ปิดบิล' : 'ลูกค้ารับของแล้ว → ปิดบิล'}
                  </button>
                )}
              </div>
              );
            })()}

            {/* REFUND_REQUESTED panel */}
            {selectedOrder.status === 'REFUND_REQUESTED' && (
              <div className="p-4 border-t border-purple-100 bg-purple-50 shrink-0">
                <p className="text-sm font-bold text-purple-700 mb-2">💰 รอคืนเงิน — ลูกค้าต้องนำหลักฐานการโอนมาที่ร้าน</p>
                <button onClick={() => handleUpdateStatus(selectedOrder.id, 'CANCELLED')} disabled={loading} className="w-full bg-purple-600 text-white font-bold py-3 rounded-xl hover:bg-purple-700 transition">✅ คืนเงินสดแล้ว → ปิดบิล</button>
              </div>
            )}
            
          </div>
        </div>
      )}

    </div>
  );
}