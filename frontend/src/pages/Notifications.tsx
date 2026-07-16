// ✅ CHANGED: colors, layout → DMTC Mart theme
// 🔒 UNCHANGED: fetchNotifications, filteredNotis, all state/logic

import { useState, useEffect } from 'react';
import { Bell, Search, Clock, CheckCircle2 } from 'lucide-react';
import api from '../api';

export default function Notifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchNotifications(); }, []);

  const fetchNotifications = async () => {
    try {
      const res = await api.get(`/notifications?t=${Date.now()}`);
      setNotifications(res.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const filteredNotis = notifications.filter(n =>
    n.message.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const unread = notifications.filter(n => !n.is_read).length;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-2xl mx-auto p-4 sm:p-6">

        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Bell size={20} className="text-[#F12B6B]" /> การแจ้งเตือน
              </h1>
              {unread > 0 && <p className="text-xs text-[#F12B6B] font-medium mt-0.5">{unread} รายการยังไม่อ่าน</p>}
            </div>
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="ค้นหาการแจ้งเตือน..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150" />
          </div>
        </div>

        {/* List */}
        <div className="bg-white border border-[#F6C7C7] rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-8 space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-10 h-10 bg-[#F6C7C7]/40 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3.5 bg-[#F6C7C7]/40 rounded-lg w-3/4" />
                    <div className="h-3 bg-[#F6C7C7]/40 rounded-lg w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredNotis.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-[#FFF5F7] rounded-2xl flex items-center justify-center mb-3">
                <Bell size={24} className="text-[#FD94B4]" />
              </div>
              <p className="text-sm font-medium text-gray-600">ไม่มีการแจ้งเตือน</p>
              <p className="text-xs text-gray-400 mt-1">50 รายการล่าสุดจะแสดงที่นี่</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {filteredNotis.map(noti => (
                <li key={noti.id} className={`flex gap-3 p-4 hover:bg-[#FFF5F7] transition-colors duration-150 ${!noti.is_read ? 'bg-[#FFF5F7]/50' : ''}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${!noti.is_read ? 'bg-[#F12B6B] text-white' : 'bg-gray-100 text-gray-400'}`}>
                    {noti.is_read ? <CheckCircle2 size={16} /> : <Bell size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!noti.is_read ? 'font-semibold text-gray-900' : 'text-gray-600'} leading-snug`}>{noti.message}</p>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                      <Clock size={10} /> {new Date(noti.created_at).toLocaleString('th-TH')}
                    </p>
                  </div>
                  {!noti.is_read && <div className="w-2 h-2 bg-[#F12B6B] rounded-full mt-2 shrink-0" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
