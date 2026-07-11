import { useState, useEffect } from 'react';
import { Boxes, Search, Plus, Minus, Trash2, PackagePlus, Truck, X } from 'lucide-react';
import api from '../api';

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

  // ⭐️ State ควบคุมตะกร้ารับของในมือถือ
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => { fetchProducts(); fetchSuppliers(); }, []);
  const fetchProducts = async () => { try { const res = await api.get('/products'); setProducts(res.data); } catch (e) { } };
  const fetchSuppliers = async () => { try { const res = await api.get('/suppliers'); setSuppliers(res.data); } catch (e) { } };

  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(searchQuery)));

  const addToReceiveList = (product: Product) => {
    setReceiveList((prev) => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) return prev.map(item => item.id === product.id ? { ...item, receive_quantity: item.receive_quantity + 1 } : item);
      return [...prev, { ...product, receive_quantity: 1, new_unit_cost: Number(product.cost) || 0 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setReceiveList(prev => prev.map(item => item.id === id ? { ...item, receive_quantity: item.receive_quantity + delta } : item).filter(item => item.receive_quantity > 0));
  };
  const updateUnitCost = (id: number, cost: number) => { setReceiveList(prev => prev.map(item => item.id === id ? { ...item, new_unit_cost: cost } : item)); };

  const totalCost = receiveList.reduce((total, item) => total + (item.new_unit_cost * item.receive_quantity), 0);

  const handleSubmitPurchase = async () => {
    if (receiveList.length === 0) return alert("ไม่มีรายการสินค้า");
    setLoading(true);
    try {
      const payload = { supplier_id: selectedSupplier || null, user_id: user.id, items: receiveList.map(item => ({ product_id: item.id, quantity: item.receive_quantity, unit_cost: item.new_unit_cost })) };
      await api.post('/purchases', payload);
      alert("รับสินค้าเข้าคลัง และอัปเดตต้นทุนสำเร็จ! 🎉");
      setReceiveList([]); setSelectedSupplier(''); fetchProducts(); setIsReceiveOpen(false);
    } catch (error: any) { alert(`เกิดข้อผิดพลาด: ${error.response?.data?.error || 'ไม่สามารถบันทึกได้'}`); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex h-full bg-gray-50 font-sans relative">

      {/* ================= ฝั่งซ้าย: สินค้า ================= */}
      <div className="w-full md:w-2/3 flex flex-col md:border-r border-gray-200 h-full">
        <div className="bg-white p-4 md:p-6 shadow-sm z-10 flex flex-col gap-3 md:gap-4 shrink-0">
          <div className="flex items-center gap-2 md:gap-3 text-indigo-600">
            <Boxes size={24} className="md:w-7 md:h-7" />
            <h1 className="text-lg md:text-2xl font-bold text-gray-800">รับสินค้าเข้าคลัง</h1>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input type="text" placeholder="ค้นหาสินค้า / บาร์โค้ด..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2.5 md:py-3 text-sm md:text-base bg-gray-100 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white transition" />
          </div>
        </div>

        {/* เพิ่ม pb-24 สำหรับมือถือกันปุ่มลอยบัง */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            {filteredProducts.map(product => (
              <div key={product.id} className="bg-white p-3 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center hover:shadow-md transition">
                <div className="flex-1 pr-2">
                  <h3 className="font-bold text-gray-800 text-sm md:text-base line-clamp-1">{product.name}</h3>
                  <div className="flex flex-col sm:flex-row sm:gap-4 mt-1 text-xs md:text-sm">
                    <span className="text-gray-500">สต๊อก: <strong className="text-blue-600">{product.stock}</strong></span>
                    <span className="text-gray-500">ทุนเดิม: <strong>฿{Number(product.cost).toFixed(2)}</strong></span>
                  </div>
                </div>
                <button onClick={() => addToReceiveList(product)} className="bg-indigo-50 text-indigo-600 p-2 md:p-3 rounded-lg md:rounded-xl hover:bg-indigo-600 hover:text-white transition shrink-0">
                  <PackagePlus size={20} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ⭐️ ปุ่มตะกร้ารับของลอย (แสดงเฉพาะจอมือถือ) */}
      <button
        onClick={() => setIsReceiveOpen(true)}
        className="md:hidden fixed bottom-20 right-4 bg-indigo-600 text-white px-5 py-3 rounded-full shadow-2xl flex items-center justify-center gap-2 z-40 font-bold hover:bg-indigo-700 transition"
      >
        <Truck size={20} /> ตะกร้ารับของ
        {receiveList.length > 0 && (
          <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full border border-indigo-600">
            {receiveList.length}
          </span>
        )}
      </button>

      {/* ================= ฝั่งขวา: ตะกร้ารับของเข้า (Popup ในมือถือ) ================= */}
      <div className={`
        ${isReceiveOpen ? 'fixed inset-0 z-[60] flex animate-fade-in' : 'hidden'}
        md:flex md:relative md:w-1/3 flex-col bg-white shadow-2xl md:shadow-xl md:z-20
      `}>
        <div className="p-4 md:p-6 bg-indigo-600 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 md:gap-3">
            <Truck size={20} className="md:w-6 md:h-6" />
            <h2 className="text-lg md:text-xl font-bold">รายการรับของเข้า</h2>
          </div>
          <button onClick={() => setIsReceiveOpen(false)} className="md:hidden p-1.5 bg-indigo-700 rounded-lg text-white"><X size={20} /></button>
        </div>

        <div className="p-3 md:p-4 border-b border-gray-100 bg-gray-50 shrink-0">
          <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1 md:mb-2">ซัพพลายเออร์</label>
          <select value={selectedSupplier} onChange={(e) => setSelectedSupplier(Number(e.target.value))} className="w-full p-2.5 md:p-3 text-sm md:text-base border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
            <option value="">-- ไม่ระบุ --</option>
            {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2 md:space-y-3 bg-gray-50">
          {receiveList.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 text-center">
              <PackagePlus size={40} className="mb-3 opacity-30 md:w-12 md:h-12" />
              <p className="text-sm md:text-base">เลือกสินค้าจากด้านซ้าย<br />เพื่อนำเข้าคลัง</p>
            </div>
          ) : (
            receiveList.map((item) => (
              <div key={item.id} className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-2 md:gap-3">
                <div className="flex justify-between items-start">
                  <p className="font-bold text-gray-800 line-clamp-1 text-sm md:text-base">{item.name}</p>
                  <button onClick={() => updateQuantity(item.id, -item.receive_quantity)} className="text-red-400 hover:text-red-600 p-1 bg-red-50 rounded-md"><Trash2 size={16} /></button>
                </div>
                <div className="flex items-center justify-between gap-2 md:gap-4">
                  <div className="flex-1">
                    <label className="text-[10px] md:text-xs text-gray-500 font-medium">ทุน/ชิ้น (฿)</label>
                    <input type="number" min="0" step="0.01" value={item.new_unit_cost} onChange={(e) => updateUnitCost(item.id, Number(e.target.value))} className="w-full p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-xs md:text-sm font-bold mt-1" />
                  </div>
                  <div className="w-24 md:w-auto">
                    <label className="text-[10px] md:text-xs text-gray-500 font-medium mb-1 block text-center">จำนวน</label>
                    <div className="flex items-center justify-between bg-gray-100 rounded-lg p-1">
                      <button onClick={() => updateQuantity(item.id, -1)} className="p-1 md:p-1.5 hover:bg-white rounded text-gray-600"><Minus size={12} /></button>
                      <span className="text-center font-bold text-gray-800 text-xs md:text-sm w-6">{item.receive_quantity}</span>
                      <button onClick={() => updateQuantity(item.id, 1)} className="p-1 md:p-1.5 hover:bg-white rounded text-gray-600"><Plus size={12} /></button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ⭐️ เติม pb-10 ตรงนี้ ดันปุ่มบันทึกให้กดง่ายขึ้น */}
        <div className="p-4 pb-24 md:p-6 bg-white border-t border-gray-200 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
          <div className="flex justify-between text-base md:text-lg font-bold mb-3 md:mb-4 text-gray-600">
            <span>มูลค่ารวมล็อตนี้:</span>
            <span className="text-indigo-600">฿{totalCost.toFixed(2)}</span>
          </div>
          <button onClick={handleSubmitPurchase} disabled={receiveList.length === 0 || loading} className={`w-full py-3 md:py-4 rounded-xl text-base md:text-xl font-bold text-white transition shadow-lg flex justify-center items-center gap-2 ${receiveList.length === 0 ? 'bg-gray-300 cursor-not-allowed shadow-none' : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95'}`}>
            {loading ? 'กำลังบันทึก...' : <><Truck size={20} /> บันทึกเข้าคลัง</>}
          </button>
        </div>
      </div>

    </div>
  );
}