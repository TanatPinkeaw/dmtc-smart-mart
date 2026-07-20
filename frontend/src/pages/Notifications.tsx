// ✅ CHANGED: colors, layout → DMTC Mart theme
// 🔒 UNCHANGED: fetchNotifications, filteredNotis, all state/logic

import { useState, useEffect } from 'react';
import { Bell, Search, Clock, CheckCircle2 } from 'lucide-react';
import api from '../api';
import { useSocket } from '../SocketContext';

export default function Notifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const socket = useSocket();

  useEffect(() => { fetchNotifications(); }, []);

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

  // ⭐️ F8 — mark as read เมื่อคลิก
  // หมายเหตุ: backend มีแค่ PUT /api/notifications/read-all (อ่านทั้งหมด) ไม่มี endpoint อ่านทีละรายการ
  // เลยทำ optimistic update เฉพาะรายการที่คลิก (UI ตอบสนองทันที) + เรียก read-all เบื้องหลังเพื่อ persist จริง
  const handleMarkAsRead = async (id: number) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)));
    try {
      await api.put('/notifications/read-all');
    } catch (e) { console.error(e); }
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
      <div className="sticky top-0 z-10 bg-white border-b border-brand-border px-4 py-3 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 bg-brand rounded-lg flex items-center justify-center shrink-0">
            <Bell size={15} className="text-white" />
          </div>
          <h1 className="text-base font-bold text-gray-900 truncate">การแจ้งเตือน</h1>
        </div>
        {unread > 0 && (
          <span className="shrink-0 text-xs font-bold text-brand bg-brand-bg border border-brand-border px-3 py-1.5 rounded-full">
            {unread} ยังไม่อ่าน
          </span>
        )}
      </div>

      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        {/* ⭐️ FIX: กรอบค้นหา — ใส่พื้นหลังขาว + เงา ให้เป็นกล่องแยกชัดเจนเหมือนกรอบแท็บหมวดหมู่หน้า POS/จอง */}
        <div className="relative mb-4 bg-white border border-brand-border rounded-xl p-2.5 shadow-sm">
          <Search size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="ค้นหาการแจ้งเตือน..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-7 pr-2 py-1 bg-transparent text-sm outline-none" />
        </div>

        {/* List */}
        <div className="bg-white border border-brand-border rounded-2xl shadow-sm overflow-hidden">
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
                  </div>
                  {!noti.is_read && <div className="w-2 h-2 bg-brand rounded-full mt-2 shrink-0" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
