import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Store, History, Users, Tags, Truck, Package, Trash2, Save, Eye, Calendar, Plus, X, Edit } from 'lucide-react'; // ⭐️ นำเข้าไอคอน Edit
import Swal from '../swal';
import api from '../api';

const getLocalDate = () => {
  const tzoffset = (new Date()).getTimezoneOffset() * 60000;
  return new Date(Date.now() - tzoffset).toISOString().split('T')[0];
};

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'STORE' | 'HISTORY' | 'USERS' | 'CATEGORIES' | 'SUPPLIERS' | 'PRODUCTS'>('STORE');
  
  // ⭐️ เพิ่ม 'EDIT_PRODUCT' ใน activeModal
  const [activeModal, setActiveModal] = useState<'ADD_PRODUCT' | 'EDIT_PRODUCT' | 'ADD_CATEGORY' | 'ADD_SUPPLIER' | 'ADD_USER' | null>(null);

  const [storeInfo, setStoreInfo] = useState({ store_name: '', tax_id: '', address: '', receipt_footer: '' });
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]); 

  const [newUser, setNewUser] = useState({ username: '', password: '', full_name: '', role: 'CASHIER' });
  const [newCategory, setNewCategory] = useState('');
  const [newSupplier, setNewSupplier] = useState({ name: '', contact_info: '' });
  const [newProduct, setNewProduct] = useState({ barcode: '', name: '', category_id: '', price: '', stock: '', image_url: '' });
  
  // ⭐️ State สำหรับเก็บข้อมูลสินค้าที่กำลังถูกกดแก้ไข
  const [editingProduct, setEditingProduct] = useState<any>(null);

  const [startDate, setStartDate] = useState(getLocalDate());
  const [endDate, setEndDate] = useState(getLocalDate());
  const [viewingBillItems, setViewingBillItems] = useState<any[] | null>(null);
  const [viewingBillInfo, setViewingBillInfo] = useState<any | null>(null);

  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    fetchStoreSettings();
    if (activeTab === 'HISTORY') fetchSalesHistory();
    if (activeTab === 'USERS') fetchUsers();
    if (activeTab === 'CATEGORIES') fetchCategories();
    if (activeTab === 'SUPPLIERS') fetchSuppliers();
    if (activeTab === 'PRODUCTS') { fetchProducts(); fetchCategories(); }
  }, [activeTab]);

  const fetchStoreSettings = async () => { const res = await api.get('/settings/store'); setStoreInfo(res.data); };
  const fetchUsers = async () => { const res = await api.get('/users'); setUsers(res.data.filter((u:any) => u.is_active !== 0)); };
  const fetchCategories = async () => { const res = await api.get('/categories'); setCategories(res.data); };
  const fetchSuppliers = async () => { const res = await api.get('/suppliers'); setSuppliers(res.data); };
  const fetchProducts = async () => { const res = await api.get('/products'); setProducts(res.data); };
  const fetchSalesHistory = async () => { try { const res = await api.get(`/sales/history?start_date=${startDate}&end_date=${endDate}`); setSalesHistory(res.data); } catch (error) { console.error(error); } };

  // ================= ACTION FUNCTIONS =================
  const handleViewBill = async (bill: any) => {
    try { const res = await api.get(`/sales/history/${bill.id}`); setViewingBillItems(res.data); setViewingBillInfo(bill); } 
    catch (error) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: 'ไม่สามารถดึงข้อมูลบิลได้' }); }
  };
  
  const handleSaveStore = async (e: React.FormEvent) => { 
    e.preventDefault(); 
    await api.put('/settings/store', storeInfo); 
    Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ!', showConfirmButton: false, timer: 1500 }); 
  };
  
  const handleVoidBill = async (saleId: number) => {
    const res = await Swal.fire({ title: 'ยกเลิกบิลนี้?', text: `บิล #${saleId} จะถูกยกเลิก และคืนสต๊อกสินค้า`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ใช่, ยกเลิกบิล', cancelButtonText: 'ปิด' });
    if (!res.isConfirmed) return;
    try { 
      await api.post(`/sales/${saleId}/void`, { user_role: currentUser.role }); 
      fetchSalesHistory(); if (viewingBillInfo?.id === saleId) setViewingBillInfo(null); 
      Swal.fire({ icon: 'success', title: 'ยกเลิกบิลสำเร็จ', showConfirmButton: false, timer: 1500 });
    } catch (err: any) { Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.response?.data?.error }); }
  };

  const handleAddUser = async (e: React.FormEvent) => { e.preventDefault(); try { await api.post('/users', newUser); setNewUser({ username: '', password: '', full_name: '', role: 'CASHIER' }); fetchUsers(); setActiveModal(null); Swal.fire({ icon: 'success', title: 'เพิ่มพนักงานสำเร็จ', showConfirmButton: false, timer: 1500 }); } catch (err: any) { Swal.fire({ icon: 'error', text: err.response?.data?.error }); } };
  const handleAddCategory = async (e: React.FormEvent) => { e.preventDefault(); await api.post('/categories', { name: newCategory }); setNewCategory(''); fetchCategories(); setActiveModal(null); Swal.fire({ icon: 'success', title: 'เพิ่มหมวดหมู่สำเร็จ', showConfirmButton: false, timer: 1500 }); };
  const handleAddSupplier = async (e: React.FormEvent) => { e.preventDefault(); await api.post('/suppliers', newSupplier); setNewSupplier({ name: '', contact_info: '' }); fetchSuppliers(); setActiveModal(null); Swal.fire({ icon: 'success', title: 'เพิ่มซัพพลายเออร์สำเร็จ', showConfirmButton: false, timer: 1500 }); };
  
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try { 
      await api.post('/products', { ...newProduct, category_id: newProduct.category_id ? Number(newProduct.category_id) : null, price: Number(newProduct.price), stock: Number(newProduct.stock) || 0 }); 
      setNewProduct({ barcode: '', name: '', category_id: '', price: '', stock: '', image_url: '' }); fetchProducts(); setActiveModal(null); 
      Swal.fire({ icon: 'success', title: 'เพิ่มสินค้าสำเร็จ', showConfirmButton: false, timer: 1500 }); 
    } 
    catch (err: any) { Swal.fire({ icon: 'error', text: err.response?.data?.error }); }
  };

  // ⭐️ ฟังก์ชันสำหรับการ "แก้ไขสินค้า"
  const handleEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.put(`/products/${editingProduct.id}`, {
        barcode: editingProduct.barcode,
        name: editingProduct.name,
        category_id: editingProduct.category_id ? Number(editingProduct.category_id) : null,
        price: Number(editingProduct.price),
        image_url: editingProduct.image_url
      });
      fetchProducts();
      setActiveModal(null);
      setEditingProduct(null);
      Swal.fire({ icon: 'success', title: 'แก้ไขสินค้าสำเร็จ!', showConfirmButton: false, timer: 1500 });
    } catch (err: any) {
      Swal.fire({ icon: 'error', text: err.response?.data?.error || 'เกิดข้อผิดพลาดในการแก้ไข' });
    }
  };

  const handleDeleteCategory = async (id: number) => { const res = await Swal.fire({ title: 'ลบหมวดหมู่นี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if(!res.isConfirmed) return; try { await api.delete(`/categories/${id}`); fetchCategories(); } catch(err:any){ Swal.fire({ icon: 'error', text: err.response?.data?.error }); } };
  const handleDeleteProduct = async (id: number) => { const res = await Swal.fire({ title: 'ลบสินค้านี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if(!res.isConfirmed) return; try { await api.delete(`/products/${id}`); fetchProducts(); } catch(err:any){ Swal.fire({ icon: 'error', text: err.response?.data?.error }); } };
  const handleDeleteUser = async (id: number) => { const res = await Swal.fire({ title: 'ลบพนักงานคนนี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if(!res.isConfirmed) return; try { await api.delete(`/users/${id}`); fetchUsers(); } catch(err:any){ Swal.fire({ icon: 'error', text: err.response?.data?.error }); } };
  const handleDeleteSupplier = async (id: number) => { const res = await Swal.fire({ title: 'ลบซัพพลายเออร์นี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if(!res.isConfirmed) return; try { await api.delete(`/suppliers/${id}`); fetchSuppliers(); } catch(err:any){ Swal.fire({ icon: 'error', text: err.response?.data?.error }); } };

  return (
    <div className="min-h-screen bg-pink-50 font-sans p-4 md:p-6 relative pb-20 md:pb-6">
      
      {/* Header */}
      <div className="max-w-7xl mx-auto flex items-center gap-3 text-pink-600 mb-6 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-pink-100">
        <SettingsIcon size={28} className="md:w-8 md:h-8 shrink-0" />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-800">แผงควบคุม (Admin)</h1>
          <p className="text-gray-500 text-xs md:text-sm">จัดการข้อมูลหลักในระบบ</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-6">
        
        {/* Sidebar Tabs */}
        <div className="w-full md:w-64 flex flex-row md:flex-col gap-2 shrink-0 overflow-x-auto pb-2 md:pb-0 scrollbar-hide snap-x">
          <TabButton icon={<Store size={18}/>} label="ร้านค้า" isActive={activeTab === 'STORE'} onClick={() => setActiveTab('STORE')} />
          <TabButton icon={<History size={18}/>} label="ประวัติขาย" isActive={activeTab === 'HISTORY'} onClick={() => setActiveTab('HISTORY')} />
          <TabButton icon={<Package size={18}/>} label="สินค้า" isActive={activeTab === 'PRODUCTS'} onClick={() => setActiveTab('PRODUCTS')} />
          <TabButton icon={<Tags size={18}/>} label="หมวดหมู่" isActive={activeTab === 'CATEGORIES'} onClick={() => setActiveTab('CATEGORIES')} />
          <TabButton icon={<Truck size={18}/>} label="ซัพพลายเออร์" isActive={activeTab === 'SUPPLIERS'} onClick={() => setActiveTab('SUPPLIERS')} />
          <TabButton icon={<Users size={18}/>} label="พนักงาน" isActive={activeTab === 'USERS'} onClick={() => setActiveTab('USERS')} />
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-pink-100 p-4 md:p-8 min-h-[500px] relative">
          
          {/* TAB 1: ร้านค้า */}
          {activeTab === 'STORE' && (
            <form onSubmit={handleSaveStore} className="space-y-4 animate-fade-in max-w-2xl">
              <h2 className="text-lg md:text-xl font-bold mb-4 flex items-center gap-2"><Store className="text-pink-500"/> ข้อมูลร้านค้า</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="ชื่อร้าน" value={storeInfo.store_name} onChange={(v:any) => setStoreInfo({...storeInfo, store_name: v})} />
                <Input label="เลขผู้เสียภาษี" value={storeInfo.tax_id || ''} required={false} onChange={(v:any) => setStoreInfo({...storeInfo, tax_id: v})} />
              </div>
              <Input label="ที่อยู่" value={storeInfo.address || ''} required={false} onChange={(v:any) => setStoreInfo({...storeInfo, address: v})} />
              <Input label="ข้อความท้ายใบเสร็จ" value={storeInfo.receipt_footer || ''} required={false} onChange={(v:any) => setStoreInfo({...storeInfo, receipt_footer: v})} />
              <button type="submit" className="w-full md:w-auto bg-pink-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-pink-700 transition flex justify-center items-center gap-2 mt-4">
                <Save size={20} /> บันทึกข้อมูล
              </button>
            </form>
          )}

          {/* TAB 2: ประวัติการขาย (HISTORY) */}
          {activeTab === 'HISTORY' && (
            <div className="animate-fade-in flex flex-col h-full">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><History className="text-pink-500"/> ประวัติการขาย</h2>
                <div className="flex flex-wrap items-center gap-2 bg-pink-50 p-2 rounded-xl border border-pink-100 w-full lg:w-auto justify-between lg:justify-start">
                  <div className="flex items-center gap-2">
                    <Calendar size={18} className="text-gray-500" />
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent outline-none text-xs md:text-sm font-bold text-gray-700 w-28 md:w-auto" />
                    <span className="text-gray-400">-</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent outline-none text-xs md:text-sm font-bold text-gray-700 w-28 md:w-auto" />
                  </div>
                  <button onClick={fetchSalesHistory} className="bg-pink-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-pink-700 w-full mt-2 lg:mt-0 lg:w-auto text-center">ค้นหา</button>
                </div>
              </div>

              {/* สำหรับคอม */}
              <div className="hidden md:block overflow-x-auto border border-pink-100 rounded-xl">
                <table className="w-full text-left">
                  <thead className="bg-pink-100 text-gray-600 text-sm">
                    <tr><th className="p-3 border-b">บิล</th><th className="p-3 border-b">เวลา</th><th className="p-3 border-b">ยอดรวม</th><th className="p-3 border-b">แคชเชียร์</th><th className="p-3 border-b text-center">สถานะ</th><th className="p-3 border-b text-center">จัดการ</th></tr>
                  </thead>
                  <tbody>
                    {salesHistory.length === 0 ? (
                      <tr><td colSpan={6} className="p-8 text-center text-gray-400">ไม่พบข้อมูลการขาย</td></tr>
                    ) : (
                      salesHistory.map(bill => (
                        <tr key={bill.id} className="border-b hover:bg-pink-50">
                          <td className="p-3 font-bold">#{bill.id}</td>
                          <td className="p-3 text-sm text-gray-600">{new Date(bill.created_at).toLocaleString('th-TH')}</td>
                          <td className="p-3 font-bold text-pink-600">฿{Number(bill.total_amount).toFixed(2)}</td>
                          <td className="p-3 text-sm text-gray-600">{bill.cashier_name}</td>
                          <td className="p-3 text-center">{bill.status === 'VOIDED' ? <span className="text-red-500 font-bold text-xs bg-red-50 px-2 py-1 rounded">ยกเลิกแล้ว</span> : <span className="text-green-500 font-bold text-xs bg-green-50 px-2 py-1 rounded">สำเร็จ</span>}</td>
                          <td className="p-3 text-center flex justify-center gap-2">
                            <button onClick={() => handleViewBill(bill)} className="text-pink-500 bg-pink-50 hover:bg-pink-100 p-2 rounded-lg transition"><Eye size={18}/></button>
                            {bill.status !== 'VOIDED' && <button onClick={() => handleVoidBill(bill.id)} className="text-red-500 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition"><Trash2 size={18}/></button>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* สำหรับมือถือ */}
              <div className="md:hidden flex flex-col gap-3">
                {salesHistory.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 border border-dashed border-pink-200 rounded-xl">ไม่พบข้อมูลการขาย</div>
                ) : (
                  salesHistory.map(bill => (
                    <div key={bill.id} className="bg-white border border-pink-100 rounded-xl p-4 shadow-sm relative">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-bold text-lg text-gray-800">บิล #{bill.id}</span>
                        {bill.status === 'VOIDED' ? <span className="text-red-500 font-bold text-xs bg-red-50 px-2 py-1 rounded">ยกเลิกแล้ว</span> : <span className="text-green-500 font-bold text-xs bg-green-50 px-2 py-1 rounded">สำเร็จ</span>}
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{new Date(bill.created_at).toLocaleString('th-TH')} | พนักงาน: {bill.cashier_name}</p>
                      <p className="font-bold text-pink-600 text-lg mb-4">ยอด: ฿{Number(bill.total_amount).toFixed(2)}</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleViewBill(bill)} className="flex-1 bg-pink-50 text-pink-600 font-bold py-2 rounded-lg text-sm flex justify-center items-center gap-1"><Eye size={16}/> ดูบิล</button>
                        {bill.status !== 'VOIDED' && <button onClick={() => handleVoidBill(bill.id)} className="bg-red-50 text-red-500 font-bold px-4 py-2 rounded-lg flex justify-center items-center"><Trash2 size={16}/></button>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: จัดการสินค้า */}
          {activeTab === 'PRODUCTS' && (
            <div className="animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-3">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Package className="text-pink-500"/> สินค้าในระบบ</h2>
                <button onClick={() => setActiveModal('ADD_PRODUCT')} className="w-full sm:w-auto bg-pink-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-pink-700 flex justify-center items-center gap-2 transition"><Plus size={18}/> เพิ่มสินค้า</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {products.map(p => (
                  <div key={p.id} className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-pink-100 relative group">
                    {/* ⭐️ รูปภาพสินค้าขนาดจิ๋ว (เพิ่มความสวยงาม) */}
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-12 h-12 bg-pink-50 rounded-lg overflow-hidden shrink-0 border border-pink-100 flex items-center justify-center">
                        {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <Package size={20} className="text-gray-300"/>}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-gray-800 line-clamp-1 text-sm">{p.name}</p>
                        <p className="text-xs text-gray-400">บาร์โค้ด: {p.barcode || '-'}</p>
                      </div>
                    </div>
                    
                    <div className="flex justify-between items-end mt-2">
                      <span className="text-xl md:text-2xl font-bold text-pink-600">฿{Number(p.price).toFixed(2)}</span>
                      <span className="text-xs font-medium text-gray-500 bg-pink-100 px-2 py-1 rounded-md">สต๊อก: {p.stock}</span>
                    </div>

                    {/* ⭐️ ปุ่มแก้ไข (ดินสอ) และ ลบ (ถังขยะ) คู่กัน */}
                    <div className="absolute top-3 right-3 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition bg-white p-1 rounded-lg shadow-sm border border-pink-100 md:border-0 md:shadow-none">
                      <button onClick={() => { setEditingProduct(p); setActiveModal('EDIT_PRODUCT'); }} className="text-pink-400 hover:text-pink-600 hover:bg-pink-50 p-1.5 rounded-md transition" title="แก้ไขสินค้า">
                        <Edit size={16}/>
                      </button>
                      <button onClick={() => handleDeleteProduct(p.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition" title="ลบสินค้า">
                        <Trash2 size={16}/>
                      </button>
                    </div>

                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: หมวดหมู่ */}
          {activeTab === 'CATEGORIES' && (
            <div className="animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-3">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Tags className="text-pink-500"/> หมวดหมู่สินค้า</h2>
                <button onClick={() => setActiveModal('ADD_CATEGORY')} className="w-full sm:w-auto bg-pink-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-pink-700 flex justify-center items-center gap-2 transition"><Plus size={18}/> เพิ่มหมวดหมู่</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {categories.map(c => (
                  <div key={c.id} className="bg-white p-4 rounded-xl border border-pink-100 flex justify-between items-center group shadow-sm">
                    <span className="font-bold text-gray-700 text-sm md:text-base">{c.name}</span>
                    <button onClick={() => handleDeleteCategory(c.id)} className="text-red-400 hover:text-red-600 p-1 md:opacity-0 md:group-hover:opacity-100 transition"><Trash2 size={16}/></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: ซัพพลายเออร์ */}
          {activeTab === 'SUPPLIERS' && (
            <div className="animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-3">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Truck className="text-pink-500"/> ซัพพลายเออร์</h2>
                <button onClick={() => setActiveModal('ADD_SUPPLIER')} className="w-full sm:w-auto bg-pink-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-pink-700 flex justify-center items-center gap-2 transition"><Plus size={18}/> เพิ่มบริษัท</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {suppliers.map(s => (
                  <div key={s.id} className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-pink-100 flex justify-between items-center group relative">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 bg-pink-50 rounded-xl flex items-center justify-center text-pink-500"><Truck size={20}/></div>
                      <div>
                        <p className="font-bold text-gray-800 text-sm md:text-lg line-clamp-1">{s.name}</p>
                        <p className="text-xs md:text-sm text-gray-500 line-clamp-1">{s.contact_info || '-'}</p>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteSupplier(s.id)} className="text-red-400 hover:text-red-600 p-2 md:opacity-0 md:group-hover:opacity-100 transition absolute top-2 right-2 md:relative"><Trash2 size={18}/></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: พนักงาน */}
          {activeTab === 'USERS' && (
            <div className="animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-3">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Users className="text-pink-500"/> พนักงานในระบบ</h2>
                <button onClick={() => setActiveModal('ADD_USER')} className="w-full sm:w-auto bg-pink-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-pink-700 flex justify-center items-center gap-2 transition"><Plus size={18}/> เพิ่มพนักงาน</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {users.map(u => (
                  <div key={u.id} className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-pink-100 flex flex-col group relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-10 h-10 md:w-12 md:h-12 shrink-0 rounded-full flex items-center justify-center font-bold text-white shadow-inner text-lg ${u.role === 'ADMIN' ? 'bg-fuchsia-600' : 'bg-pink-600'}`}>
                        {u.full_name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 line-clamp-1 text-sm md:text-base">{u.full_name}</p>
                        <p className="text-xs text-gray-400">@{u.username}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-end mt-auto">
                      <span className={`px-2 py-1 rounded-md text-[10px] md:text-xs font-bold ${u.role === 'ADMIN' ? 'bg-fuchsia-100 text-fuchsia-600' : 'bg-pink-100 text-pink-600'}`}>{u.role}</span>
                    </div>
                    <button onClick={() => handleDeleteUser(u.id)} className="absolute top-3 right-3 text-red-400 hover:text-red-600 bg-white p-1 rounded-md shadow-sm border border-pink-100 md:opacity-0 md:group-hover:opacity-100 transition"><Trash2 size={16}/></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================= MODALS ================= */}

      {/* บิลรายละเอียด */}
      {viewingBillItems && viewingBillInfo && (
        <CustomModal title={`บิล #${viewingBillInfo.id}`} onClose={() => { setViewingBillItems(null); setViewingBillInfo(null); }}>
          <p className="text-gray-500 text-xs md:text-sm mb-4">{new Date(viewingBillInfo.created_at).toLocaleString('th-TH')}</p>
          <div className="overflow-y-auto max-h-60 mb-4 border border-pink-100 rounded-lg">
            <table className="w-full text-left text-xs md:text-sm">
              <thead className="bg-pink-50 text-gray-600 sticky top-0"><tr><th className="p-2 border-b">สินค้า</th><th className="p-2 border-b text-center">จำนวน</th><th className="p-2 border-b text-right">รวม</th></tr></thead>
              <tbody>
                {viewingBillItems.map((item, idx) => (
                  <tr key={idx} className="border-b last:border-0"><td className="p-2 font-bold text-gray-800">{item.product_name}</td><td className="p-2 text-center">{item.quantity}</td><td className="p-2 text-right font-bold text-pink-600">฿{Number(item.subtotal).toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center p-4 bg-pink-50 rounded-xl mb-4 border border-pink-100">
            <span className="font-bold text-pink-800 text-sm">ยอดรวมทั้งสิ้น</span><span className="text-xl md:text-2xl font-bold text-pink-600">฿{Number(viewingBillInfo.total_amount).toFixed(2)}</span>
          </div>
          {viewingBillInfo.status !== 'VOIDED' && (
            <button onClick={() => handleVoidBill(viewingBillInfo.id)} className="w-full bg-red-500 text-white font-bold py-3 rounded-xl hover:bg-red-600 transition flex justify-center items-center gap-2"><Trash2 size={18} /> ยกเลิกบิล (Void)</button>
          )}
        </CustomModal>
      )}

      {/* ⭐️ MODAL แก้ไขสินค้า */}
      {activeModal === 'EDIT_PRODUCT' && editingProduct && (
        <CustomModal title="แก้ไขข้อมูลสินค้า" onClose={() => { setActiveModal(null); setEditingProduct(null); }}>
          <form onSubmit={handleEditProduct} className="space-y-3 md:space-y-4">
            <Input label="ชื่อสินค้า" value={editingProduct.name} onChange={(v:any) => setEditingProduct({...editingProduct, name: v})} />
            <Input label="บาร์โค้ด (ถ้ามี)" value={editingProduct.barcode || ''} required={false} onChange={(v:any) => setEditingProduct({...editingProduct, barcode: v})} />
            
            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">หมวดหมู่</label>
              <select className="w-full p-2.5 md:p-3 border border-pink-200 rounded-xl outline-none focus:ring-2 focus:ring-pink-500 text-sm md:text-base" value={editingProduct.category_id || ''} onChange={e => setEditingProduct({...editingProduct, category_id: e.target.value})}>
                <option value="">-- ไม่ระบุ --</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <Input label="ราคาขาย (฿)" type="number" value={editingProduct.price} onChange={(v:any) => setEditingProduct({...editingProduct, price: v})} />
              {/* ปิดการแก้ไขสต๊อก เพราะต้องรับของเข้า หรือตั้งค่าปรับสต๊อกผ่านคลัง */}
              <Input label="สต๊อกปัจจุบัน" type="number" value={editingProduct.stock} disabled={true} required={false} onChange={() => {}} />
            </div>

            <Input label="URL รูปภาพ (ถ้ามี)" value={editingProduct.image_url || ''} required={false} onChange={(v:any) => setEditingProduct({...editingProduct, image_url: v})} />
            
            <button type="submit" className="w-full bg-pink-600 text-white p-3 rounded-xl font-bold hover:bg-pink-700 mt-2 transition">
              บันทึกการแก้ไข
            </button>
          </form>
        </CustomModal>
      )}

      {/* MODAL เพิ่มสินค้า (มีช่องรูปภาพแล้ว) */}
      {activeModal === 'ADD_PRODUCT' && (
        <CustomModal title="เพิ่มสินค้าใหม่" onClose={() => setActiveModal(null)}>
          <form onSubmit={handleAddProduct} className="space-y-3 md:space-y-4">
            <Input label="ชื่อสินค้า" value={newProduct.name} onChange={(v:any) => setNewProduct({...newProduct, name: v})} />
            <Input label="บาร์โค้ด (ถ้ามี)" value={newProduct.barcode} required={false} onChange={(v:any) => setNewProduct({...newProduct, barcode: v})} />
            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">หมวดหมู่</label>
              <select className="w-full p-2.5 md:p-3 border border-pink-200 rounded-xl outline-none focus:ring-2 focus:ring-pink-500 text-sm md:text-base" value={newProduct.category_id} onChange={e => setNewProduct({...newProduct, category_id: e.target.value})}>
                <option value="">-- ไม่ระบุ --</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="ราคาขาย (฿)" type="number" value={newProduct.price} onChange={(v:any) => setNewProduct({...newProduct, price: v})} />
              <Input label="สต๊อกตั้งต้น" type="number" value={newProduct.stock} required={false} onChange={(v:any) => setNewProduct({...newProduct, stock: v})} />
            </div>
            {/* ⭐️ ช่องเพิ่มรูปลิงก์ */}
            <Input label="URL รูปภาพ (ถ้ามี)" value={newProduct.image_url} required={false} onChange={(v:any) => setNewProduct({...newProduct, image_url: v})} />
            <button type="submit" className="w-full bg-pink-600 text-white p-3 rounded-xl font-bold hover:bg-pink-700 mt-2">บันทึกสินค้าใหม่</button>
          </form>
        </CustomModal>
      )}

      {/* Modals อื่นๆ */}
      {activeModal === 'ADD_USER' && (
        <CustomModal title="เพิ่มพนักงาน" onClose={() => setActiveModal(null)}>
          <form onSubmit={handleAddUser} className="space-y-4">
            <Input label="ชื่อเข้าระบบ (Username)" value={newUser.username} onChange={(v:any) => setNewUser({...newUser, username: v})} />
            <Input label="รหัสผ่าน" type="password" value={newUser.password} onChange={(v:any) => setNewUser({...newUser, password: v})} />
            <Input label="ชื่อ-นามสกุล" value={newUser.full_name} onChange={(v:any) => setNewUser({...newUser, full_name: v})} />
            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">บทบาท (Role)</label>
              <select className="w-full p-2.5 md:p-3 border border-pink-200 rounded-xl outline-none focus:ring-2 focus:ring-pink-500 text-sm md:text-base" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}>
                <option value="CASHIER">แคชเชียร์</option>
                <option value="ADMIN">ผู้จัดการ (ADMIN)</option>
              </select>
            </div>
            <button type="submit" className="w-full bg-pink-600 text-white p-3 rounded-xl font-bold hover:bg-pink-700 mt-2">สร้างบัญชี</button>
          </form>
        </CustomModal>
      )}

      {activeModal === 'ADD_CATEGORY' && (
        <CustomModal title="เพิ่มหมวดหมู่" onClose={() => setActiveModal(null)}>
          <form onSubmit={handleAddCategory} className="space-y-4">
            <Input label="ชื่อหมวดหมู่" value={newCategory} onChange={setNewCategory} />
            <button type="submit" className="w-full bg-pink-600 text-white p-3 rounded-xl font-bold hover:bg-pink-700 mt-2">เพิ่มหมวดหมู่</button>
          </form>
        </CustomModal>
      )}

      {activeModal === 'ADD_SUPPLIER' && (
        <CustomModal title="เพิ่มตัวแทนจำหน่าย" onClose={() => setActiveModal(null)}>
          <form onSubmit={handleAddSupplier} className="space-y-4">
            <Input label="ชื่อบริษัท / บุคคล" value={newSupplier.name} onChange={(v:any) => setNewSupplier({...newSupplier, name: v})} />
            <Input label="ข้อมูลติดต่อ" value={newSupplier.contact_info} required={false} onChange={(v:any) => setNewSupplier({...newSupplier, contact_info: v})} />
            <button type="submit" className="w-full bg-pink-600 text-white p-3 rounded-xl font-bold hover:bg-pink-700 mt-2">บันทึกข้อมูล</button>
          </form>
        </CustomModal>
      )}

      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; } .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
    </div>
  );
}

const TabButton = ({ icon, label, isActive, onClick }: any) => (
  <button onClick={onClick} className={`shrink-0 snap-start flex items-center gap-2 px-4 py-3 md:p-4 rounded-xl font-bold text-sm md:text-base transition ${isActive ? 'bg-pink-600 text-white shadow-md' : 'bg-white text-gray-600 hover:bg-pink-100 border border-pink-100'}`}>
    {icon} <span className="whitespace-nowrap">{label}</span>
  </button>
);

// ⭐️ อัปเดต Input Component ให้รองรับสถานะ disabled (ล็อคไม่ให้แก้ได้)
const Input = ({ label, value, onChange, type = "text", required = true, disabled = false }: any) => (
  <div>
    <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">{label}</label>
    <input 
      type={type} 
      required={required} 
      disabled={disabled}
      value={value} 
      onChange={e => onChange(e.target.value)} 
      className={`w-full p-2.5 md:p-3 border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none transition text-sm md:text-base ${disabled ? 'bg-pink-100 text-gray-400 cursor-not-allowed' : ''}`} 
    />
  </div>
);

const CustomModal = ({ title, onClose, children }: any) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-end md:items-center justify-center sm:p-4 animate-fade-in">
    <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-lg w-full max-w-md overflow-hidden flex flex-col transform transition-all">
      <div className="px-5 py-4 border-b border-pink-100 flex justify-between items-center bg-pink-50 rounded-t-2xl md:rounded-t-none">
        <h2 className="text-base md:text-lg font-bold text-gray-800">{title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition"><X size={20}/></button>
      </div>
      <div className="p-5 pb-12 md:pb-5 overflow-y-auto max-h-[75vh] md:max-h-[85vh]">
        {children}
      </div>
    </div>
  </div>
);