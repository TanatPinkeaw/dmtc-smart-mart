import { useState, useEffect } from 'react';
import { PackageSearch, CheckCircle, Clock, Eye, AlertCircle, X, Search } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { useSocket } from '../SocketContext';

export default function OrderManagement() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const socket = useSocket();
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  
  // ⭐️ เพิ่ม State สำหรับช่องค้นหา
  const [searchTerm, setSearchTerm] = useState('');

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
      Swal.fire({ icon: 'error', title: 'รับงานไม่ได้', text: err.response?.data?.error });
    } finally { setClaiming(false); }
  };

  const handleUpdateStatus = async (orderId: number, status: string, isReject = false) => {
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
      await api.put(`/orders/${orderId}/status`, { status, reject_reason: rejectReason });
      Swal.fire({ icon: 'success', title: 'อัปเดตสถานะสำเร็จ', showConfirmButton: false, timer: 1500 });
      setSelectedOrder(null);
      setRejectReason('');
      fetchOrders(); // ⭐️ ดึงข้อมูลใหม่ทันที ไม่รอ socket round-trip (เดิมรอ socket เด้งกลับมาสั่ง fetch เอง ทำให้ต้องกด 2 รอบ)
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.response?.data?.error });
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
  const activeOrders = filteredOrders.filter(o => !TERMINAL.includes(o.status));
  const historyOrders = filteredOrders.filter(o => TERMINAL.includes(o.status));

  return (
    <div className="p-4 md:p-6 bg-pink-50 min-h-screen pb-24">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
            <PackageSearch className="text-pink-600" size={28}/> จัดการออเดอร์สั่งจอง
          </h1>

          {/* ⭐️ กล่องค้นหา */}
          <div className="relative w-full md:w-72">
            <input 
              type="text" 
              placeholder="ค้นหา เลขบิล, ชื่อ, เบอร์โทร..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-pink-200 outline-none focus:ring-2 focus:ring-pink-500 text-sm shadow-sm"
            />
            <Search size={18} className="absolute left-3 top-3 text-gray-400" />
          </div>
        </div>

        {/* 🔴 ออเดอร์ที่กำลังดำเนินการ */}
        <h2 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></span> ออเดอร์รอดำเนินการ
        </h2>
        
        {activeOrders.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl border border-pink-100 text-center text-gray-400 mb-8 shadow-sm">
            <CheckCircle size={48} className="mx-auto mb-3 opacity-30"/>
            <p>{searchTerm ? 'ไม่พบออเดอร์ที่ค้นหา' : 'ยังไม่มีออเดอร์ใหม่ในขณะนี้'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {activeOrders.map(order => (
              <div key={order.id} className="bg-white p-4 rounded-2xl shadow-sm border border-pink-100 hover:shadow-md transition">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">ออเดอร์ #{order.id}</h3>
                    <p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleString('th-TH')}</p>
                  </div>
                  {getStatusBadge(order.status)}
                </div>
                
                <div className="bg-pink-50 p-3 rounded-xl mb-4">
                  <p className="text-sm font-bold text-gray-700"><span className="text-gray-500">ลูกค้า:</span> {order.customer_name}</p>
                  {order.assigned_name && <p className="text-xs text-blue-600 font-bold">👤 {order.assigned_name} รับงานนี้</p>}
                  <p className="text-sm font-bold text-gray-700"><span className="text-gray-500">โทร:</span> {order.phone_number || '-'}</p>
                  <p className="text-sm font-bold text-gray-700"><span className="text-gray-500">ชำระเงิน:</span> {order.payment_method === 'QR' ? '📱 สแกนจ่าย' : '💵 เงินสด'}</p>
                  <p className="text-lg font-bold text-pink-600 mt-1">ยอดรวม: ฿{Number(order.total_amount).toFixed(2)}</p>
                </div>
                
                {/* ⭐️ ปุ่มกดที่จะเปลี่ยนคำพูดตามสถานะบิล */}
                <button onClick={() => setSelectedOrder(order)} className="w-full bg-pink-100 text-pink-700 font-bold py-2.5 rounded-xl hover:bg-pink-200 transition flex items-center justify-center gap-2">
                  {getButtonActionText(order.status)}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ⚪️ ประวัติออเดอร์ที่เสร็จแล้ว */}
        <h2 className="text-lg font-bold text-gray-700 mb-4">ประวัติออเดอร์ที่ปิดบิลแล้ว</h2>
        <div className="bg-white rounded-2xl shadow-sm border border-pink-100 overflow-hidden">
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
                {historyOrders.map(order => (
                  <tr key={order.id} className="border-b last:border-0 hover:bg-pink-50">
                    <td className="p-4 font-bold">#{order.id}</td>
                    <td className="p-4 text-sm">{order.customer_name}</td>
                    <td className="p-4 font-bold text-pink-600">฿{Number(order.total_amount).toFixed(2)}</td>
                    <td className="p-4">{getStatusBadge(order.status)}</td>
                    <td className="p-4 text-center">
                      <button onClick={() => setSelectedOrder(order)} className="text-pink-600 hover:text-pink-800 font-bold text-sm bg-pink-100 px-3 py-1.5 rounded-lg">ดูบิล</button>
                    </td>
                  </tr>
                ))}
                {historyOrders.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-400">{searchTerm ? 'ไม่พบออเดอร์ที่ค้นหา' : 'ยังไม่มีประวัติบิลเก่า'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ================= ⭐️ Modal แสดงรายละเอียดออเดอร์ ================= */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            
            <div className="p-4 border-b border-pink-100 flex justify-between items-center bg-pink-50 shrink-0">
              <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">รายละเอียดออเดอร์ #{selectedOrder.id}</h2>
              <button onClick={() => {setSelectedOrder(null); setRejectReason('');}} className="p-1 hover:bg-pink-200 text-gray-500 rounded-lg"><X size={20}/></button>
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
                    <div key={item.id} className="flex justify-between items-center border-b border-pink-50 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-gray-100 rounded-md overflow-hidden flex items-center justify-center">
                          {item.image_url ? <img src={item.image_url} className="w-full h-full object-cover"/> : <PackageSearch size={20} className="text-gray-400"/>}
                        </div>
                        <div>
                          <p className="font-bold text-sm text-gray-800 line-clamp-1">{item.product_name}</p>
                          <p className="text-xs text-gray-500">{item.quantity} x ฿{Number(item.price).toFixed(2)}</p>
                        </div>
                      </div>
                      <p className="font-bold text-pink-600 text-sm">฿{Number(item.subtotal).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-pink-50 p-4 rounded-xl border border-pink-100">
                  <div className="flex justify-between font-bold text-lg">
                    <span>ยอดรวมทั้งสิ้น:</span>
                    <span className="text-pink-600">฿{Number(selectedOrder.total_amount).toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">วิธีชำระเงิน: {selectedOrder.payment_method === 'QR' ? 'โอนเงิน (แนบสลิป)' : 'เงินสดหน้าร้าน'}</p>
                </div>
              </div>

              <div className="w-full md:w-64 shrink-0 flex flex-col">
                <h3 className="font-bold text-gray-700 mb-3">หลักฐานการชำระเงิน</h3>
                {selectedOrder.payment_method === 'QR' ? (
                  <div className="bg-gray-100 rounded-xl border border-gray-200 overflow-hidden flex-1 min-h-[200px] max-h-[300px] flex items-center justify-center relative group">
                    {selectedOrder.slip_image ? (
                      <img src={`http://localhost:3000${selectedOrder.slip_image}`} alt="Slip" className="w-full h-full object-contain cursor-pointer" onClick={() => window.open(`http://localhost:3000${selectedOrder.slip_image}`, '_blank')}/>
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
                <div className={`px-4 py-2 border-t text-xs font-bold flex items-center justify-between ${isMine ? 'bg-green-50 text-green-700' : isTaken ? 'bg-red-50 text-red-600' : 'bg-yellow-50 text-yellow-700'}`}>
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
              <div className="p-4 border-t border-pink-100 bg-gray-50 shrink-0 space-y-2">

                {/* QR: ตรวจสลิป */}
                {selectedOrder.status === 'PENDING_VERIFY' && (
                  <>
                    <button onClick={() => handleUpdateStatus(selectedOrder.id, 'PREPARING')} disabled={loading} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition">✅ สลิปถูกต้อง → เริ่มเตรียมของ</button>
                    <div className="border border-red-100 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-bold text-red-600">สลิปผิด / มีปัญหา:</p>
                      <input type="text" placeholder="ระบุเหตุผล..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-500"/>
                      <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => handleUpdateStatus(selectedOrder.id, 'SLIP_REJECTED', true)} disabled={loading} className="bg-yellow-500 text-white font-bold py-2 rounded-lg hover:bg-yellow-600 transition text-xs">↩️ ขอสลิปใหม่</button>
                        <button onClick={() => handleUpdateStatus(selectedOrder.id, 'REFUND_REQUESTED', true)} disabled={loading} className="bg-purple-500 text-white font-bold py-2 rounded-lg hover:bg-purple-600 transition text-xs">💰 คืนเงิน</button>
                        <button onClick={() => handleUpdateStatus(selectedOrder.id, 'CANCELLED', true)} disabled={loading} className="bg-red-500 text-white font-bold py-2 rounded-lg hover:bg-red-600 transition text-xs">🚫 ยกเลิก</button>
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

                {/* เตรียมของเสร็จ */}
                {selectedOrder.status === 'PREPARING' && (
                  <>
                    <button onClick={() => handleUpdateStatus(selectedOrder.id, 'READY')} disabled={loading} className="w-full bg-green-500 text-white font-bold py-3 rounded-xl hover:bg-green-600 flex items-center justify-center gap-2 transition">
                      <CheckCircle size={20}/> เตรียมของเสร็จ → แจ้งลูกค้ามารับ
                    </button>
                    <button onClick={() => handleUpdateStatus(selectedOrder.id, 'CANCELLED', true)} disabled={loading} className="w-full bg-gray-200 text-gray-700 font-bold py-2 rounded-xl hover:bg-gray-300 transition text-sm">ยกเลิกบิล</button>
                  </>
                )}

                {/* ลูกค้ามารับ */}
                {selectedOrder.status === 'READY' && (
                  <button onClick={() => handleUpdateStatus(selectedOrder.id, 'COMPLETED')} disabled={loading} className="w-full bg-pink-600 text-white font-bold py-3 rounded-xl hover:bg-pink-700 flex items-center justify-center gap-2 transition">
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