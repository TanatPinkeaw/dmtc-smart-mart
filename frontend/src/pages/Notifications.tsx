// 📄 pages/Notifications.tsx — หน้ารวมการแจ้งเตือนของผู้ใช้ (ออเดอร์/สลิป/สต๊อก ฯลฯ)
//    ทำอะไร: ดึงรายการแจ้งเตือนมาแสดง + กรอง + การ์ดสลิปไม่ผ่านมีปุ่มส่งสลิปใหม่ (UploadSlipModal)
// ✅ CHANGED: colors, layout → DMTC Mart theme
// 🔒 UNCHANGED: fetchNotifications, filteredNotis, all state/logic

import { useState, useEffect } from 'react';
import { Bell, Search, Clock, CheckCircle2 } from 'lucide-react';
import api from '../api';
import { useSocket } from '../SocketContext';
import { UploadSlipModal } from '../components/preorder/UploadSlipModal';

export default function Notifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [rejectedOrders, setRejectedOrders] = useState<any[]>([]);
  const [slipOrder, setSlipOrder] = useState<any>(null);
  const socket = useSocket();

  useEffect(() => { fetchNotifications(); fetchRejectedOrders(); }, []);

  // ⭐️ F8 — ฟัง Socket event แบบ real-time
  // หมายเหตุ: event ชื่อ order_verified / order_slip_rejected ตามที่ระบุใน spec ไม่มีจริงใน backend
  // ของจริง backend ยิง 'notification_user_<id>' (ข้อความส่วนตัวรวมทั้งตอน verify/reject สลิป) และ
  // 'shift_discrepancy_flagged' (ตรงตาม spec อยู่แล้ว) — เลยฟังจาก event จริงที่มี ไม่ใช่ชื่อสมมติ
  useEffect(() => {
    if (!socket) return;

    const userStr = localStorage.getItem('user');
    const userId = userStr ? JSON.parse(userStr).id : null;

    const prependLocalNoti = (message: string) => {
      // ใส่ id ชั่วคราวแบบ negative timestamp กันชนกับ id จริงจาก DB จนกว่าจะ fetch ใหม่
      setNotifications(prev => [
        { id: -Date.now(), message, is_read: false, created_at: new Date().toISOString() },
        ...prev,
      ]);
    };

    const handleShiftDiscrepancy = (data: { shift_id: number; cashier_id: number; discrepancy: number }) => {
      prependLocalNoti(`⚠️ กะ #${data.shift_id} ยอดเงินขาด/เกิน ${data.discrepancy} บาท รอ ADMIN อนุมัติ`);
    };

    const handleNotificationUser = (data: { message: string }) => {
      // ครอบคลุมทั้งกรณี verify (PENDING_VERIFY→PREPARING) และ reject (SLIP_REJECTED) เพราะ backend ยิง event เดียวกันทั้งคู่
      prependLocalNoti(data.message);
    };

    socket.on('shift_discrepancy_flagged', handleShiftDiscrepancy);
    if (userId) socket.on(`notification_user_${userId}`, handleNotificationUser);

    return () => {
      socket.off('shift_discrepancy_flagged', handleShiftDiscrepancy);
      if (userId) socket.off(`notification_user_${userId}`, handleNotificationUser);
    };
  }, [socket]);

  const fetchNotifications = async () => {
    try {
      const res = await api.get(`/notifications?t=${Date.now()}`);
      setNotifications(res.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  // ⭐️ ตาราง notifications เก็บแค่ (id, user_id, message, is_read, created_at) — ไม่มีคอลัมน์ชี้ว่า
  // แจ้งเตือนนี้เป็นเรื่องออเดอร์ไหน จึงต้องดึงเลขออเดอร์จากตัวข้อความที่ backend สร้าง
  // (server.js: `สลิปโอนเงินของออเดอร์ #<id> ไม่ถูกต้อง: ...`)
  // เพื่อไม่ให้เปราะเกินไป ไม่ได้เชื่อข้อความอย่างเดียว แต่เอาเลขที่ดึงได้ไปเทียบกับ "ออเดอร์จริงของ
  // ผู้ใช้ที่สถานะเป็น SLIP_REJECTED อยู่ตอนนี้" อีกชั้น — ถ้า parse พลาด หรือส่งสลิปใหม่ไปแล้ว
  // ปุ่มจะไม่ขึ้นเอง (self-correcting) ถ้าวันหลังเพิ่มคอลัมน์ order_id ในตาราง ให้เลิกใช้ตรงนี้ได้เลย
  const fetchRejectedOrders = async () => {
    try {
      const res = await api.get(`/orders?t=${Date.now()}`);
      setRejectedOrders((res.data || []).filter((o: any) => o.status === 'SLIP_REJECTED'));
    } catch (e) { console.error(e); }
  };

  const getRejectedOrderFor = (message: string) => {
    const m = message.match(/#(\d+)/);
    if (!m) return null;
    return rejectedOrders.find(o => String(o.id) === m[1]) || null;
  };

  // 🐛 FIX — เดิมคลิกรายการเดียวแต่ยิง read-all = มาร์คว่าอ่านทั้งกล่องบน server (UI อัปเดตแค่ตัวที่
  // คลิก เลยดูเหมือนถูก แต่พอ refresh ทีเดียวรายการที่ยังไม่ได้อ่านหายหมด) ตอนนี้มี endpoint
  // PUT /notifications/:id/read แล้ว มาร์คเฉพาะรายการที่คลิกจริงๆ
  // รายการที่มาจาก socket ยังไม่มี id จริงใน DB (ใช้ id ลบชั่วคราว) — มาร์คฝั่ง UI อย่างเดียว ไม่ต้องยิง API
  const handleMarkAsRead = async (id: number) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)));
    if (id < 0) return;
    try {
      await api.put(`/notifications/${id}/read`);
    } catch (e) {
      console.error(e);
      // ย้อน UI กลับถ้า persist ไม่สำเร็จ ไม่งั้นผู้ใช้เห็นว่าอ่านแล้วแต่ refresh มาก็ยังไม่อ่าน
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: false } : n)));
    }
  };

  // ⭐️ อ่านทั้งหมด — ทางเดียวที่จะมาร์คทั้งกล่องได้ ต้องเป็นการกดปุ่มของผู้ใช้เอง
  const handleMarkAllAsRead = async () => {
    const snapshot = notifications;
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    try {
      await api.put('/notifications/read-all');
    } catch (e) {
      console.error(e);
      setNotifications(snapshot);
    }
  };

  // ⭐️ F8 — เรียงใหม่สุดก่อน (backend ส่ง ORDER BY created_at DESC มาแล้ว, ของที่มาจาก socket ก็ prepend ไว้บนสุด — sort ซ้ำกันเหนียวกันกรณี clock ไม่ตรง)
  const sortedNotis = [...notifications].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const filteredNotis = sortedNotis.filter(n =>
    n.message.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const unread = notifications.filter(n => !n.is_read).length;

  return (
    // ⭐️ FIX: ปรับให้เหมือนหน้า POS/จอง — header เป็นแถบขาวกะทัดรัด (icon box + title) แทนหัวข้อใหญ่แบบเดิม
    <div className="min-h-screen bg-brand-bg pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gradient-to-r from-brand to-brand-dark px-4 py-3.5 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
            <Bell size={16} className="text-white" />
          </div>
          <h1 className="text-lg font-semibold text-white truncate">การแจ้งเตือน</h1>
        </div>
        {unread > 0 && (
          <div className="shrink-0 flex items-center gap-2">
            <span className="text-xs font-bold text-white bg-white/15 border border-white/20 px-3 py-1.5 rounded-full">
              {unread} ยังไม่อ่าน
            </span>
            <button
              onClick={handleMarkAllAsRead}
              className="text-xs font-bold text-brand bg-white px-3 py-1.5 rounded-full hover:bg-brand-bg active:scale-95 transition-all duration-150"
            >
              อ่านทั้งหมด
            </button>
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        {/* ⭐️ FIX: กรอบค้นหา — ใส่พื้นหลังขาว + เงา ให้เป็นกล่องแยกชัดเจนเหมือนกรอบแท็บหมวดหมู่หน้า POS/จอง */}
        <div className="relative mb-4 bg-white border border-brand-border rounded-full p-2.5 shadow-md">
          <Search size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="ค้นหาการแจ้งเตือน..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-7 pr-2 py-1 bg-transparent text-sm font-medium outline-none" />
        </div>

        {/* List */}
        <div className="bg-white border border-brand-border rounded-3xl shadow-md overflow-hidden">
          {loading ? (
            <div className="p-8 space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-10 h-10 bg-brand-border/40 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3.5 bg-brand-border/40 rounded-lg w-3/4" />
                    <div className="h-3 bg-brand-border/40 rounded-lg w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredNotis.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-brand-bg rounded-2xl flex items-center justify-center mb-3">
                <Bell size={24} className="text-brand-mid" />
              </div>
              <p className="text-sm font-medium text-gray-600">ไม่มีการแจ้งเตือน</p>
              <p className="text-xs text-gray-400 mt-1">50 รายการล่าสุดจะแสดงที่นี่</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {filteredNotis.map(noti => (
                <li key={noti.id} onClick={() => !noti.is_read && handleMarkAsRead(noti.id)}
                  className={`flex gap-3 p-4 hover:bg-brand-bg transition-colors duration-150 cursor-pointer ${!noti.is_read ? 'bg-brand-bg/50' : ''}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${!noti.is_read ? 'bg-brand text-white' : 'bg-gray-100 text-gray-400'}`}>
                    {noti.is_read ? <CheckCircle2 size={16} /> : <Bell size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!noti.is_read ? 'font-semibold text-gray-900' : 'text-gray-600'} leading-snug`}>{noti.message}</p>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                      <Clock size={10} /> {new Date(noti.created_at).toLocaleString('th-TH')}
                    </p>
                    {/* ⭐️ สลิปไม่ผ่าน = แก้ได้จากตรงนี้เลย ไม่ต้องออกไปหน้าสั่งจองแล้วเปิดประวัติออเดอร์
                        stopPropagation กันไม่ให้ไปทริกเกอร์ mark-as-read ของ <li> */}
                    {(() => {
                      const order = getRejectedOrderFor(noti.message);
                      if (!order) return null;
                      return (
                        <button
                          onClick={(e) => { e.stopPropagation(); setSlipOrder(order); }}
                          className="mt-2.5 px-4 py-2 rounded-full bg-gradient-to-br from-red-500 to-red-600 text-white text-xs font-bold transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
                        >
                          ส่งสลิปใหม่
                        </button>
                      );
                    })()}
                  </div>
                  {!noti.is_read && <div className="w-2 h-2 bg-brand rounded-full mt-2 shrink-0" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {slipOrder && (
        <UploadSlipModal
          orderId={slipOrder.id}
          rejectReason={slipOrder.reject_reason}
          onClose={() => setSlipOrder(null)}
          onUploaded={fetchRejectedOrders}
        />
      )}
    </div>
  );
}
