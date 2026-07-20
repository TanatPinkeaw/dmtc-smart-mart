import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Store, History, Users, Tags, Truck, Package, Trash2, Save, Eye, Calendar, Plus, X, Edit, Gift, Search, Upload, KeyRound, Copy, Phone, Clock, Download } from 'lucide-react';
import Swal from '../swal';
import api from '../api';
import { useSocket } from '../SocketContext';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';

const getLocalDate = () => {
  const tzoffset = (new Date()).getTimezoneOffset() * 60000;
  return new Date(Date.now() - tzoffset).toISOString().split('T')[0];
};

export default function Settings() {
  const socket = useSocket();

  // ⭐️ 1. เพิ่ม 'PROMOTIONS' ใน Tabs
  // ⭐️ FIX — เพิ่มแท็บ 'PASSWORD_RESETS' คิวคำขอรีเซ็ตรหัสผ่านที่ ADMIN ต้องอนุมัติ/ส่งลิงก์เอง
  const [activeTab, setActiveTab] = useState<'STORE' | 'HISTORY' | 'USERS' | 'CATEGORIES' | 'SUPPLIERS' | 'PRODUCTS' | 'PROMOTIONS' | 'PASSWORD_RESETS'>('STORE');

  // ⭐️ 2. เพิ่ม 'EDIT_USER' และ 'ADD_PROMOTION' ใน Modals
  const [activeModal, setActiveModal] = useState<'ADD_PRODUCT' | 'EDIT_PRODUCT' | 'ADD_CATEGORY' | 'ADD_SUPPLIER' | 'ADD_USER' | 'EDIT_USER' | 'ADD_PROMOTION' | null>(null);

  const [storeInfo, setStoreInfo] = useState({ store_name: '', tax_id: '', address: '', receipt_footer: '' });
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [passwordResets, setPasswordResets] = useState<any[]>([]); // ⭐️ FIX — คิวคำขอรีเซ็ตรหัสผ่าน

  // ⭐️ 3. เพิ่ม State สำหรับช่องค้นหาทุกๆ แท็บ
  const [searchProduct, setSearchProduct] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [searchSupplier, setSearchSupplier] = useState('');
  const [searchUser, setSearchUser] = useState('');
  const [searchPromotion, setSearchPromotion] = useState('');
  const [vendorSearch, setVendorSearch] = useState(''); // ค้นหาเจ้าของผลงานตอนเพิ่มสินค้า

  const [newUser, setNewUser] = useState({ username: '', password: '', full_name: '', role: 'CASHIER' });
  const [editingUser, setEditingUser] = useState<any>(null); // สำหรับแก้ไขสิทธิ์พนักงาน

  const [newCategory, setNewCategory] = useState('');
  const [newSupplier, setNewSupplier] = useState({ name: '', contact_info: '' });
  
  const [newProduct, setNewProduct] = useState({ barcode: '', name: '', category_id: '', price: '', cost: '', stock: '', image_url: '', vendor_id: '', gp_rate: '', promo_percent: '', promo_start: '', promo_end: '', expiry_date: '', discount_percent: 40 });
  const [editingProduct, setEditingProduct] = useState<any>(null);

  const [newPromotion, setNewPromotion] = useState({
    name: '', discount_type: 'PERCENT', discount_value: '', start_date: '', end_date: '',
    buy_product_id: '', buy_qty: '', free_product_id: '', free_qty: '',
    usage_limit: '', usage_limit_per_user: ''
  });

  const [startDate, setStartDate] = useState(getLocalDate());
  const [endDate, setEndDate] = useState(getLocalDate());
  const [exportLevel, setExportLevel] = useState<'item' | 'bill' | 'daily'>('item'); // ⭐️ ระดับความละเอียด CSV
  const [exporting, setExporting] = useState(false);
  const [viewingBillItems, setViewingBillItems] = useState<any[] | null>(null);
  const [viewingBillInfo, setViewingBillInfo] = useState<any | null>(null);
  const [vendors, setVendors] = useState<any[]>([]);

  const currentUser = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2

  useEffect(() => {
    fetchStoreSettings();
    if (activeTab === 'HISTORY') fetchSalesHistory();
    if (activeTab === 'USERS') fetchUsers();
    if (activeTab === 'CATEGORIES') fetchCategories();
    if (activeTab === 'SUPPLIERS') fetchSuppliers();
    if (activeTab === 'PRODUCTS') { fetchProducts(); fetchCategories(); }
    if (activeTab === 'PROMOTIONS') { fetchPromotions(); fetchProducts(); }
    if (activeTab === 'PASSWORD_RESETS') fetchPasswordResets();
    fetchVendors();

    if (!socket) return;

    let debounceTimer: ReturnType<typeof setTimeout>;

    // ⭐️ ซิงค์สต๊อกในแท็บสินค้า
    socket.on('stock_updated', () => {
      clearTimeout(debounceTimer);
      if (activeTab === 'PRODUCTS') {
        debounceTimer = setTimeout(fetchProducts, 300);
      }
    });

    // ⭐️ ซิงค์ประวัติบิลแบบ Real-time
    socket.on('dashboard_updated', () => {
      if (activeTab === 'HISTORY') fetchSalesHistory();
    });

    return () => {
      clearTimeout(debounceTimer);
      socket.off('stock_updated');
      socket.off('dashboard_updated');
    };
  }, [activeTab, socket, startDate, endDate]); // 👈 เพิ่ม dependencies ให้คร

  const fetchStoreSettings = async () => { const res = await api.get('/settings/store'); setStoreInfo(res.data); };
  // ⭐️ Export ยอดขาย/รายได้เป็น CSV (โหลดผ่าน api = แนบ JWT) แล้วสั่งดาวน์โหลดไฟล์
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get('/reports/export/sales-csv', {
        params: { start_date: startDate, end_date: endDate, level: exportLevel },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sales-${exportLevel}_${startDate}_ถึง_${endDate}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'Export ไม่สำเร็จ', text: getErrorMessage(err) });
    } finally {
      setExporting(false);
    }
  };
  // ⭐️ FIX — โหลดคิวคำขอรีเซ็ตรหัสผ่าน
  const fetchPasswordResets = async () => { const res = await api.get('/admin/password-resets'); setPasswordResets(res.data); };
  const handleCopyResetLink = async (token: string) => {
    const link = `${window.location.origin}/reset-password?token=${token}`;
    try {
      await navigator.clipboard.writeText(link);
      Swal.fire({ icon: 'success', title: 'คัดลอกลิงก์แล้ว', text: 'นำไปส่งให้นักเรียนได้เลย (เช่น ทาง LINE)', showConfirmButton: false, timer: 1800 });
    } catch {
      Swal.fire({ icon: 'info', title: 'คัดลอกลิงก์อัตโนมัติไม่ได้', text: link });
    }
  };
  const handleRejectPasswordReset = async (id: number) => {
    const res = await Swal.fire({ title: 'ปฏิเสธคำขอนี้?', text: 'ลิงก์รีเซ็ตรหัสผ่านของคำขอนี้จะใช้งานไม่ได้ทันที', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ปฏิเสธ', cancelButtonText: 'ยกเลิก' });
    if (!res.isConfirmed) return;
    try {
      await api.delete(`/admin/password-resets/${id}`);
      fetchPasswordResets();
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) });
    }
  };
  const fetchUsers = async () => { const res = await api.get('/users'); setUsers(res.data.filter((u: any) => u.is_active !== 0)); };
  const fetchCategories = async () => { const res = await api.get('/categories'); setCategories(res.data); };
  const fetchSuppliers = async () => { const res = await api.get('/suppliers'); setSuppliers(res.data); };
  const fetchProducts = async () => { const res = await api.get('/products'); setProducts(res.data); };
  const fetchPromotions = async () => { const res = await api.get('/promotions'); setPromotions(res.data); };
  const fetchSalesHistory = async () => { try { const res = await api.get(`/sales/history?start_date=${startDate}&end_date=${endDate}`); setSalesHistory(res.data); } catch (error) { console.error(error); } };
  const fetchVendors = async () => { const res = await api.get('/users'); setVendors(res.data); };

  // ================= ⭐️ ระบบกรองข้อมูล (ค้นหา) =================
  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchProduct.toLowerCase()) || (p.barcode && p.barcode.includes(searchProduct)));
  const filteredCategories = categories.filter(c => c.name.toLowerCase().includes(searchCategory.toLowerCase()));
  const filteredSuppliers = suppliers.filter(s => s.name.toLowerCase().includes(searchSupplier.toLowerCase()) || (s.contact_info && s.contact_info.toLowerCase().includes(searchSupplier.toLowerCase())));
  const filteredUsers = users.filter(u => u.full_name.toLowerCase().includes(searchUser.toLowerCase()) || u.username.includes(searchUser) || u.role.toLowerCase().includes(searchUser.toLowerCase()));
  const filteredPromotions = promotions.filter(p => p.name.toLowerCase().includes(searchPromotion.toLowerCase()));
  const filteredVendors = vendors.filter(v => v.full_name.toLowerCase().includes(vendorSearch.toLowerCase()) || v.username.includes(vendorSearch));

  // ================= ACTION FUNCTIONS =================
  const handleViewBill = async (bill: any) => {
    try { const res = await api.get(`/sales/history/${bill.id}?source=${bill.source || 'POS'}`); setViewingBillItems(res.data); setViewingBillInfo(bill); }
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
    } catch (err: any) { Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: getErrorMessage(err) }); }
  };

  const handleAddUser = async (e: React.FormEvent) => { e.preventDefault(); try { await api.post('/users', newUser); setNewUser({ username: '', password: '', full_name: '', role: 'CASHIER' }); fetchUsers(); setActiveModal(null); Swal.fire({ icon: 'success', title: 'เพิ่มพนักงานสำเร็จ', showConfirmButton: false, timer: 1500 }); } catch (err: any) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); } };
  
  // ⭐️ ฟังก์ชันแก้ไขสิทธิ์ผู้ใช้งาน (คืนเป็น MEMBER ได้)
  const handleEditUserRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.put(`/users/${editingUser.id}`, { full_name: editingUser.full_name, role: editingUser.role, is_active: editingUser.is_active });
      fetchUsers(); setActiveModal(null); setEditingUser(null);
      Swal.fire({ icon: 'success', title: 'อัปเดตสิทธิ์สำเร็จ', showConfirmButton: false, timer: 1500 });
    } catch (err: any) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
  };

  const handleAddCategory = async (e: React.FormEvent) => { e.preventDefault(); await api.post('/categories', { name: newCategory }); setNewCategory(''); fetchCategories(); setActiveModal(null); Swal.fire({ icon: 'success', title: 'เพิ่มหมวดหมู่สำเร็จ', showConfirmButton: false, timer: 1500 }); };
  const handleAddSupplier = async (e: React.FormEvent) => { e.preventDefault(); await api.post('/suppliers', newSupplier); setNewSupplier({ name: '', contact_info: '' }); fetchSuppliers(); setActiveModal(null); Swal.fire({ icon: 'success', title: 'เพิ่มซัพพลายเออร์สำเร็จ', showConfirmButton: false, timer: 1500 }); };
  const handleAddPromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/promotions', {
        ...newPromotion,
        discount_value: Number(newPromotion.discount_value) || 0,
        buy_product_id: newPromotion.buy_product_id || undefined,
        buy_qty: newPromotion.buy_qty ? Number(newPromotion.buy_qty) : undefined,
        free_product_id: newPromotion.free_product_id || undefined,
        free_qty: newPromotion.free_qty ? Number(newPromotion.free_qty) : undefined,
        usage_limit: newPromotion.usage_limit ? Number(newPromotion.usage_limit) : undefined,
        usage_limit_per_user: newPromotion.usage_limit_per_user ? Number(newPromotion.usage_limit_per_user) : undefined,
      });
      setNewPromotion({ name: '', discount_type: 'PERCENT', discount_value: '', start_date: '', end_date: '', buy_product_id: '', buy_qty: '', free_product_id: '', free_qty: '', usage_limit: '', usage_limit_per_user: '' });
      fetchPromotions();
      setActiveModal(null);
      Swal.fire({ icon: 'success', title: 'สร้างโปรโมชั่นสำเร็จ', showConfirmButton: false, timer: 1500 });
    } catch (err: any) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/products', { ...newProduct, category_id: newProduct.category_id ? Number(newProduct.category_id) : null, price: Number(newProduct.price), cost: Number(newProduct.cost) || 0, stock: Number(newProduct.stock) || 0, vendor_id: newProduct.vendor_id ? Number(newProduct.vendor_id) : null, gp_rate: newProduct.gp_rate ? Number(newProduct.gp_rate) : 0, promo_percent: Number(newProduct.promo_percent) || 0, promo_start: newProduct.promo_start || null, promo_end: newProduct.promo_end || null, expiry_date: newProduct.expiry_date || null, discount_percent: Number(newProduct.discount_percent) || 40 });
      setNewProduct({ barcode: '', name: '', category_id: '', price: '', cost: '', stock: '', image_url: '', vendor_id: '', gp_rate: '', promo_percent: '', promo_start: '', promo_end: '', expiry_date: '', discount_percent: 40 });
      fetchProducts(); setActiveModal(null); setVendorSearch('');
      Swal.fire({ icon: 'success', title: 'เพิ่มสินค้าสำเร็จ', showConfirmButton: false, timer: 1500 });
    }
    catch (err: any) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
  };

  const handleEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.put(`/products/${editingProduct.id}`, { ...editingProduct, category_id: editingProduct.category_id ? Number(editingProduct.category_id) : null, price: Number(editingProduct.price), cost: Number(editingProduct.cost) || 0, vendor_id: editingProduct.vendor_id ? Number(editingProduct.vendor_id) : null, gp_rate: editingProduct.gp_rate ? Number(editingProduct.gp_rate) : 0, promo_percent: Number(editingProduct.promo_percent) || 0, promo_start: editingProduct.promo_start ? String(editingProduct.promo_start).slice(0, 10) : null, promo_end: editingProduct.promo_end ? String(editingProduct.promo_end).slice(0, 10) : null, expiry_date: editingProduct.expiry_date || null, discount_percent: Number(editingProduct.discount_percent) || 40 });
      fetchProducts(); setActiveModal(null); setEditingProduct(null); setVendorSearch('');
      Swal.fire({ icon: 'success', title: 'แก้ไขสินค้าสำเร็จ!', showConfirmButton: false, timer: 1500 });
    } catch (err: any) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
  };

  const handleDeleteCategory = async (id: number) => { const res = await Swal.fire({ title: 'ลบหมวดหมู่นี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if (!res.isConfirmed) return; try { await api.delete(`/categories/${id}`); fetchCategories(); } catch (err: any) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); } };
  const handleDeleteProduct = async (id: number) => { const res = await Swal.fire({ title: 'ลบสินค้านี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if (!res.isConfirmed) return; try { await api.delete(`/products/${id}`); fetchProducts(); } catch (err: any) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); } };
  const handleDeleteUser = async (id: number) => { const res = await Swal.fire({ title: 'ลบพนักงานคนนี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if (!res.isConfirmed) return; try { await api.delete(`/users/${id}`); fetchUsers(); } catch (err: any) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); } };

  // ⭐️ ซิงค์รายชื่อพนักงานจากไฟล์ CSV — ใครไม่มีในไฟล์จะถูกปิดการใช้งาน (soft delete)
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // เคลียร์ input กันเลือกไฟล์เดิมซ้ำแล้วไม่ trigger onChange

    let text = await file.text();
    text = text.replace(/^\uFEFF/, ''); // ⭐️ ตัด BOM ที่ Excel ชอบใส่หน้าไฟล์
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return Swal.fire({ icon: 'warning', title: 'ไฟล์ CSV ว่างเปล่า' });

    const parseRow = (line: string) => {
      const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, '').trim());
      return { username: cols[0] || '', full_name: cols[1] || cols[0] || '', phone_number: cols[2] || '' };
    };

    let rows = lines.map(parseRow);
    const looksLikeHeader = /^(username|student_id|รหัส)/i.test(rows[0].username);
    if (looksLikeHeader) rows = rows.slice(1);
    rows = rows.filter(r => r.username);

    if (rows.length === 0) return Swal.fire({ icon: 'warning', title: 'อ่านรายชื่อจากไฟล์ไม่ได้', text: 'ตรวจสอบรูปแบบไฟล์ CSV: username,full_name,phone_number' });

    // ⭐️ Debug: แสดงจำนวนแถวที่ parse ได้ก่อนส่ง
    const debugConfirm = await Swal.fire({
      icon: 'info', title: `อ่านได้ ${rows.length} แถว`,
      html: `<pre style="text-align:left;font-size:11px;max-height:150px;overflow-y:auto;background:#f8f8f8;padding:8px;border-radius:8px;">${rows.slice(0, 5).map(r => `${r.username} | ${r.full_name} | ${r.phone_number}`).join('\n')}${rows.length > 5 ? `\n...และอีก ${rows.length - 5} แถว` : ''}</pre>`,
      showCancelButton: true, confirmButtonText: 'ส่งไป server', cancelButtonText: 'ยกเลิก'
    });
    if (!debugConfirm.isConfirmed) return;

    try {
      const preview = await api.post('/users/sync-csv', { rows, dry_run: true });
      const toCreate = preview.data.to_create || [];
      const toReactivate = preview.data.to_reactivate || [];
      const toRemove = preview.data.to_deactivate || [];

      let html = '';
      if (toCreate.length > 0) html += `<p class="font-bold text-green-700 mb-1">เพิ่มใหม่ ${toCreate.length} คน:</p><pre style="text-align:left;white-space:pre-wrap;font-size:12px;max-height:100px;overflow-y:auto;background:#f0fdf4;padding:8px;border-radius:8px;">${toCreate.map((u: any) => `+ ${u.full_name} (${u.username})`).join('\n')}</pre>`;
      if (toReactivate.length > 0) html += `<p class="font-bold text-blue-700 mt-2 mb-1">เปิดใช้งานคืน ${toReactivate.length} คน:</p><pre style="text-align:left;white-space:pre-wrap;font-size:12px;max-height:100px;overflow-y:auto;background:#eff6ff;padding:8px;border-radius:8px;">${toReactivate.map((u: any) => `↺ ${u.student_id}`).join('\n')}</pre>`;
      if (toRemove.length > 0) html += `<p class="font-bold text-red-700 mt-2 mb-1">ปิดการใช้งาน ${toRemove.length} คน:</p><pre style="text-align:left;white-space:pre-wrap;font-size:12px;max-height:100px;overflow-y:auto;background:#fef2f2;padding:8px;border-radius:8px;">${toRemove.map((u: any) => `- ${u.full_name} (${u.username})`).join('\n')}</pre>`;
      if (toCreate.length === 0 && toReactivate.length === 0 && toRemove.length === 0) return Swal.fire({ icon: 'success', title: 'ข้อมูลตรงกันหมดแล้ว', text: 'ไม่มีการเปลี่ยนแปลง' });

      const confirm = await Swal.fire({
        icon: 'info', title: 'ตรวจสอบการเปลี่ยนแปลง', html,
        showCancelButton: true, confirmButtonColor: '#ec4899', cancelButtonColor: '#9ca3af',
        confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก'
      });
      if (!confirm.isConfirmed) return;

      const result = await api.post('/users/sync-csv', { rows, dry_run: false });
      Swal.fire({ icon: 'success', title: result.data.message, showConfirmButton: false, timer: 2500 });
      fetchUsers();
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) });
    }
  };
  const handleDeleteSupplier = async (id: number) => { const res = await Swal.fire({ title: 'ลบซัพพลายเออร์นี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if (!res.isConfirmed) return; try { await api.delete(`/suppliers/${id}`); fetchSuppliers(); } catch (err: any) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); } };

  return (
    <div className="min-h-screen bg-[#FFF5F7] font-sans p-4 md:p-6 relative pb-20 md:pb-6">

      {/* Header */}
      <div className="max-w-7xl mx-auto flex items-center gap-3 text-[#F12B6B] mb-6 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-[#F6C7C7]">
        <SettingsIcon size={28} className="md:w-8 md:h-8 shrink-0" />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-800">แผงควบคุม (Admin)</h1>
          <p className="text-gray-500 text-xs md:text-sm">จัดการข้อมูลหลักในระบบ</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto flex flex-col xl:flex-row gap-6">

        {/* Sidebar Tabs */}
        <div className="w-full xl:w-64 flex flex-row xl:flex-col gap-2 shrink-0 overflow-x-auto pb-2 xl:pb-0 scrollbar-hide snap-x">
          <TabButton icon={<Store size={18} />} label="ร้านค้า" isActive={activeTab === 'STORE'} onClick={() => setActiveTab('STORE')} />
          <TabButton icon={<History size={18} />} label="ประวัติขาย" isActive={activeTab === 'HISTORY'} onClick={() => setActiveTab('HISTORY')} />
          <TabButton icon={<Package size={18} />} label="สินค้า" isActive={activeTab === 'PRODUCTS'} onClick={() => setActiveTab('PRODUCTS')} />
          <TabButton icon={<Tags size={18} />} label="หมวดหมู่" isActive={activeTab === 'CATEGORIES'} onClick={() => setActiveTab('CATEGORIES')} />
          <TabButton icon={<Truck size={18} />} label="ซัพพลายเออร์" isActive={activeTab === 'SUPPLIERS'} onClick={() => setActiveTab('SUPPLIERS')} />
          <TabButton icon={<Users size={18} />} label="พนักงาน/สิทธิ์" isActive={activeTab === 'USERS'} onClick={() => setActiveTab('USERS')} />
          <TabButton icon={<Gift size={18} />} label="โปรโมชั่น" isActive={activeTab === 'PROMOTIONS'} onClick={() => setActiveTab('PROMOTIONS')} />
          <TabButton icon={<KeyRound size={18} />} label="รีเซ็ตรหัสผ่าน" isActive={activeTab === 'PASSWORD_RESETS'} onClick={() => setActiveTab('PASSWORD_RESETS')} badge={passwordResets.length || undefined} />
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-[#F6C7C7] p-4 md:p-8 min-h-[500px] relative overflow-hidden">

          {/* TAB 1: ร้านค้า */}
          {activeTab === 'STORE' && (
            <form onSubmit={handleSaveStore} className="space-y-4 animate-fade-in max-w-2xl">
              <h2 className="text-lg md:text-xl font-bold mb-4 flex items-center gap-2"><Store className="text-[#F12B6B]" /> ข้อมูลร้านค้า</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="ชื่อร้าน" value={storeInfo.store_name} onChange={(v: any) => setStoreInfo({ ...storeInfo, store_name: v })} />
                <Input label="เลขผู้เสียภาษี" value={storeInfo.tax_id || ''} required={false} onChange={(v: any) => setStoreInfo({ ...storeInfo, tax_id: v })} />
              </div>
              <Input label="ที่อยู่" value={storeInfo.address || ''} required={false} onChange={(v: any) => setStoreInfo({ ...storeInfo, address: v })} />
              <Input label="ข้อความท้ายใบเสร็จ" value={storeInfo.receipt_footer || ''} required={false} onChange={(v: any) => setStoreInfo({ ...storeInfo, receipt_footer: v })} />
              <button type="submit" className="w-full md:w-auto bg-[#F12B6B] text-white px-8 py-3 rounded-xl font-bold hover:bg-[#FF467E] transition flex justify-center items-center gap-2 mt-4"><Save size={20} /> บันทึกข้อมูล</button>
            </form>
          )}

          {/* TAB 2: ประวัติการขาย */}
          {activeTab === 'HISTORY' && (
            <div className="animate-fade-in flex flex-col h-full">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><History className="text-[#F12B6B]" /> ประวัติการขาย</h2>
                <div className="flex flex-wrap items-center gap-2 bg-[#FFF5F7] p-2 rounded-xl border border-[#F6C7C7] w-full lg:w-auto justify-between lg:justify-start">
                  <div className="flex items-center gap-2">
                    <Calendar size={18} className="text-gray-500" />
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent outline-none text-xs md:text-sm font-bold text-gray-700 w-28 md:w-auto" />
                    <span className="text-gray-400">-</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent outline-none text-xs md:text-sm font-bold text-gray-700 w-28 md:w-auto" />
                  </div>
                  <button onClick={fetchSalesHistory} className="bg-[#F12B6B] text-white px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-[#FF467E] w-full mt-2 lg:mt-0 lg:w-auto text-center">ค้นหา</button>
                </div>
              </div>

              {/* ⭐️ Export CSV — เลือกระดับความละเอียดแล้วดาวน์โหลด ไปเปิดใน Google Sheets/Excel คำนวณต่อได้ */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4 bg-white border border-[#F6C7C7] rounded-xl p-2.5">
                <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5 px-1"><Download size={14} className="text-[#F12B6B]" /> ส่งออกข้อมูล (ช่วงวันที่ที่เลือกด้านบน)</span>
                <select
                  value={exportLevel}
                  onChange={e => setExportLevel(e.target.value as 'item' | 'bill' | 'daily')}
                  className="text-sm border border-[#F6C7C7] rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-[#F12B6B] bg-[#FFF5F7] font-medium text-gray-700 sm:ml-auto"
                >
                  <option value="item">รายชิ้น (ละเอียดสุด — ทำ pivot ได้)</option>
                  <option value="bill">รายบิล</option>
                  <option value="daily">สรุปรายวัน</option>
                </select>
                <button
                  onClick={handleExportCsv}
                  disabled={exporting}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                >
                  <Download size={15} /> {exporting ? 'กำลังสร้างไฟล์...' : 'ดาวน์โหลด CSV'}
                </button>
              </div>
              {/* ⭐️ FIX: เดิม table มีแค่ hidden md:block ไม่มี mobile fallback เลย — บนมือถือหน้านี้ว่างเปล่า
                  ไม่เห็นประวัติการขายเลย เพิ่ม card list สำหรับ mobile (< md) ตรงนี้ */}
              <div className="md:hidden space-y-3">
                {salesHistory.length === 0 ? (
                  <p className="text-center text-gray-400 py-8 text-sm">ไม่พบข้อมูลการขาย</p>
                ) : salesHistory.map(bill => (
                  <div key={`m-${bill.source || 'POS'}-${bill.id}`} className="bg-white border border-[#F6C7C7] rounded-xl p-3.5 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-bold text-gray-800">#{bill.id}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{new Date(bill.created_at).toLocaleString('th-TH')}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {bill.source === 'PREORDER' ? <span className="text-blue-600 font-bold text-[10px] bg-blue-50 px-2 py-0.5 rounded">จอง</span> : <span className="text-gray-500 font-bold text-[10px] bg-gray-100 px-2 py-0.5 rounded">หน้าร้าน</span>}
                        {bill.status === 'VOIDED' ? <span className="text-red-500 font-bold text-[10px] bg-red-50 px-2 py-0.5 rounded">ยกเลิกแล้ว</span> : <span className="text-green-500 font-bold text-[10px] bg-green-50 px-2 py-0.5 rounded">สำเร็จ</span>}
                      </div>
                    </div>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs text-gray-500">{bill.cashier_name}</span>
                      <span className="font-bold text-[#F12B6B] text-lg">฿{Number(bill.total_amount).toFixed(2)}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleViewBill(bill)} className="flex-1 text-[#F12B6B] bg-[#FFF5F7] hover:bg-[#F6C7C7] active:scale-95 py-2 rounded-lg transition text-sm font-bold flex items-center justify-center gap-1.5"><Eye size={16} /> ดูรายการ</button>
                      {bill.source !== 'PREORDER' && bill.status !== 'VOIDED' && (
                        <button onClick={() => handleVoidBill(bill.id)} className="flex-1 text-red-600 bg-red-50 hover:bg-red-100 active:scale-95 py-2 rounded-lg transition text-sm font-bold flex items-center justify-center gap-1.5"><Trash2 size={16} /> ยกเลิก</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block overflow-x-auto border border-[#F6C7C7] rounded-xl">
                <table className="w-full text-left">
                  <thead className="bg-[#FFF5F7] text-gray-600 text-sm"><tr><th className="p-3 border-b">บิล</th><th className="p-3 border-b">ประเภท</th><th className="p-3 border-b">เวลา</th><th className="p-3 border-b">ยอดรวม</th><th className="p-3 border-b">ลูกค้า/แคชเชียร์</th><th className="p-3 border-b text-center">สถานะ</th><th className="p-3 border-b text-center">จัดการ</th></tr></thead>
                  <tbody>
                    {salesHistory.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-gray-400">ไม่พบข้อมูลการขาย</td></tr> : salesHistory.map(bill => (
                        <tr key={`${bill.source || 'POS'}-${bill.id}`} className="border-b hover:bg-[#FFF5F7]">
                          <td className="p-3 font-bold">#{bill.id}</td>
                          <td className="p-3">{bill.source === 'PREORDER' ? <span className="text-blue-600 font-bold text-xs bg-blue-50 px-2 py-1 rounded">จอง</span> : <span className="text-gray-500 font-bold text-xs bg-gray-100 px-2 py-1 rounded">หน้าร้าน</span>}</td>
                          <td className="p-3 text-sm text-gray-600">{new Date(bill.created_at).toLocaleString('th-TH')}</td><td className="p-3 font-bold text-[#F12B6B]">฿{Number(bill.total_amount).toFixed(2)}</td><td className="p-3 text-sm text-gray-600">{bill.cashier_name}</td>
                          <td className="p-3 text-center">{bill.status === 'VOIDED' ? <span className="text-red-500 font-bold text-xs bg-red-50 px-2 py-1 rounded">ยกเลิกแล้ว</span> : <span className="text-green-500 font-bold text-xs bg-green-50 px-2 py-1 rounded">สำเร็จ</span>}</td>
                          <td className="p-3 text-center flex justify-center gap-2">
                            <button onClick={() => handleViewBill(bill)} className="text-[#F12B6B] bg-[#FFF5F7] hover:bg-[#F6C7C7] p-2 rounded-lg transition"><Eye size={18} /></button>
                            {bill.source !== 'PREORDER' && bill.status !== 'VOIDED' && <button onClick={() => handleVoidBill(bill.id)} className="text-red-500 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition"><Trash2 size={18} /></button>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: จัดการสินค้า (มีช่องค้นหา) */}
          {activeTab === 'PRODUCTS' && (
            <div className="animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Package className="text-[#F12B6B]" /> สินค้าในระบบ</h2>
                <div className="flex w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-64">
                    <input type="text" placeholder="ค้นหาสินค้า..." value={searchProduct} onChange={e => setSearchProduct(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-[#F6C7C7] rounded-xl focus:ring-2 focus:ring-[#F12B6B] outline-none text-sm" />
                    <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                  </div>
                  <button onClick={() => { setActiveModal('ADD_PRODUCT'); setVendorSearch(''); }} className="shrink-0 bg-[#F12B6B] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#FF467E] flex justify-center items-center gap-2 transition"><Plus size={18} /> <span className="hidden sm:inline">เพิ่มสินค้า</span></button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProducts.map(p => (
                  <div key={p.id} className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-[#F6C7C7] relative group">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-12 h-12 bg-[#FFF5F7] rounded-lg overflow-hidden shrink-0 border border-[#F6C7C7] flex items-center justify-center">
                        {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <Package size={20} className="text-gray-300" />}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-gray-800 line-clamp-1 text-sm">{p.name}</p>
                        <p className="text-xs text-gray-400">บาร์โค้ด: {p.barcode || '-'}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-end mt-2">
                      <span className="text-xl md:text-2xl font-bold text-[#F12B6B]">฿{Number(p.price).toFixed(2)}</span>
                      <span className="text-xs font-medium text-gray-500 bg-[#FFF5F7] px-2 py-1 rounded-md">สต๊อก: {p.stock}</span>
                    </div>
                    <div className="absolute top-3 right-3 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition bg-white p-1 rounded-lg shadow-sm border border-[#F6C7C7] md:border-0 md:shadow-none">
                      <button onClick={() => { setEditingProduct(p); setActiveModal('EDIT_PRODUCT'); setVendorSearch(''); }} className="text-[#FD94B4] hover:text-[#FF467E] hover:bg-[#FFF5F7] p-1.5 rounded-md transition" title="แก้ไขสินค้า"><Edit size={16} /></button>
                      <button onClick={() => handleDeleteProduct(p.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition" title="ลบสินค้า"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: หมวดหมู่ */}
          {activeTab === 'CATEGORIES' && (
            <div className="animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Tags className="text-[#F12B6B]" /> หมวดหมู่สินค้า</h2>
                <div className="flex w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-64">
                    <input type="text" placeholder="ค้นหาหมวดหมู่..." value={searchCategory} onChange={e => setSearchCategory(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-[#F6C7C7] rounded-xl focus:ring-2 focus:ring-[#F12B6B] outline-none text-sm" />
                    <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                  </div>
                  <button onClick={() => setActiveModal('ADD_CATEGORY')} className="shrink-0 bg-[#F12B6B] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#FF467E] flex justify-center items-center gap-2 transition"><Plus size={18} /> <span className="hidden sm:inline">เพิ่มหมวดหมู่</span></button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {filteredCategories.map(c => (
                  <div key={c.id} className="bg-white p-4 rounded-xl border border-[#F6C7C7] flex justify-between items-center group shadow-sm">
                    <span className="font-bold text-gray-700 text-sm md:text-base">{c.name}</span>
                    <button onClick={() => handleDeleteCategory(c.id)} className="text-red-400 hover:text-red-600 p-1 md:opacity-0 md:group-hover:opacity-100 transition"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: ซัพพลายเออร์ */}
          {activeTab === 'SUPPLIERS' && (
            <div className="animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Truck className="text-[#F12B6B]" /> ซัพพลายเออร์</h2>
                <div className="flex w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-64">
                    <input type="text" placeholder="ค้นหาชื่อ, เบอร์ติดต่อ..." value={searchSupplier} onChange={e => setSearchSupplier(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-[#F6C7C7] rounded-xl focus:ring-2 focus:ring-[#F12B6B] outline-none text-sm" />
                    <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                  </div>
                  <button onClick={() => setActiveModal('ADD_SUPPLIER')} className="shrink-0 bg-[#F12B6B] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#FF467E] flex justify-center items-center gap-2 transition"><Plus size={18} /> <span className="hidden sm:inline">เพิ่มบริษัท</span></button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredSuppliers.map(s => (
                  <div key={s.id} className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-[#F6C7C7] flex justify-between items-center group relative">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 bg-[#FFF5F7] rounded-xl flex items-center justify-center text-[#F12B6B]"><Truck size={20} /></div>
                      <div>
                        <p className="font-bold text-gray-800 text-sm md:text-lg line-clamp-1">{s.name}</p>
                        <p className="text-xs md:text-sm text-gray-500 line-clamp-1">{s.contact_info || '-'}</p>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteSupplier(s.id)} className="text-red-400 hover:text-red-600 p-2 md:opacity-0 md:group-hover:opacity-100 transition absolute top-2 right-2 md:relative"><Trash2 size={18} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: พนักงานและสิทธิ์ */}
          {activeTab === 'USERS' && (
            <div className="animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Users className="text-[#F12B6B]" /> พนักงานในระบบ</h2>
                <div className="flex w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-64">
                    <input type="text" placeholder="ค้นหาชื่อ, รหัสนักศึกษา..." value={searchUser} onChange={e => setSearchUser(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-[#F6C7C7] rounded-xl focus:ring-2 focus:ring-[#F12B6B] outline-none text-sm" />
                    <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                  </div>
                  {/* ⭐️ ซิงค์รายชื่อจาก CSV */}
                  <label className="shrink-0 bg-white border border-[#F6C7C7] text-[#F12B6B] px-4 py-2 rounded-xl font-bold hover:bg-[#FFF5F7] flex justify-center items-center gap-2 transition cursor-pointer">
                    <Upload size={18} /> <span className="hidden sm:inline">นำเข้า CSV</span>
                    <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
                  </label>
                  {/* ปุ่มเปลี่ยนชื่อจาก เพิ่มพนักงาน เป็น แต่งตั้งสิทธิ์ */}
                  <button onClick={() => setActiveModal('ADD_USER')} className="shrink-0 bg-[#F12B6B] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#FF467E] flex justify-center items-center gap-2 transition"><Plus size={18} /> <span className="hidden sm:inline">แต่งตั้งสิทธิ์</span></button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredUsers.map(u => (
                  <div key={u.id} className={`bg-white p-4 md:p-5 rounded-2xl shadow-sm border flex flex-col group relative ${u.role === 'ADMIN' ? 'border-fuchsia-200 bg-fuchsia-50/30' : 'border-[#F6C7C7]'}`}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-10 h-10 md:w-12 md:h-12 shrink-0 rounded-full flex items-center justify-center font-bold text-white shadow-inner text-lg ${u.role === 'ADMIN' ? 'bg-fuchsia-600' : u.role === 'CASHIER' ? 'bg-[#F12B6B]' : 'bg-gray-400'}`}>
                        {u.full_name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 line-clamp-1 text-sm md:text-base">{u.full_name}</p>
                        <p className="text-xs text-gray-400">@{u.username}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-end mt-auto">
                      <span className={`px-2 py-1 rounded-md text-[10px] md:text-xs font-bold ${u.role === 'ADMIN' ? 'bg-fuchsia-100 text-fuchsia-600' : u.role === 'CASHIER' ? 'bg-[#FFF5F7] text-[#F12B6B]' : 'bg-gray-100 text-gray-500'}`}>{u.role}</span>
                    </div>

                    {/* ⭐️ ปุ่ม Edit และ Delete คู่กัน */}
                    <div className="absolute top-3 right-3 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition bg-white p-1 rounded-lg shadow-sm border border-[#F6C7C7] md:border-0 md:shadow-none">
                      <button onClick={() => { setEditingUser(u); setActiveModal('EDIT_USER'); }} className="text-[#FD94B4] hover:text-[#FF467E] hover:bg-[#FFF5F7] p-1.5 rounded-md transition" title="เปลี่ยนสิทธิ์">
                        <Edit size={16} />
                      </button>
                      <button onClick={() => handleDeleteUser(u.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition" title="ลบพนักงาน">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 7: โปรโมชั่น (ใหม่!) */}
          {activeTab === 'PROMOTIONS' && (
            <div className="animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Gift className="text-[#F12B6B]" /> โปรโมชั่น / ส่วนลด</h2>
                <div className="flex w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-64">
                    <input type="text" placeholder="ค้นหาชื่อโปรโมชั่น..." value={searchPromotion} onChange={e => setSearchPromotion(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-[#F6C7C7] rounded-xl focus:ring-2 focus:ring-[#F12B6B] outline-none text-sm" />
                    <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                  </div>
                  <button onClick={() => setActiveModal('ADD_PROMOTION')} className="shrink-0 bg-[#F12B6B] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#FF467E] flex justify-center items-center gap-2 transition"><Plus size={18} /> <span className="hidden sm:inline">สร้างโปรโมชั่น</span></button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPromotions.map(p => (
                  <div key={p.id} className="bg-white p-4 rounded-2xl shadow-sm border border-[#F6C7C7] flex flex-col gap-2 relative">
                    <div className="flex justify-between items-start">
                      <h3 className="font-bold text-gray-800">{p.name}</h3>
                      <span className={`px-2 py-1 rounded-md text-[10px] font-bold ${p.is_active ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>{p.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
                    </div>
                    <p className="text-sm font-bold text-[#F12B6B] mt-2">
                      {p.discount_type === 'PERCENT' ? `ลด ${p.discount_value}%` : p.discount_type === 'FIXED' ? `ลด ฿${p.discount_value}` :
                        `ซื้อ ${products.find(pr => pr.id === p.buy_product_id)?.name || '?'} ครบ ${p.buy_qty} แถม ${products.find(pr => pr.id === p.free_product_id)?.name || '?'} ${p.free_qty} ชิ้น`}
                    </p>
                    {(p.usage_limit != null || p.usage_limit_per_user != null) && (
                      <p className="text-xs text-orange-600 font-medium">
                        {p.usage_limit != null && `ใช้แล้ว ${p.usage_count || 0}/${p.usage_limit} ครั้ง`}
                        {p.usage_limit != null && p.usage_limit_per_user != null && ' • '}
                        {p.usage_limit_per_user != null && `จำกัด ${p.usage_limit_per_user} ครั้ง/คน`}
                      </p>
                    )}
                    <div className="text-xs text-gray-500 mt-auto bg-gray-50 p-2 rounded-lg border border-gray-100">
                      <p>เริ่ม: <span className="font-medium">{p.start_date ? new Date(p.start_date).toLocaleDateString('th-TH') : 'ไม่ระบุ'}</span></p>
                      <p>สิ้นสุด: <span className="font-medium">{p.end_date ? new Date(p.end_date).toLocaleDateString('th-TH') : 'ไม่มีวันหมดอายุ'}</span></p>
                    </div>
                  </div>
                ))}
                {filteredPromotions.length === 0 && <div className="col-span-full p-8 text-center text-gray-400">ไม่พบข้อมูลโปรโมชั่น</div>}
              </div>
            </div>
          )}

          {/* TAB 8: คิวคำขอรีเซ็ตรหัสผ่าน — ⭐️ FIX: ระบบยังไม่ต่อ SMS/อีเมลจริง ADMIN ต้องคัดลอกลิงก์ไปส่งให้นักเรียนเอง */}
          {activeTab === 'PASSWORD_RESETS' && (
            <div className="animate-fade-in">
              <div className="mb-6">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><KeyRound className="text-[#F12B6B]" /> คำขอรีเซ็ตรหัสผ่าน</h2>
                <p className="text-xs md:text-sm text-gray-500 mt-1">ระบบยังไม่ได้ต่อ SMS/อีเมลจริง — เมื่อนักเรียนขอรีเซ็ตรหัสผ่าน คำขอจะมาค้างที่นี่ ให้กด "คัดลอกลิงก์" แล้วส่งให้นักเรียนเอง (เช่น ทาง LINE) หลังยืนยันตัวตนแล้ว ลิงก์หมดอายุใน 1 ชั่วโมง</p>
              </div>

              {passwordResets.length === 0 ? (
                <div className="p-8 text-center text-gray-400 bg-[#FFF5F7] rounded-2xl border border-[#F6C7C7]">ไม่มีคำขอรีเซ็ตรหัสผ่านที่ค้างอยู่</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {passwordResets.map(r => (
                    <div key={r.id} className="bg-white p-4 rounded-2xl shadow-sm border border-[#F6C7C7] flex flex-col gap-3">
                      <div>
                        <p className="font-bold text-gray-800">{r.full_name}</p>
                        <p className="text-xs text-gray-400">รหัสนักศึกษา {r.student_id}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Phone size={13} className="text-gray-400 shrink-0" /> {r.phone_number || '-'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Clock size={13} className="text-gray-400 shrink-0" /> หมดอายุ {new Date(r.expires_at).toLocaleString('th-TH')}
                      </div>
                      <div className="flex gap-2 mt-auto pt-2">
                        <button onClick={() => handleCopyResetLink(r.reset_token)} className="flex-1 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-bold text-sm py-2 rounded-xl transition-colors duration-150 flex items-center justify-center gap-1.5"><Copy size={15} /> คัดลอกลิงก์</button>
                        <button onClick={() => handleRejectPasswordReset(r.id)} className="bg-white border border-red-200 text-red-600 hover:bg-red-50 font-bold text-sm px-3 py-2 rounded-xl transition-colors duration-150"><X size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ================= MODALS ================= */}

      {/* ⭐️ MODAL แก้ไขสินค้า */}
      {activeModal === 'EDIT_PRODUCT' && editingProduct && (
        <CustomModal title="แก้ไขข้อมูลสินค้า" onClose={() => { setActiveModal(null); setEditingProduct(null); setVendorSearch(''); }}>
          <form onSubmit={handleEditProduct} className="space-y-3 md:space-y-4">
            <Input label="ชื่อสินค้า" value={editingProduct.name} onChange={(v: any) => setEditingProduct({ ...editingProduct, name: v })} />
            <Input label="บาร์โค้ด (ถ้ามี)" value={editingProduct.barcode || ''} required={false} onChange={(v: any) => setEditingProduct({ ...editingProduct, barcode: v })} />

            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">หมวดหมู่</label>
              <select className="w-full p-2.5 md:p-3 border border-[#F6C7C7] rounded-xl outline-none focus:ring-2 focus:ring-[#F12B6B] text-sm md:text-base" value={editingProduct.category_id || ''} onChange={e => setEditingProduct({ ...editingProduct, category_id: e.target.value })}>
                <option value="">-- ไม่ระบุ --</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* ⭐️ ส่วนแก้ไขเจ้าของผลงาน พร้อมช่องค้นหา! */}
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl mt-3 space-y-3">
              <div>
                <label className="block text-xs md:text-sm font-bold text-blue-800 mb-1">ค้นหาเจ้าของผลงาน</label>
                <div className="relative">
                  <input type="text" placeholder="พิมพ์ชื่อหรือรหัสนักศึกษา..." value={vendorSearch} onChange={e => setVendorSearch(e.target.value)} className="w-full pl-8 pr-3 py-2 text-sm border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
                  <Search size={14} className="absolute left-2.5 top-2.5 text-blue-400" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs md:text-sm font-bold text-blue-800 mb-1">เลือกเจ้าของผลงาน</label>
                  <select className="w-full p-2.5 border border-blue-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    value={editingProduct.vendor_id || ''}
                    onChange={e => setEditingProduct({ ...editingProduct, vendor_id: e.target.value })}>
                    <option value="">-- สินค้าของสหกรณ์ (ไม่หัก GP) --</option>
                    {filteredVendors.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>)}
                  </select>
                </div>
                <Input label="GP ส่วนแบ่งสหกรณ์ (%)" type="number" value={editingProduct.gp_rate || ''} required={false} onChange={(v: any) => setEditingProduct({ ...editingProduct, gp_rate: v })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="ต้นทุน/ชิ้น (฿)" type="number" value={editingProduct.cost ?? ''} required={false} onChange={(v: any) => setEditingProduct({ ...editingProduct, cost: v })} />
              <Input label="ราคาขาย (฿)" type="number" value={editingProduct.price} onChange={(v: any) => setEditingProduct({ ...editingProduct, price: v })} />
            </div>
            <Input label="สต๊อกปัจจุบัน" type="number" value={editingProduct.stock} disabled={true} required={false} onChange={() => { }} />

            <Input label="URL รูปภาพ (ถ้ามี)" value={editingProduct.image_url || ''} required={false} onChange={(v: any) => setEditingProduct({ ...editingProduct, image_url: v })} />

            {/* ⭐️ Phase 1 — โปรโมชั่นช่วงวันที่ (ลด % เฉพาะช่วง ใช้ทั้ง POS + จอง) */}
            <div className="bg-[#FFF5F7] border border-[#FD94B4] rounded-xl p-3 space-y-3">
              <p className="text-xs font-bold text-[#F12B6B]">🏷️ โปรโมชั่นช่วงวันที่ (ลดเฉพาะช่วง)</p>
              <Input label="ลดราคา % ช่วงโปร" type="number" min="0" max="100" value={editingProduct.promo_percent || ''} required={false} onChange={(v: any) => setEditingProduct({ ...editingProduct, promo_percent: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="เริ่มโปร" type="date" value={editingProduct.promo_start ? String(editingProduct.promo_start).slice(0, 10) : ''} required={false} onChange={(v: any) => setEditingProduct({ ...editingProduct, promo_start: v })} />
                <Input label="สิ้นสุดโปร" type="date" value={editingProduct.promo_end ? String(editingProduct.promo_end).slice(0, 10) : ''} required={false} onChange={(v: any) => setEditingProduct({ ...editingProduct, promo_end: v })} />
              </div>
              {editingProduct.vendor_id && <p className="text-[11px] text-amber-600">⚠️ สินค้าฝากขาย — ควรคุยกับเจ้าของสินค้าก่อนตั้งโปร (ส่วนลดหักตามสัดส่วน เจ้าของได้น้อยลงด้วย)</p>}
            </div>

            {/* ⭐️ Sprint 2 — Expiry Discount: expiry_date + discount_percent */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 space-y-3">
              <p className="text-xs font-bold text-yellow-800">วันหมดอายุและส่วนลด</p>
              <Input
                label="วันหมดอายุ (ถ้ามี)"
                type="date"
                value={editingProduct.expiry_date || ''}
                required={false}
                onChange={(v: any) => setEditingProduct({ ...editingProduct, expiry_date: v })}
              />
              <Input
                label="ลดราคา % (ใกล้หมดอายุ)"
                type="number"
                min="0"
                max="100"
                value={editingProduct.discount_percent || 40}
                required={false}
                onChange={(v: any) => setEditingProduct({ ...editingProduct, discount_percent: v })}
              />
            </div>

            <button type="submit" className="w-full bg-[#F12B6B] text-white p-3 rounded-xl font-bold hover:bg-[#FF467E] mt-2 transition">บันทึกการแก้ไข</button>
          </form>
        </CustomModal>
      )}

      {/* ⭐️ MODAL เพิ่มสินค้า */}
      {activeModal === 'ADD_PRODUCT' && (
        <CustomModal title="เพิ่มสินค้าใหม่" onClose={() => { setActiveModal(null); setVendorSearch(''); }}>
          <form onSubmit={handleAddProduct} className="space-y-3 md:space-y-4">
            <Input label="ชื่อสินค้า" value={newProduct.name} onChange={(v: any) => setNewProduct({ ...newProduct, name: v })} />
            
            {/* ⭐️ ส่วนเพิ่มเจ้าของผลงาน พร้อมช่องค้นหา! */}
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl mt-3 space-y-3">
              <div>
                <label className="block text-xs md:text-sm font-bold text-blue-800 mb-1">ค้นหาเจ้าของผลงาน</label>
                <div className="relative">
                  <input type="text" placeholder="พิมพ์ชื่อหรือรหัสนักศึกษา..." value={vendorSearch} onChange={e => setVendorSearch(e.target.value)} className="w-full pl-8 pr-3 py-2 text-sm border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
                  <Search size={14} className="absolute left-2.5 top-2.5 text-blue-400" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs md:text-sm font-bold text-blue-800 mb-1">เลือกเจ้าของผลงาน</label>
                  <select className="w-full p-2.5 border border-blue-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    value={newProduct.vendor_id || ''}
                    onChange={e => setNewProduct({ ...newProduct, vendor_id: e.target.value })}>
                    <option value="">-- สินค้าของสหกรณ์ (ไม่หัก GP) --</option>
                    {filteredVendors.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>)}
                  </select>
                </div>
                <Input label="GP ส่วนแบ่งสหกรณ์ (%)" type="number" value={newProduct.gp_rate || ''} required={false} onChange={(v: any) => setNewProduct({ ...newProduct, gp_rate: v })} />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Input label="ต้นทุน/ชิ้น (฿)" type="number" value={newProduct.cost} required={false} onChange={(v: any) => setNewProduct({ ...newProduct, cost: v })} />
              <Input label="ราคาขาย (฿)" type="number" value={newProduct.price} onChange={(v: any) => setNewProduct({ ...newProduct, price: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="สต๊อกตั้งต้น" type="number" value={newProduct.stock} required={false} onChange={(v: any) => setNewProduct({ ...newProduct, stock: v })} />
            </div>
            <Input label="URL รูปภาพ (ถ้ามี)" value={newProduct.image_url} required={false} onChange={(v: any) => setNewProduct({ ...newProduct, image_url: v })} />

            {/* ⭐️ Phase 1 — โปรโมชั่นช่วงวันที่ */}
            <div className="bg-[#FFF5F7] border border-[#FD94B4] rounded-xl p-3 space-y-3">
              <p className="text-xs font-bold text-[#F12B6B]">🏷️ โปรโมชั่นช่วงวันที่ (ลดเฉพาะช่วง)</p>
              <Input label="ลดราคา % ช่วงโปร" type="number" min="0" max="100" value={newProduct.promo_percent} required={false} onChange={(v: any) => setNewProduct({ ...newProduct, promo_percent: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="เริ่มโปร" type="date" value={newProduct.promo_start} required={false} onChange={(v: any) => setNewProduct({ ...newProduct, promo_start: v })} />
                <Input label="สิ้นสุดโปร" type="date" value={newProduct.promo_end} required={false} onChange={(v: any) => setNewProduct({ ...newProduct, promo_end: v })} />
              </div>
              {newProduct.vendor_id && <p className="text-[11px] text-amber-600">⚠️ สินค้าฝากขาย — ควรคุยกับเจ้าของสินค้าก่อนตั้งโปร (ส่วนลดหักตามสัดส่วน เจ้าของได้น้อยลงด้วย)</p>}
            </div>

            {/* ⭐️ Sprint 2 — Expiry Discount: expiry_date + discount_percent */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 space-y-3">
              <p className="text-xs font-bold text-yellow-800">วันหมดอายุและส่วนลด (ถ้ามี)</p>
              <Input
                label="วันหมดอายุ (ถ้ามี)"
                type="date"
                value={newProduct.expiry_date || ''}
                required={false}
                onChange={(v: any) => setNewProduct({ ...newProduct, expiry_date: v })}
              />
              <Input
                label="ลดราคา % (ใกล้หมดอายุ)"
                type="number"
                min="0"
                max="100"
                value={newProduct.discount_percent || 40}
                required={false}
                onChange={(v: any) => setNewProduct({ ...newProduct, discount_percent: v })}
              />
            </div>

            <button type="submit" className="w-full bg-[#F12B6B] text-white p-3 rounded-xl font-bold hover:bg-[#FF467E] mt-2">บันทึกสินค้าใหม่</button>
          </form>
        </CustomModal>
      )}

      {/* ⭐️ MODAL แต่งตั้งพนักงาน */}
      {activeModal === 'ADD_USER' && (
        <CustomModal title="แต่งตั้ง / อัปเดตสิทธิ์" onClose={() => setActiveModal(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.put('/users/update-role', { student_id: newUser.username, role: newUser.role });
              setActiveModal(null); fetchUsers();
              Swal.fire({ icon: 'success', title: 'แต่งตั้งสำเร็จ!' });
            } catch (err: any) { Swal.fire({ icon: 'error', text: err.response?.data?.error || 'ไม่พบรหัสนักศึกษานี้' }); }
          }} className="space-y-4">
            <Input label="รหัสนักศึกษาที่ต้องการจัดการ" value={newUser.username} onChange={(v: any) => setNewUser({ ...newUser, username: v })} />
            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">เลือกบทบาท (Role)</label>
              <select className="w-full p-2.5 md:p-3 border border-[#F6C7C7] rounded-xl outline-none focus:ring-2 focus:ring-[#F12B6B] text-sm md:text-base" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                <option value="MEMBER">นักศึกษาทั่วไป (MEMBER)</option>
                <option value="CASHIER">แคชเชียร์ (CASHIER)</option>
                <option value="ADMIN">ผู้จัดการ (ADMIN)</option>
              </select>
            </div>
            <button type="submit" className="w-full bg-[#F12B6B] text-white p-3 rounded-xl font-bold hover:bg-[#FF467E] mt-2">ยืนยัน</button>
          </form>
        </CustomModal>
      )}

      {/* ⭐️ MODAL เปลี่ยนสิทธิ์พนักงานตรงๆ จากหน้าการ์ด */}
      {activeModal === 'EDIT_USER' && editingUser && (
        <CustomModal title="เปลี่ยนสิทธิ์การเข้าถึง" onClose={() => { setActiveModal(null); setEditingUser(null); }}>
          <form onSubmit={handleEditUserRole} className="space-y-4">
            <Input label="ชื่อพนักงาน" value={editingUser.full_name} disabled={true} onChange={()=>{}} />
            <Input label="รหัสนักศึกษา" value={editingUser.username} disabled={true} onChange={()=>{}} />
            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">เลือกบทบาทใหม่ (Role)</label>
              <select className="w-full p-2.5 md:p-3 border border-[#F6C7C7] rounded-xl outline-none focus:ring-2 focus:ring-[#F12B6B] text-sm md:text-base" value={editingUser.role} onChange={e => setEditingUser({ ...editingUser, role: e.target.value })}>
                <option value="MEMBER">ลดขั้นเป็นนักศึกษาทั่วไป (MEMBER)</option>
                <option value="CASHIER">แคชเชียร์ (CASHIER)</option>
                <option value="ADMIN">ผู้จัดการ (ADMIN)</option>
              </select>
            </div>
            <button type="submit" className="w-full bg-[#F12B6B] text-white p-3 rounded-xl font-bold hover:bg-[#FF467E] mt-2">บันทึกสิทธิ์</button>
          </form>
        </CustomModal>
      )}

      {/* ⭐️ MODAL สร้างโปรโมชั่น (ใหม่!) */}
      {activeModal === 'ADD_PROMOTION' && (
        <CustomModal title="สร้างโปรโมชั่นใหม่" onClose={() => setActiveModal(null)}>
          <form onSubmit={handleAddPromotion} className="space-y-4">
            <Input label="ชื่อโปรโมชั่น" value={newPromotion.name} onChange={(v:any) => setNewPromotion({...newPromotion, name: v})} />
            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">ประเภทส่วนลด</label>
              <select className="w-full p-2.5 border border-[#F6C7C7] rounded-xl outline-none focus:ring-2 focus:ring-[#F12B6B] text-sm" value={newPromotion.discount_type} onChange={e => setNewPromotion({...newPromotion, discount_type: e.target.value})}>
                <option value="PERCENT">ลดเป็นเปอร์เซ็นต์ (%)</option>
                <option value="FIXED">ลดเป็นจำนวนเงิน (฿)</option>
                <option value="BOGO">ซื้อครบแถม (เช่น ซื้อ 1 แถม 1, ซื้อ 2 แถม 1)</option>
              </select>
            </div>

            {newPromotion.discount_type !== 'BOGO' ? (
              <Input label="มูลค่าส่วนลด" type="number" value={newPromotion.discount_value} onChange={(v:any) => setNewPromotion({...newPromotion, discount_value: v})} />
            ) : (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-blue-800 mb-1">สินค้าที่ต้องซื้อ</label>
                    <select className="w-full p-2 border border-blue-200 rounded-lg outline-none text-sm" value={newPromotion.buy_product_id} onChange={e => setNewPromotion({...newPromotion, buy_product_id: e.target.value})}>
                      <option value="">-- เลือกสินค้า --</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <Input label="ซื้อครบ (ชิ้น)" type="number" value={newPromotion.buy_qty} onChange={(v:any) => setNewPromotion({...newPromotion, buy_qty: v})} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-blue-800 mb-1">สินค้าที่แถม</label>
                    <select className="w-full p-2 border border-blue-200 rounded-lg outline-none text-sm" value={newPromotion.free_product_id} onChange={e => setNewPromotion({...newPromotion, free_product_id: e.target.value})}>
                      <option value="">-- เลือกสินค้า --</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <Input label="แถม (ชิ้น)" type="number" value={newPromotion.free_qty} onChange={(v:any) => setNewPromotion({...newPromotion, free_qty: v})} />
                </div>
                <p className="text-[11px] text-blue-700">* สินค้าที่แถมต้องอยู่ในตะกร้าจริง ระบบจะคิดส่วนลดเท่ากับราคาสินค้าที่แถมเท่านั้น</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Input label="วันเริ่มต้น (เว้นได้)" type="date" required={false} value={newPromotion.start_date} onChange={(v:any) => setNewPromotion({...newPromotion, start_date: v})} />
              <Input label="วันหมดเขต (เว้นได้)" type="date" required={false} value={newPromotion.end_date} onChange={(v:any) => setNewPromotion({...newPromotion, end_date: v})} />
            </div>

            <div className="pt-3 border-t border-[#F6C7C7]">
              <p className="text-xs font-bold text-gray-600 mb-2">จำกัดสิทธิ์การใช้ (เว้นว่าง = ไม่จำกัด)</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="ใช้ได้รวมกี่ครั้ง" type="number" required={false} value={newPromotion.usage_limit} onChange={(v:any) => setNewPromotion({...newPromotion, usage_limit: v})} />
                <Input label="ใช้ได้กี่ครั้ง/คน" type="number" required={false} value={newPromotion.usage_limit_per_user} onChange={(v:any) => setNewPromotion({...newPromotion, usage_limit_per_user: v})} />
              </div>
            </div>

            <button type="submit" className="w-full bg-[#F12B6B] text-white p-3 rounded-xl font-bold hover:bg-[#FF467E] mt-2">บันทึกโปรโมชั่น</button>
          </form>
        </CustomModal>
      )}

      {/* Modals ยิบย่อยอื่นๆ */}
      {viewingBillItems && viewingBillInfo && (
        <CustomModal title={`บิล #${viewingBillInfo.id}`} onClose={() => { setViewingBillItems(null); setViewingBillInfo(null); }}>
          <p className="text-gray-500 text-xs md:text-sm mb-4">{new Date(viewingBillInfo.created_at).toLocaleString('th-TH')}</p>
          <div className="overflow-y-auto max-h-60 mb-4 border border-[#F6C7C7] rounded-lg">
            <table className="w-full text-left text-xs md:text-sm">
              <thead className="bg-[#FFF5F7] text-gray-600 sticky top-0"><tr><th className="p-2 border-b">สินค้า</th><th className="p-2 border-b text-center">จำนวน</th><th className="p-2 border-b text-right">รวม</th></tr></thead>
              <tbody>
                {viewingBillItems.map((item, idx) => (
                  <tr key={idx} className="border-b last:border-0"><td className="p-2 font-bold text-gray-800">{item.product_name}</td><td className="p-2 text-center">{item.quantity}</td><td className="p-2 text-right font-bold text-[#F12B6B]">฿{Number(item.subtotal).toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center p-4 bg-[#FFF5F7] rounded-xl mb-4 border border-[#F6C7C7]">
            <span className="font-bold text-[#FF467E] text-sm">ยอดรวมทั้งสิ้น</span><span className="text-xl md:text-2xl font-bold text-[#F12B6B]">฿{Number(viewingBillInfo.total_amount).toFixed(2)}</span>
          </div>
          {viewingBillInfo.status !== 'VOIDED' && (
            <button onClick={() => handleVoidBill(viewingBillInfo.id)} className="w-full bg-red-500 text-white font-bold py-3 rounded-xl hover:bg-red-600 transition flex justify-center items-center gap-2"><Trash2 size={18} /> ยกเลิกบิล (Void)</button>
          )}
        </CustomModal>
      )}
      {activeModal === 'ADD_CATEGORY' && (<CustomModal title="เพิ่มหมวดหมู่" onClose={() => setActiveModal(null)}><form onSubmit={handleAddCategory} className="space-y-4"><Input label="ชื่อหมวดหมู่" value={newCategory} onChange={setNewCategory} /><button type="submit" className="w-full bg-[#F12B6B] text-white p-3 rounded-xl font-bold hover:bg-[#FF467E] mt-2">เพิ่มหมวดหมู่</button></form></CustomModal>)}
      {activeModal === 'ADD_SUPPLIER' && (<CustomModal title="เพิ่มตัวแทนจำหน่าย" onClose={() => setActiveModal(null)}><form onSubmit={handleAddSupplier} className="space-y-4"><Input label="ชื่อบริษัท / บุคคล" value={newSupplier.name} onChange={(v: any) => setNewSupplier({ ...newSupplier, name: v })} /><Input label="ข้อมูลติดต่อ" value={newSupplier.contact_info} required={false} onChange={(v: any) => setNewSupplier({ ...newSupplier, contact_info: v })} /><button type="submit" className="w-full bg-[#F12B6B] text-white p-3 rounded-xl font-bold hover:bg-[#FF467E] mt-2">บันทึกข้อมูล</button></form></CustomModal>)}
      
      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; } .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
    </div>
  );
}

const TabButton = ({ icon, label, isActive, onClick, badge }: any) => (
  <button onClick={onClick} className={`shrink-0 snap-start flex items-center gap-2 px-4 py-3 md:p-4 rounded-xl font-bold text-sm md:text-base transition ${isActive ? 'bg-[#F12B6B] text-white shadow-md' : 'bg-white text-gray-600 hover:bg-[#F6C7C7] border border-[#F6C7C7]'}`}>
    {icon} <span className="whitespace-nowrap">{label}</span>
    {!!badge && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isActive ? 'bg-white/25 text-white' : 'bg-[#FFF5F7] text-[#F12B6B]'}`}>{badge}</span>}
  </button>
);

const Input = ({ label, value, onChange, type = "text", required = true, disabled = false }: any) => (
  <div>
    <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">{label}</label>
    <input type={type} required={required} disabled={disabled} value={value} onChange={e => onChange(e.target.value)} className={`w-full p-2.5 md:p-3 border border-[#F6C7C7] rounded-xl focus:ring-2 focus:ring-[#F12B6B] outline-none transition text-sm md:text-base ${disabled ? 'bg-[#FFF5F7] text-gray-400 cursor-not-allowed' : ''}`} />
  </div>
);

const CustomModal = ({ title, onClose, children }: any) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-end md:items-center justify-center sm:p-4 animate-fade-in">
    <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-lg w-full max-w-md overflow-hidden flex flex-col transform transition-all">
      <div className="px-5 py-4 border-b border-[#F6C7C7] flex justify-between items-center bg-[#FFF5F7] rounded-t-2xl md:rounded-t-none">
        <h2 className="text-base md:text-lg font-bold text-gray-800">{title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition"><X size={20} /></button>
      </div>
      <div className="p-5 pb-12 md:pb-5 overflow-y-auto max-h-[75dvh] md:max-h-[85dvh]">
        {children}
      </div>
    </div>
  </div>
);