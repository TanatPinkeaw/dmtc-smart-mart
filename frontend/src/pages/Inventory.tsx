// ✅ CHANGED: colors, layout → DMTC Mart theme
// 🔒 UNCHANGED: all state, handlers (addToReceiveList, updateQuantity, updateUnitCost, handleSubmitPurchase, fetchProducts, socket logic)

import { useState, useEffect } from 'react';
import { Boxes, Search, Plus, Minus, Trash2, PackagePlus, Truck, X } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { useSocket } from '../SocketContext';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';

interface Product { id: number; barcode: string; name: string; stock: number; cost: number; }
interface Supplier { id: number; name: string; }
interface ReceiveItem extends Product { receive_quantity: number; new_unit_cost: number; }

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [receiveList, setReceiveList] = useState<ReceiveItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  const socket = useSocket();

  useEffect(() => {
    fetchProducts(); fetchSuppliers();
    if (!socket) return;
    let debounceTimer: ReturnType<typeof setTimeout>;
    socket.on('stock_updated', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(fetchProducts, 300); });
    return () => { clearTimeout(debounceTimer); socket.off('stock_updated'); };
  }, [socket]);

  const fetchProducts = async () => { try { const res = await api.get('/products'); setProducts(res.data); } catch {} };
  const fetchSuppliers = async () => { try { const res = await api.get('/suppliers'); setSuppliers(res.data); } catch {} };
  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(searchQuery)));

  const addToReceiveList = (product: Product) => {
    setReceiveList(prev => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) return prev.map(i => i.id === product.id ? { ...i, receive_quantity: i.receive_quantity + 1 } : i);
      return [...prev, { ...product, receive_quantity: 1, new_unit_cost: Number(product.cost) || 0 }];
    });
  };
  const updateQuantity = (id: number, delta: number) => setReceiveList(prev => prev.map(i => i.id === id ? { ...i, receive_quantity: i.receive_quantity + delta } : i).filter(i => i.receive_quantity > 0));
  const updateUnitCost = (id: number, cost: number) => setReceiveList(prev => prev.map(i => i.id === id ? { ...i, new_unit_cost: cost } : i));
  const totalCost = receiveList.reduce((t, i) => t + i.new_unit_cost * i.receive_quantity, 0);

  const handleSubmitPurchase = async () => {
    if (receiveList.length === 0) return Swal.fire({ icon: 'warning', title: 'ไม่มีรายการสินค้า' });
    setLoading(true);
    try {
      await api.post('/purchases', { supplier_id: selectedSupplier || null, user_id: user.id, items: receiveList.map(i => ({ product_id: i.id, quantity: i.receive_quantity, unit_cost: i.new_unit_cost })) });
      Swal.fire({ icon: 'success', title: 'รับสินค้าเข้าคลังสำเร็จ!', showConfirmButton: false, timer: 1500 });
      setReceiveList([]); setSelectedSupplier(''); fetchProducts(); setIsReceiveOpen(false);
    } catch (err: any) { Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: getErrorMessage(err) }); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex h-full bg-gray-50 relative">

      {/* ── Product list ──────────────────────────────────────────────────────── */}
      <div className="w-full md:w-3/5 flex flex-col h-full border-r border-brand-border">
        {/* Header */}
        <div className="bg-gradient-to-r from-brand to-brand-dark px-4 py-3.5 shrink-0 space-y-3 shadow-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center"><Boxes size={16} className="text-white" /></div>
            <h1 className="text-lg font-semibold text-white">รับสินค้าเข้าคลัง</h1>
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="ค้นหาสินค้า / บาร์โค้ด..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-4 py-2 bg-white border border-brand-border rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand transition-colors duration-150" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 pb-28 md:pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredProducts.map(p => (
              <div key={p.id} className="bg-white border border-brand-border rounded-2xl p-3 flex justify-between items-center hover:border-brand-mid hover:shadow-lg hover:-translate-y-0.5 shadow-md transition-all duration-150">
                <div className="flex-1 pr-2 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                  <div className="flex gap-3 mt-0.5">
                    <span className="text-xs text-gray-400">สต๊อก <strong className="text-brand">{p.stock}</strong></span>
                    <span className="text-xs text-gray-400">ทุน ฿{Number(p.cost).toFixed(2)}</span>
                  </div>
                </div>
                <button onClick={() => addToReceiveList(p)} className="p-2 bg-brand-bg text-brand rounded-lg hover:bg-brand hover:text-white active:scale-90 transition-all duration-150 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  <PackagePlus size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mobile FAB ───────────────────────────────────────────────────────── */}
      <button onClick={() => setIsReceiveOpen(true)} className="md:hidden fixed bottom-20 right-4 z-40 bg-brand text-white px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 font-semibold text-sm hover:bg-brand-dark transition-all duration-150 active:scale-95">
        <Truck size={18} /> รายการรับของ
        {receiveList.length > 0 && <span className="bg-white text-brand text-xs font-bold px-1.5 py-0.5 rounded-full">{receiveList.length}</span>}
      </button>

      {/* ── Receive panel ─────────────────────────────────────────────────────── */}
      <div className={`${isReceiveOpen ? 'fixed inset-0 z-[60] flex' : 'hidden'} md:flex md:relative md:w-2/5 flex-col bg-white`}>
        {/* Panel header */}
        <div className="bg-gradient-to-r from-brand to-brand-dark px-4 py-3 flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-2">
            <Truck size={18} className="text-white" />
            <h2 className="text-sm font-semibold text-white">รายการรับของเข้า</h2>
          </div>
          <button onClick={() => setIsReceiveOpen(false)} className="md:hidden p-1.5 bg-white/20 rounded-lg text-white hover:bg-white/30 active:scale-90 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"><X size={18} /></button>
        </div>

        {/* Supplier */}
        <div className="px-4 py-3 border-b border-brand-border shrink-0">
          <label className="block text-xs font-medium text-gray-500 mb-1">ซัพพลายเออร์</label>
          <select value={selectedSupplier} onChange={e => setSelectedSupplier(Number(e.target.value))} className="w-full px-3 py-2 bg-brand-bg border border-brand-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand transition-colors duration-150">
            <option value="">-- ไม่ระบุ --</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {receiveList.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <PackagePlus size={36} className="text-brand-mid mb-3" />
              <p className="text-sm text-gray-500">เลือกสินค้าจากด้านซ้าย</p>
              <p className="text-xs text-gray-400 mt-1">เพื่อนำเข้าคลัง</p>
            </div>
          ) : receiveList.map(item => (
            <div key={item.id} className="bg-brand-bg border border-l-4 border-brand-border border-l-brand rounded-xl p-3 space-y-2 shadow-sm">
              <div className="flex justify-between items-start">
                <p className="text-sm font-semibold text-gray-900 truncate pr-2">{item.name}</p>
                <button onClick={() => updateQuantity(item.id, -item.receive_quantity)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-150 shrink-0"><Trash2 size={14} /></button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-[10px] font-medium text-gray-500 mb-1">ทุน/ชิ้น (฿)</p>
                  <input type="number" min="0" step="0.01" value={item.new_unit_cost} onChange={e => updateUnitCost(item.id, Number(e.target.value))}
                    className="w-full px-2 py-1.5 bg-white border border-brand-border rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand transition-colors duration-150" />
                </div>
                <div>
                  <p className="text-[10px] font-medium text-gray-500 mb-1 text-center">จำนวน</p>
                  <div className="flex items-center gap-1 bg-white border border-brand-border rounded-lg p-1">
                    <button onClick={() => updateQuantity(item.id, -1)} className="w-7 h-7 flex items-center justify-center hover:bg-brand-bg rounded text-gray-600 transition-colors duration-150"><Minus size={12} /></button>
                    <span className="text-sm font-bold text-gray-900 w-6 text-center">{item.receive_quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)} className="w-7 h-7 flex items-center justify-center hover:bg-brand-bg rounded text-gray-600 transition-colors duration-150"><Plus size={12} /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-brand-border p-4 pb-20 md:pb-4 bg-brand-bg rounded-t-2xl shadow-[0_-4px_16px_rgba(241,43,107,0.10)] shrink-0">
          <div className="flex justify-between text-sm font-semibold text-gray-700 mb-3 bg-white border border-brand-border rounded-lg shadow-sm p-3">
            <span>มูลค่ารวม</span>
            <span className="text-brand font-bold">฿{totalCost.toFixed(2)}</span>
          </div>
          <button onClick={handleSubmitPurchase} disabled={receiveList.length === 0 || loading}
            className="w-full py-3 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-xl shadow-sm transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
            <Truck size={16} /> {loading ? 'กำลังบันทึก...' : 'บันทึกเข้าคลัง'}
          </button>
        </div>
      </div>
    </div>
  );
}
