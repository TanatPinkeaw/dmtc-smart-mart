// 📄 pages/Settings.tsx — หน้าตั้งค่า/จัดการข้อมูลหลัก (ADMIN/MANAGER) — ไฟล์ใหญ่ หลายแท็บ
//    ทำอะไร: จัดการสินค้า/หมวดหมู่/ซัพพลายเออร์/พนักงาน+สิทธิ์/โปรโมชั่น/ประวัติขาย+export/ตั้งค่าร้าน/
//    อัตราแต้ม/กลุ่มสมาชิก + เครื่องมือรีเซ็ตข้อมูล; มี import/export CSV+Excel ต่อ entity
//    จุดสำคัญ: รหัสสมาชิกที่ผูก LINE แล้วล็อกแก้ไม่ได้ (ต้องปลดผูกก่อน); โปรที่เคยใช้แล้วลบไม่ได้ (ปิดใช้แทน)
import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Store, History, Users, Tags, Truck, Package, Trash2, Save, Eye, Calendar, Plus, X, Edit, Gift, Search, Upload, KeyRound, Copy, Phone, Clock, Download, FileSpreadsheet, Coins, UsersRound, RotateCcw, AlertTriangle, UserCheck, UserX } from 'lucide-react';
import Swal from '../swal';
import { BRAND } from '../theme'; // ⭐️ สีปุ่มยืนยัน Swal ใช้ token กลาง
import api from '../api';
import { useSocket } from '../hooks/useSocket';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { getLocalDate } from '../utils/localDate'; // ⭐️ วันนี้ตามเวลาท้องถิ่น (ย้าย helper ไป utils กลาง)
import { LoyaltySettingsPanel } from '../components/settings/LoyaltySettingsPanel';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { FieldLabel } from '../components/ui/FieldLabel';
import { Modal } from '../components/ui/Modal';
import { MemberGroupsPanel } from '../components/settings/MemberGroupsPanel';

// ── Types (state ที่เคยเป็น any — shape ตาม backend + การใช้งานจริงในหน้านี้) ──────
interface SettingsUser {
  id: number;
  username: string;
  full_name: string;
  role: string;
  student_id?: string | null;
  phone_number?: string | null;
  points?: number;
  is_active?: boolean | number;
  line_user_id?: string | null;
  group_id?: number | null;
}
interface SettingsCategory { id: number; name: string; }
interface SettingsSupplier { id: number; name: string; contact_info?: string; }
interface SettingsProduct {
  id: number;
  name: string;
  barcode?: string;
  price?: number | string;
  cost?: number | string;
  stock?: number;
  image_url?: string;
  category_id?: number | null;
  vendor_id?: number | null;
  gp_rate?: number | string;
  promo_percent?: number | string;
  promo_start?: string | null;
  promo_end?: string | null;
  expiry_date?: string | null;
  discount_percent?: number | string;
  is_reward_item?: boolean;
  points_required?: number | string;
  is_active?: boolean;
}
interface SettingsPromotion {
  id: number;
  name: string;
  discount_type?: string;
  discount_value?: number | string;
  start_date?: string;
  end_date?: string;
  buy_product_id?: number | null;
  buy_qty?: number;
  free_product_id?: number | null;
  free_qty?: number;
  usage_limit?: number | string;
  usage_limit_per_user?: number | string;
  usage_count?: number;
  is_active?: boolean | number;
}
interface PasswordReset { id: number; full_name?: string; student_id?: string; phone_number?: string | null; expires_at?: string; reset_token?: string; }
interface MemberGroup { id: number; name: string; default_discount_percent: number | string; }
interface SaleRow { id: number; source?: string; total_amount?: number; payment_method?: string; created_at?: string; cashier_name?: string; member_name?: string | null; promo_name?: string | null; status?: string; }
interface BillItem { product_name: string; quantity: number; subtotal: number; }

export default function Settings() {
  const socket = useSocket();

  // ⭐️ 1. เพิ่ม 'PROMOTIONS' ใน Tabs
  // ⭐️ FIX — เพิ่มแท็บ 'PASSWORD_RESETS' คิวคำขอรีเซ็ตรหัสผ่านที่ ADMIN ต้องอนุมัติ/ส่งลิงก์เอง
  const [activeTab, setActiveTab] = useState<'STORE' | 'HISTORY' | 'USERS' | 'CATEGORIES' | 'SUPPLIERS' | 'PRODUCTS' | 'PROMOTIONS' | 'LOYALTY' | 'GROUPS' | 'PASSWORD_RESETS'>('STORE');

  // ⭐️ 2. เพิ่ม 'EDIT_USER' และ 'ADD_PROMOTION' ใน Modals
  const [activeModal, setActiveModal] = useState<'ADD_PRODUCT' | 'EDIT_PRODUCT' | 'ADD_CATEGORY' | 'ADD_SUPPLIER' | 'ADD_USER' | 'EDIT_USER' | 'ADD_PROMOTION' | null>(null);

  const [storeInfo, setStoreInfo] = useState({ store_name: '', tax_id: '', address: '', receipt_footer: '' });
  const [salesHistory, setSalesHistory] = useState<SaleRow[]>([]);
  const [users, setUsers] = useState<SettingsUser[]>([]);
  const [categories, setCategories] = useState<SettingsCategory[]>([]);
  const [suppliers, setSuppliers] = useState<SettingsSupplier[]>([]);
  const [products, setProducts] = useState<SettingsProduct[]>([]);
  const [promotions, setPromotions] = useState<SettingsPromotion[]>([]);
  const [passwordResets, setPasswordResets] = useState<PasswordReset[]>([]); // ⭐️ FIX — คิวคำขอรีเซ็ตรหัสผ่าน

  // ⭐️ 3. เพิ่ม State สำหรับช่องค้นหาทุกๆ แท็บ
  const [searchProduct, setSearchProduct] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [searchSupplier, setSearchSupplier] = useState('');
  const [searchUser, setSearchUser] = useState('');
  const [searchPromotion, setSearchPromotion] = useState('');
  const [vendorSearch, setVendorSearch] = useState(''); // ค้นหาเจ้าของผลงานตอนเพิ่มสินค้า

  const [newUser, setNewUser] = useState({ username: '', password: '', full_name: '', role: 'CASHIER' });
  const [editingUser, setEditingUser] = useState<SettingsUser | null>(null); // สำหรับแก้ไขสิทธิ์พนักงาน
  const [memberGroups, setMemberGroups] = useState<MemberGroup[]>([]); // ⭐️ Part 3 — กลุ่มสมาชิก (ใช้กำหนดกลุ่มให้ผู้ใช้)

  const [newCategory, setNewCategory] = useState('');
  const [newSupplier, setNewSupplier] = useState({ name: '', contact_info: '' });
  
  const [newProduct, setNewProduct] = useState({ barcode: '', name: '', category_id: '', price: '', cost: '', stock: '', image_url: '', vendor_id: '', gp_rate: '', promo_percent: '', promo_start: '', promo_end: '', expiry_date: '', discount_percent: '40', is_reward_item: false, points_required: '' });
  const [editingProduct, setEditingProduct] = useState<SettingsProduct | null>(null);

  const [newPromotion, setNewPromotion] = useState({
    name: '', discount_type: 'PERCENT', discount_value: '', start_date: '', end_date: '',
    buy_product_id: '', buy_qty: '', free_product_id: '', free_qty: '',
    usage_limit: '', usage_limit_per_user: ''
  });

  const [startDate, setStartDate] = useState(getLocalDate());
  const [endDate, setEndDate] = useState(getLocalDate());
  const [exporting, setExporting] = useState<'excel' | 'csv' | null>(null);
  const [exportingExecutive, setExportingExecutive] = useState<'excel' | 'csv' | null>(null);
  const [viewingBillItems, setViewingBillItems] = useState<BillItem[] | null>(null);
  const [viewingBillInfo, setViewingBillInfo] = useState<SaleRow | null>(null);
  const [vendors, setVendors] = useState<SettingsUser[]>([]);

  const currentUser = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  // ⭐️ MANAGER เห็นแท็บได้แค่ที่เกี่ยวกับหน้าร้าน — พนักงาน/สิทธิ์, กลุ่มสมาชิก(กฎรายหมวดหมู่), รีเซ็ตรหัสผ่าน สงวนไว้ ADMIN เท่านั้น
  const isAdmin = currentUser.role === 'ADMIN';
  const ADMIN_ONLY_TABS = ['USERS', 'GROUPS', 'PASSWORD_RESETS'] as const;

  // ⭐️ กันเผื่อ activeTab หลุดไปเป็นแท็บ ADMIN-only ได้ (เช่น state ค้างจากรีเฟรช) — เด้งกลับ STORE ให้ MANAGER
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guard ปรับแท็บให้ตรงสิทธิ์ (ตั้งใจ sync — ต้องรีเซ็ตทันที)
    if (!isAdmin && (ADMIN_ONLY_TABS as readonly string[]).includes(activeTab)) setActiveTab('STORE');
  }, [isAdmin, activeTab]);

  const fetchStoreSettings = async () => { const res = await api.get('/settings/store'); setStoreInfo(res.data); };
  // ⭐️ Export ยอดขาย/รายได้ (รวมรายชิ้น+รายบิล+สรุปรายวันไฟล์เดียวเสมอ ดู server.js) เลือกได้แค่ format
  const handleExportCsv = async (format: 'excel' | 'csv') => {
    setExporting(format);
    try {
      const res = await api.get('/reports/export/sales-csv', {
        params: { start_date: startDate, end_date: endDate, format },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sales-export_${startDate}_ถึง_${endDate}.${format === 'excel' ? 'xlsx' : 'csv'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);    } catch (err) { Swal.fire({ icon: 'error', title: 'Export ไม่สำเร็จ', text: getErrorMessage(err) }); } finally {
      setExporting(null);
    }
  };
  // ⭐️ Phase 4 Part 2 — Executive Summary export (KPI/top-products/category/inventory + full
  // transaction detail). เดียวกับ handleExportCsv แค่ยิงคนละ endpoint กับคนละนามสกุลไฟล์
  const handleExportExecutive = async (format: 'excel' | 'csv') => {
    setExportingExecutive(format);
    try {
      const res = await api.get('/reports/executive-export', {
        params: { startDate, endDate, format },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `executive-summary_${startDate}_ถึง_${endDate}.${format === 'excel' ? 'xlsx' : 'csv'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);    } catch (err) { Swal.fire({ icon: 'error', title: 'Export ไม่สำเร็จ', text: getErrorMessage(err) }); } finally {
      setExportingExecutive(null);
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
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) });
    }
  };
  const fetchUsers = async () => { const res = await api.get('/users'); setUsers(res.data); };
  const fetchCategories = async () => { const res = await api.get('/categories'); setCategories(res.data); };
  const fetchSuppliers = async () => { const res = await api.get('/suppliers'); setSuppliers(res.data); };
  const fetchProducts = async () => { const res = await api.get('/products'); setProducts(res.data); };
  const fetchPromotions = async () => { const res = await api.get('/promotions'); setPromotions(res.data); };
  const fetchSalesHistory = async () => { try { const res = await api.get(`/sales/history?start_date=${startDate}&end_date=${endDate}`); setSalesHistory(res.data); } catch (error) { console.error(error); } };
  const fetchVendors = async () => { const res = await api.get('/users'); setVendors(res.data); };

  // ⭐️ effect หลัก — โหลดข้อมูลตามแท็บ + ฟัง socket realtime (ย้ายมาหลัง fetch functions ให้
  // react-hooks/immutability ไม่เห็นการอ้างอิงก่อนประกาศ — พฤติกรรมเหมือนเดิม)
  useEffect(() => {
    // IIFE + await: ให้กฎ set-state-in-effect มองว่า setState อยู่ใน async continuation
    // (กฎ trace เข้า function ที่ประกาศก่อน effect — ย้าย fetches ขึ้นมาเพื่อแก้ immutability แล้วต้อง wrap นี้ด้วย)
    void (async () => {
      await fetchStoreSettings();
      if (activeTab === 'HISTORY') await fetchSalesHistory();
      if (activeTab === 'USERS' && isAdmin) { await fetchUsers(); api.get('/member-groups').then(r => setMemberGroups(r.data || [])).catch(() => {}); }
      if (activeTab === 'CATEGORIES') await fetchCategories();
      if (activeTab === 'SUPPLIERS') await fetchSuppliers();
      if (activeTab === 'PRODUCTS') { await fetchProducts(); await fetchCategories(); }
      if (activeTab === 'PROMOTIONS') { await fetchPromotions(); await fetchProducts(); }
      if (activeTab === 'PASSWORD_RESETS' && isAdmin) await fetchPasswordResets();
      await fetchVendors();
    })();

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

  // ================= ⭐️ ระบบกรองข้อมูล (ค้นหา) =================
  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchProduct.toLowerCase()) || (p.barcode && p.barcode.includes(searchProduct)));
  const filteredCategories = categories.filter(c => c.name.toLowerCase().includes(searchCategory.toLowerCase()));
  const filteredSuppliers = suppliers.filter(s => s.name.toLowerCase().includes(searchSupplier.toLowerCase()) || (s.contact_info && s.contact_info.toLowerCase().includes(searchSupplier.toLowerCase())));
  const filteredUsers = users.filter(u => u.full_name.toLowerCase().includes(searchUser.toLowerCase()) || u.username.includes(searchUser) || u.role.toLowerCase().includes(searchUser.toLowerCase()));
  // ⭐️ MANAGER กับ MEMBER (สมัครผ่าน LINE LIFF ก็ตกมาที่ตารางนี้ด้วย — GET /api/users ไม่กรอง role
  // อยู่แล้ว) เดิมสีเทาเหมือนกันแยกไม่ออกจากป้ายข้อความล้วน — ให้แต่ละ role มีสีเฉพาะตัวชัดเจน
  const ROLE_BADGE: Record<string, { card: string; avatar: string; badge: string }> = {
    ADMIN: { card: 'border-fuchsia-200 bg-fuchsia-50/30', avatar: 'bg-fuchsia-600', badge: 'bg-fuchsia-100 text-fuchsia-600' },
    MANAGER: { card: 'border-indigo-200 bg-indigo-50/30', avatar: 'bg-indigo-500', badge: 'bg-indigo-100 text-indigo-600' },
    CASHIER: { card: 'border-brand-border', avatar: 'bg-brand', badge: 'bg-brand-bg text-brand' },
    MEMBER: { card: 'border-sky-200 bg-sky-50/30', avatar: 'bg-sky-500', badge: 'bg-sky-100 text-sky-600' },
  };
  const roleStyle = (role: string) => ROLE_BADGE[role] || { card: 'border-brand-border', avatar: 'bg-gray-400', badge: 'bg-gray-100 text-gray-500' };
  const filteredPromotions = promotions.filter(p => p.name.toLowerCase().includes(searchPromotion.toLowerCase()));
  const filteredVendors = vendors.filter(v => v.full_name.toLowerCase().includes(vendorSearch.toLowerCase()) || v.username.includes(vendorSearch));

  // ================= ACTION FUNCTIONS =================
  const handleViewBill = async (bill: SaleRow) => {
    try { const res = await api.get(`/sales/history/${bill.id}?source=${bill.source || 'POS'}`); setViewingBillItems(res.data); setViewingBillInfo(bill); }
    catch { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: 'ไม่สามารถดึงข้อมูลบิลได้' }); }
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
    } catch (err) { Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: getErrorMessage(err) }); }
  };

  
  // ⭐️ ฟังก์ชันแก้ไขสิทธิ์ผู้ใช้งาน (คืนเป็น MEMBER ได้)
  const handleEditUserRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return; // กัน null — โมดัลแก้ไขเปิดเมื่อมี editingUser เสมอ
    try {
      await api.put(`/users/${editingUser.id}`, {
        full_name: editingUser.full_name,
        student_id: editingUser.student_id ?? editingUser.username,
        phone_number: editingUser.phone_number,
        role: editingUser.role,
        points: editingUser.points,
        is_active: editingUser.is_active,
      });
      // ⭐️ Part 3 — บันทึกกลุ่มสมาชิกด้วย (endpoint แยก ADMIN+MANAGER)
      await api.put(`/users/${editingUser.id}/group`, { group_id: editingUser.group_id || null });
      fetchUsers(); setActiveModal(null); setEditingUser(null);
      Swal.fire({ icon: 'success', title: 'อัปเดตข้อมูลสำเร็จ', showConfirmButton: false, timer: 1500 });      } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
  };

  // ⭐️ ปลดผูก LINE รายบุคคล (ต่างจาก unlink-all ในเครื่องมือรีเซ็ต demo) — ปลดแล้วแก้ไข student_id ได้
  // ต่อทันทีในโมดัลเดิม (เคลียร์ line_user_id ใน editingUser local state ไม่ต้องปิด/เปิดโมดัลใหม่)
  const handleUnlinkLine = async (u: SettingsUser) => {
    const confirm = await Swal.fire({
      icon: 'warning', title: `ยกเลิกผูก LINE ของ "${u.full_name}"?`,
      text: 'สมาชิกจะต้องผูกบัญชี LINE ใหม่เองถึงจะ login/ดูบัตรสมาชิกผ่าน LINE ได้อีกครั้ง',
      showCancelButton: true, confirmButtonText: 'ยกเลิกผูก', cancelButtonText: 'ไม่ยกเลิก', confirmButtonColor: '#ef4444',
    });
    if (!confirm.isConfirmed) return;
    try {
      await api.put(`/users/${u.id}/unlink-line`);
      setEditingUser((prev: SettingsUser | null) => prev ? { ...prev, line_user_id: null } : prev);
      fetchUsers();
      Swal.fire({ icon: 'success', title: 'ปลดผูกบัญชี LINE แล้ว', showConfirmButton: false, timer: 1500 });      } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
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
      Swal.fire({ icon: 'success', title: 'สร้างโปรโมชั่นสำเร็จ', showConfirmButton: false, timer: 1500 });      } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/products', { ...newProduct, category_id: newProduct.category_id ? Number(newProduct.category_id) : null, price: Number(newProduct.price), cost: Number(newProduct.cost) || 0, stock: Number(newProduct.stock) || 0, vendor_id: newProduct.vendor_id ? Number(newProduct.vendor_id) : null, gp_rate: newProduct.gp_rate ? Number(newProduct.gp_rate) : 0, promo_percent: Number(newProduct.promo_percent) || 0, promo_start: newProduct.promo_start || null, promo_end: newProduct.promo_end || null, expiry_date: newProduct.expiry_date || null, discount_percent: Number(newProduct.discount_percent) || 40, is_reward_item: !!newProduct.is_reward_item, points_required: Number(newProduct.points_required) || 0 });
      setNewProduct({ barcode: '', name: '', category_id: '', price: '', cost: '', stock: '', image_url: '', vendor_id: '', gp_rate: '', promo_percent: '', promo_start: '', promo_end: '', expiry_date: '', discount_percent: '40', is_reward_item: false, points_required: '' });
      fetchProducts(); setActiveModal(null); setVendorSearch('');
      Swal.fire({ icon: 'success', title: 'เพิ่มสินค้าสำเร็จ', showConfirmButton: false, timer: 1500 });    } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
  };

  const handleEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return; // กัน null — โมดัลแก้ไขเปิดเมื่อมี editingProduct เสมอ
    try {
      await api.put(`/products/${editingProduct.id}`, { ...editingProduct, category_id: editingProduct.category_id ? Number(editingProduct.category_id) : null, price: Number(editingProduct.price), cost: Number(editingProduct.cost) || 0, vendor_id: editingProduct.vendor_id ? Number(editingProduct.vendor_id) : null, gp_rate: editingProduct.gp_rate ? Number(editingProduct.gp_rate) : 0, promo_percent: Number(editingProduct.promo_percent) || 0, promo_start: editingProduct.promo_start ? String(editingProduct.promo_start).slice(0, 10) : null, promo_end: editingProduct.promo_end ? String(editingProduct.promo_end).slice(0, 10) : null, expiry_date: editingProduct.expiry_date || null, discount_percent: Number(editingProduct.discount_percent) || 40, is_reward_item: !!editingProduct.is_reward_item, points_required: Number(editingProduct.points_required) || 0 });
      fetchProducts(); setActiveModal(null); setEditingProduct(null); setVendorSearch('');
      Swal.fire({ icon: 'success', title: 'แก้ไขสินค้าสำเร็จ!', showConfirmButton: false, timer: 1500 });      } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
  };

  const handleDeleteCategory = async (id: number) => { const res = await Swal.fire({ title: 'ลบหมวดหมู่นี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if (!res.isConfirmed) return; try { await api.delete(`/categories/${id}`); fetchCategories(); } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); } };
  const handleDeleteProduct = async (id: number) => { const res = await Swal.fire({ title: 'ลบสินค้านี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if (!res.isConfirmed) return; try { await api.delete(`/products/${id}`); fetchProducts(); } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); } };
  // ⭐️ ถ้าโปรโมชั่นเคยถูกใช้จริงมาแล้ว backend จะปิดใช้งานแทนลบถาวร (กันประวัติการใช้งานหาย) — ข้อความ
  // ตอบกลับต่างกันตามเคส (ดู DELETE /api/promotions/:id) โชว์ข้อความจาก backend ตรงๆ ให้ผู้ใช้รู้ว่าเกิดอะไรขึ้น
  const handleDeletePromotion = async (p: SettingsPromotion) => {
    const res = await Swal.fire({ title: `ลบโปรโมชั่น "${p.name}"?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' });
    if (!res.isConfirmed) return;
    try {
      const delRes = await api.delete(`/promotions/${p.id}`);
      fetchPromotions();
      Swal.fire({ icon: 'success', title: delRes.data.message, showConfirmButton: false, timer: 1800 });      } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
  };
  // ⭐️ ปุ่มลบราย user เป็น soft-delete (backend UPDATE is_active=FALSE ไม่ได้ลบจริง กันบิลเก่าพัง) —
  // ตั้งแต่เอา filter is_active ออก การ์ดจะไม่หายไปหลังกด ต้องบอกให้ชัดว่านี่คือ "ระงับการใช้งาน"
  // (การ์ดจะกลายเป็นสีเทา + badge ระงับแล้ว) ไม่ใช่ลบทิ้งถาวร
  const handleDeleteUser = async (id: number) => { const res = await Swal.fire({ title: 'ระงับการใช้งานพนักงานคนนี้?', text: 'บัญชีจะถูกปิดการใช้งาน (ไม่ได้ลบถาวร) — ประวัติบิล/ยอดขายเดิมยังอยู่ครบ', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ระงับการใช้งาน', cancelButtonText: 'ยกเลิก' }); if (!res.isConfirmed) return; try { await api.delete(`/users/${id}`); Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'ระงับการใช้งานแล้ว', showConfirmButton: false, timer: 2000 }); fetchUsers(); } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); } };

  // ⭐️ ปลดระงับ (unsuspend) — คืน is_active ให้ user ที่เคยถูกระงับ
  const handleReactivateUser = async (id: number) => {
    try {
      await api.put(`/users/${id}/reactivate`);
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'ปลดระงับแล้ว', showConfirmButton: false, timer: 2000 });
      fetchUsers();      } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); }
  };

  // ⭐️ Hard delete ราย user — ลบถาวรจริง ใช้ FK-cleanup เดียวกับ bulk delete ฝั่ง backend ถ้ามีประวัติ
  // การทำงาน staff จะตอบ needsConfirmation กลับมา ต้องเปิด popup ถามก่อนยิงซ้ำพร้อม deleteWorkHistory
  const handleHardDeleteUser = async (id: number, name: string) => {
    const confirm = await Swal.fire({
      title: 'ลบบัญชีนี้ถาวร?', html: `<b>${name}</b><br/>ลบถาวร กู้คืนไม่ได้ — ประวัติการขาย/ออเดอร์เดิมจะถูกตัดสาย (ไม่ผูกกับบัญชีนี้แล้ว) แต่ยังอยู่ในระบบ`, icon: 'warning',
      showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#9ca3af',
      confirmButtonText: 'ลบถาวร', cancelButtonText: 'ยกเลิก',
    });
    if (!confirm.isConfirmed) return;
    try {
      let r = await api.delete(`/users/${id}/permanent`);
      if (r.data?.needsConfirmation) {
        const choice = await Swal.fire({
          title: 'ผู้ใช้นี้มีประวัติการทำงาน',
          html: 'บัญชีนี้เคยเป็นพนักงานและมีประวัติการทำงาน (เข้า-ออกงาน/กะ/ตารางเวร) ติดอยู่<br/><br/>ต้องการลบประวัติการทำงานทิ้งไปด้วยเพื่อลบบัญชีถาวรหรือไม่?',
          icon: 'question', showCancelButton: true,
          confirmButtonText: 'ลบทั้งหมด (รวมประวัติการทำงาน)', confirmButtonColor: '#dc2626', cancelButtonText: 'ยกเลิก',
        });
        if (!choice.isConfirmed) return;
        r = await api.delete(`/users/${id}/permanent`, { data: { deleteWorkHistory: true } });
      }
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: r.data?.message || 'ลบบัญชีถาวรแล้ว', showConfirmButton: false, timer: 2500 });
      fetchUsers();
    } catch (err) { Swal.fire({ icon: 'error', title: 'ลบไม่สำเร็จ', text: getErrorMessage(err) }); }
  };

  // ⭐️ เครื่องมือล้างข้อมูลทดสอบ ADMIN — ยิงไป /api/admin/reset/* (backend บล็อกบน production เอง
  // ในตัว controller อยู่แล้ว ไม่ต้องเช็ค IS_PRODUCTION ฝั่งนี้ซ้ำ) confirm ก่อนทุกครั้งเพราะกู้คืนไม่ได้
  // (โดยเฉพาะ "ลบสมาชิก" ที่ DELETE ถาวร) รีเฟรชรายชื่อพนักงานหลังทำสำเร็จเพราะข้อมูลเปลี่ยนไปจริง
  const [resetLoading, setResetLoading] = useState<string | null>(null);
  const handleAdminReset = async (endpoint: string, confirmTitle: string, confirmText: string, loadingKey: string) => {
    const res = await Swal.fire({
      title: confirmTitle, text: confirmText, icon: 'warning',
      showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af',
      confirmButtonText: 'ยืนยัน ดำเนินการเลย', cancelButtonText: 'ยกเลิก',
    });
    if (!res.isConfirmed) return;
    setResetLoading(loadingKey);
    try {
      const r = await api.post(`/admin/reset/${endpoint}`);
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: r.data?.message || 'ดำเนินการสำเร็จ', showConfirmButton: false, timer: 2500 });
      fetchUsers();      } catch (err) {
      Swal.fire({ icon: 'error', title: 'ทำรายการไม่สำเร็จ', text: getErrorMessage(err) });
    } finally {
      setResetLoading(null);
    }
  };

  // ⭐️ ปุ่ม "ลบสมาชิก LINE ทั้งหมด" แยกจาก handleAdminReset ทั่วไป — backend เช็คก่อนว่ามีสมาชิกคนไหน
  // ติดประวัติการทำงาน staff (เข้า-ออกงาน/กะ/ตารางเวร) อยู่บ้าง (เกิดจากคนที่เคยเป็น staff แล้วถูกลด role
  // กลับเป็น MEMBER) ถ้ามีจะตอบ needsConfirmation กลับมาแทนที่จะลบเลย ต้องเปิด popup ถามอีกชั้นว่าจะ
  // "ลบประวัติการทำงานไปด้วย" หรือ "ข้ามคนเหล่านั้นไว้ก่อน" แล้วค่อยยิงซ้ำพร้อม flag ที่เลือก
  const handleDeleteMembers = async () => {
    const confirm = await Swal.fire({
      title: 'ลบสมาชิกที่สมัครผ่าน LINE ทั้งหมด?', text: 'ลบถาวร กู้คืนไม่ได้ — บัญชี role MEMBER ทั้งหมดจะถูกลบทิ้ง', icon: 'warning',
      showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af',
      confirmButtonText: 'ยืนยัน ดำเนินการเลย', cancelButtonText: 'ยกเลิก',
    });
    if (!confirm.isConfirmed) return;

    setResetLoading('members');
    try {
      let r = await api.post('/admin/reset/members', {});
      if (r.data?.needsConfirmation) {
        const names = (r.data.blockedMembers || []).map((m: SettingsUser) => m.full_name).join(', ');
        const choice = await Swal.fire({
          title: 'พบสมาชิกที่มีประวัติการทำงาน',
          html: `พบ ${r.data.blockedMembers?.length || 0} คนที่เคยเป็นพนักงานและมีประวัติการทำงาน (เข้า-ออกงาน/กะ/ตารางเวร) ติดอยู่:<br/><b>${names}</b><br/><br/>ต้องการลบประวัติการทำงานของพวกเขาไปด้วย หรือข้ามคนเหล่านี้ไว้ก่อน?`,
          icon: 'question',
          showDenyButton: true, showCancelButton: true,
          confirmButtonText: 'ลบทั้งหมด (รวมประวัติการทำงาน)', confirmButtonColor: '#dc2626',
          denyButtonText: 'ข้ามคนเหล่านี้ ลบที่เหลือ', denyButtonColor: '#f59e0b',
          cancelButtonText: 'ยกเลิก',
        });
        if (choice.isConfirmed) {
          r = await api.post('/admin/reset/members', { deleteWorkHistory: true });
        } else if (choice.isDenied) {
          r = await api.post('/admin/reset/members', { skipBlocked: true });
        } else {
          setResetLoading(null);
          return;
        }
      }
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: r.data?.message || 'ดำเนินการสำเร็จ', showConfirmButton: false, timer: 3000 });
      fetchUsers();      } catch (err) {
      Swal.fire({ icon: 'error', title: 'ทำรายการไม่สำเร็จ', text: getErrorMessage(err) });
    } finally {
      setResetLoading(null);
    }
  };

  // ⭐️ Phase 5 (presentation readiness) — ล้างสินค้า+หมวดหมู่+โปรโมชั่นทั้งหมดถาวร แล้วไปเรียก
  // GET /api/seed-data ต่อเองเพื่อใส่ข้อมูลตัวอย่าง (66 รายการ 5 หมวดหมู่) กลับเข้าไป
  // ⚠️ กว้างกว่า handleDeleteMembers — นี่คือ "ล้างชุดข้อมูลร้านทั้งหมด" (สินค้า/หมวดหมู่/โปร +
  // ประวัติการขาย/ออเดอร์/ใบสั่งซื้อของสินค้าที่ติดอยู่ ถ้าเลือกลบทั้งหมด) ไม่ใช่แค่ "ลบสินค้าขยะบางชิ้น"
  const handleResetProducts = async () => {
    const confirm = await Swal.fire({
      title: 'ล้างสินค้า+หมวดหมู่+โปรโมชั่นทั้งหมด?',
      html: 'ลบถาวร กู้คืนไม่ได้ — สินค้า/หมวดหมู่/โปรโมชั่น <b>ทั้งหมด</b> จะถูกลบทิ้ง<br/>(สินค้าที่มีประวัติการขาย/สั่งจอง/รับสินค้าจริงติดอยู่ จะถามเพิ่มอีกขั้นว่าจะจัดการอย่างไร)',
      icon: 'warning',
      showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af',
      confirmButtonText: 'ยืนยัน ดำเนินการเลย', cancelButtonText: 'ยกเลิก',
    });
    if (!confirm.isConfirmed) return;

    setResetLoading('products');
    try {
      let r = await api.post('/admin/reset/products', {});
      if (r.data?.needsConfirmation) {
        const names = (r.data.blockedProducts || []).map((p: SettingsProduct) => p.name).join(', ');
        const choice = await Swal.fire({
          title: 'พบสินค้าที่มีประวัติการขาย/สั่งจอง',
          html: `พบ ${r.data.blockedProducts?.length || 0} รายการที่มีประวัติการขาย/สั่งจอง/รับสินค้าจริงติดอยู่:<br/><b>${names}</b><br/><br/>ต้องการลบประวัติการขาย/ออเดอร์/ใบสั่งซื้อที่เกี่ยวข้องไปด้วย หรือข้ามสินค้าเหล่านี้ไว้ก่อน?`,
          icon: 'question',
          showDenyButton: true, showCancelButton: true,
          confirmButtonText: 'ลบทั้งหมด (รวมประวัติการขาย/ออเดอร์)', confirmButtonColor: '#dc2626',
          denyButtonText: 'ข้ามสินค้าเหล่านี้ ลบที่เหลือ', denyButtonColor: '#f59e0b',
          cancelButtonText: 'ยกเลิก',
        });
        if (choice.isConfirmed) {
          r = await api.post('/admin/reset/products', { deleteTransactionHistory: true });
        } else if (choice.isDenied) {
          r = await api.post('/admin/reset/products', { skipBlocked: true });
        } else {
          setResetLoading(null);
          return;
        }
      }
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: r.data?.message || 'ดำเนินการสำเร็จ', showConfirmButton: false, timer: 4000 });
      fetchProducts();
      fetchCategories();      } catch (err) {
      Swal.fire({ icon: 'error', title: 'ทำรายการไม่สำเร็จ', text: getErrorMessage(err) });
    } finally {
      setResetLoading(null);
    }
  };

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
      if (toCreate.length > 0) html += `<p class="font-bold text-green-700 mb-1">เพิ่มใหม่ ${toCreate.length} คน:</p><pre style="text-align:left;white-space:pre-wrap;font-size:12px;max-height:100px;overflow-y:auto;background:#f0fdf4;padding:8px;border-radius:8px;">${toCreate.map((u: SettingsUser) => `+ ${u.full_name} (${u.username})`).join('\n')}</pre>`;
      if (toReactivate.length > 0) html += `<p class="font-bold text-blue-700 mt-2 mb-1">เปิดใช้งานคืน ${toReactivate.length} คน:</p><pre style="text-align:left;white-space:pre-wrap;font-size:12px;max-height:100px;overflow-y:auto;background:#eff6ff;padding:8px;border-radius:8px;">${toReactivate.map((u: SettingsUser) => `↺ ${u.student_id}`).join('\n')}</pre>`;
      if (toRemove.length > 0) html += `<p class="font-bold text-red-700 mt-2 mb-1">ปิดการใช้งาน ${toRemove.length} คน:</p><pre style="text-align:left;white-space:pre-wrap;font-size:12px;max-height:100px;overflow-y:auto;background:#fef2f2;padding:8px;border-radius:8px;">${toRemove.map((u: SettingsUser) => `- ${u.full_name} (${u.username})`).join('\n')}</pre>`;
      if (toCreate.length === 0 && toReactivate.length === 0 && toRemove.length === 0) return Swal.fire({ icon: 'success', title: 'ข้อมูลตรงกันหมดแล้ว', text: 'ไม่มีการเปลี่ยนแปลง' });

      const confirm = await Swal.fire({
        icon: 'info', title: 'ตรวจสอบการเปลี่ยนแปลง', html,
        showCancelButton: true, confirmButtonColor: BRAND, cancelButtonColor: '#9ca3af',
        confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก'
      });
      if (!confirm.isConfirmed) return;

      const result = await api.post('/users/sync-csv', { rows, dry_run: false });
      Swal.fire({ icon: 'success', title: result.data.message, showConfirmButton: false, timer: 2500 });
      fetchUsers();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) });
    }
  };
  const handleDeleteSupplier = async (id: number) => { const res = await Swal.fire({ title: 'ลบซัพพลายเออร์นี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#9ca3af', confirmButtonText: 'ลบเลย', cancelButtonText: 'ยกเลิก' }); if (!res.isConfirmed) return; try { await api.delete(`/suppliers/${id}`); fetchSuppliers(); } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err) }); } };

  return (
    <div className="min-h-screen bg-brand-bg font-sans relative pb-20 md:pb-6">

      {/* ⭐️ แถบหัวหน้ามาตรฐานเดียวกับทุกหน้า (PageHeader) */}
      <div className="max-w-7xl mx-auto">
        <PageHeader icon={SettingsIcon} title="แผงควบคุม (Admin)" subtitle="จัดการข้อมูลหลักในระบบ" />

        <div className="p-4 md:p-6">
          <div className="flex flex-col xl:flex-row gap-6">

        {/* Sidebar Tabs */}
        <div className="w-full xl:w-64 flex flex-row xl:flex-col gap-2 shrink-0 overflow-x-auto pb-2 xl:pb-0 scrollbar-hide snap-x">
          <TabButton icon={<Store size={18} />} label="ร้านค้า" isActive={activeTab === 'STORE'} onClick={() => setActiveTab('STORE')} />
          <TabButton icon={<History size={18} />} label="ประวัติขาย" isActive={activeTab === 'HISTORY'} onClick={() => setActiveTab('HISTORY')} />
          <TabButton icon={<Package size={18} />} label="สินค้า" isActive={activeTab === 'PRODUCTS'} onClick={() => setActiveTab('PRODUCTS')} />
          <TabButton icon={<Tags size={18} />} label="หมวดหมู่" isActive={activeTab === 'CATEGORIES'} onClick={() => setActiveTab('CATEGORIES')} />
          <TabButton icon={<Truck size={18} />} label="ซัพพลายเออร์" isActive={activeTab === 'SUPPLIERS'} onClick={() => setActiveTab('SUPPLIERS')} />
          <TabButton icon={<Gift size={18} />} label="โปรโมชั่น" isActive={activeTab === 'PROMOTIONS'} onClick={() => setActiveTab('PROMOTIONS')} />
          <TabButton icon={<Coins size={18} />} label="ราคา & แต้มสะสม" isActive={activeTab === 'LOYALTY'} onClick={() => setActiveTab('LOYALTY')} />
          {/* ⭐️ แท็บด้านล่างนี้สงวนไว้เฉพาะ ADMIN — MANAGER ไม่เห็น */}
          {isAdmin && <TabButton icon={<Users size={18} />} label="พนักงาน/สิทธิ์" isActive={activeTab === 'USERS'} onClick={() => setActiveTab('USERS')} />}
          {isAdmin && <TabButton icon={<UsersRound size={18} />} label="กลุ่มสมาชิก" isActive={activeTab === 'GROUPS'} onClick={() => setActiveTab('GROUPS')} />}
          {isAdmin && <TabButton icon={<KeyRound size={18} />} label="รีเซ็ตรหัสผ่าน" isActive={activeTab === 'PASSWORD_RESETS'} onClick={() => setActiveTab('PASSWORD_RESETS')} badge={passwordResets.length || undefined} />}
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-white rounded-3xl shadow-md border border-brand-border p-4 md:p-8 min-h-[500px] relative overflow-hidden">

          {/* TAB 1: ร้านค้า */}
          {activeTab === 'STORE' && (
            <form onSubmit={handleSaveStore} className="space-y-4 animate-fade-in max-w-2xl">
              <h2 className="text-lg md:text-xl font-bold mb-4 flex items-center gap-2"><Store className="text-brand" /> ข้อมูลร้านค้า</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="ชื่อร้าน" value={storeInfo.store_name} onChange={(v) => setStoreInfo({ ...storeInfo, store_name: v })} />
                <Input label="เลขผู้เสียภาษี" value={storeInfo.tax_id || ''} required={false} onChange={(v) => setStoreInfo({ ...storeInfo, tax_id: v })} />
              </div>
              <Input label="ที่อยู่" value={storeInfo.address || ''} required={false} onChange={(v) => setStoreInfo({ ...storeInfo, address: v })} />
              <Input label="ข้อความท้ายใบเสร็จ" value={storeInfo.receipt_footer || ''} required={false} onChange={(v) => setStoreInfo({ ...storeInfo, receipt_footer: v })} />
              <Button type="submit" size="lg" className="w-full md:w-auto mt-4"><Save size={20} /> บันทึกข้อมูล</Button>
            </form>
          )}

          {/* TAB 2: ประวัติการขาย */}
          {activeTab === 'HISTORY' && (
            <div className="animate-fade-in flex flex-col h-full">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><History className="text-brand" /> ประวัติการขาย</h2>
                <div className="flex flex-wrap items-center gap-2 bg-brand-bg p-2 rounded-xl border border-brand-border w-full lg:w-auto justify-between lg:justify-start">
                  <div className="flex items-center gap-2">
                    <Calendar size={18} className="text-gray-500" />
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent outline-none text-xs md:text-sm font-bold text-gray-700 w-28 md:w-auto" />
                    <span className="text-gray-400">-</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent outline-none text-xs md:text-sm font-bold text-gray-700 w-28 md:w-auto" />
                  </div>
                  <Button size="sm" onClick={fetchSalesHistory} className="w-full mt-2 lg:mt-0 lg:w-auto">ค้นหา</Button>
                </div>
              </div>

              {/* ⭐️ Export — เดิมต้องเลือกระดับความละเอียด (รายชิ้น/รายบิล/สรุปรายวัน) แล้วโหลดทีละไฟล์
                  3 รอบ ตอนนี้รวมทั้ง 3 ระดับไว้ไฟล์เดียวเสมอ (Excel = 3 ชีท, CSV = 3 ส่วนคั่นด้วย
                  หัวข้อ) เลือกแค่ format ที่จะเปิด — ไปเปิดใน Excel/Google Sheets คำนวณต่อได้ */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4 bg-white border border-brand-border rounded-xl p-2.5">
                <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5 px-1"><Download size={14} className="text-brand" /> ส่งออกข้อมูล (ช่วงวันที่ที่เลือกด้านบน — รวมรายชิ้น/รายบิล/สรุปรายวัน)</span>
                <div className="flex gap-2 sm:ml-auto">
                  <button
                    onClick={() => handleExportCsv('excel')}
                    disabled={!!exporting}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <Download size={15} /> {exporting === 'excel' ? 'กำลังสร้างไฟล์...' : 'Export Excel'}
                  </button>
                  <button
                    onClick={() => handleExportCsv('csv')}
                    disabled={!!exporting}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <Download size={15} /> {exporting === 'csv' ? 'กำลังสร้างไฟล์...' : 'Export CSV'}
                  </button>
                </div>
              </div>

              {/* ⭐️ Phase 4 Part 2 — Executive Summary: KPI/สินค้าขายดี/หมวดหมู่/คลังสินค้า
                  ในไฟล์ Excel 2 ชีท (หรือ CSV เฉพาะรายการธุรกรรม) ใช้ช่วงวันที่เดียวกันด้านบน */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4 bg-white border border-brand-border rounded-xl p-2.5">
                <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5 px-1">
                  <FileSpreadsheet size={14} className="text-brand" /> รายงานสรุปผู้บริหาร (Executive Summary)
                </span>
                <div className="flex gap-2 sm:ml-auto">
                  <button
                    onClick={() => handleExportExecutive('excel')}
                    disabled={exportingExecutive !== null}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-1.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <FileSpreadsheet size={15} /> {exportingExecutive === 'excel' ? 'กำลังสร้างไฟล์...' : 'Export Excel'}
                  </button>
                  <button
                    onClick={() => handleExportExecutive('csv')}
                    disabled={exportingExecutive !== null}
                    className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-1.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <Download size={15} /> {exportingExecutive === 'csv' ? 'กำลังสร้างไฟล์...' : 'Export CSV'}
                  </button>
                </div>
              </div>
              {/* ⭐️ FIX: เดิม table มีแค่ hidden md:block ไม่มี mobile fallback เลย — บนมือถือหน้านี้ว่างเปล่า
                  ไม่เห็นประวัติการขายเลย เพิ่ม card list สำหรับ mobile (< md) ตรงนี้ */}
              <div className="md:hidden space-y-3">
                {salesHistory.length === 0 ? (
                  <EmptyState compact icon={<History size={22} />} title="ไม่พบข้อมูลการขาย" />
                ) : salesHistory.map(bill => (
                  <div key={`m-${bill.source || 'POS'}-${bill.id}`} className="bg-white border border-brand-border rounded-xl p-3.5 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-bold text-gray-800">#{bill.id}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{new Date(bill.created_at ?? '').toLocaleString('th-TH')}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {bill.source === 'PREORDER' ? <span className="text-blue-600 font-bold text-[10px] bg-blue-50 px-2 py-0.5 rounded">จอง</span> : <span className="text-gray-500 font-bold text-[10px] bg-gray-100 px-2 py-0.5 rounded">หน้าร้าน</span>}
                        {bill.status === 'VOIDED' ? <span className="text-red-500 font-bold text-[10px] bg-red-50 px-2 py-0.5 rounded">ยกเลิกแล้ว</span> : <span className="text-green-500 font-bold text-[10px] bg-green-50 px-2 py-0.5 rounded">สำเร็จ</span>}
                      </div>
                    </div>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs text-gray-500">{bill.cashier_name}</span>
                      <span className="font-bold text-brand text-lg">฿{Number(bill.total_amount).toFixed(2)}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleViewBill(bill)} className="flex-1 text-brand bg-brand-bg hover:bg-brand-border active:scale-95 py-2 rounded-lg transition text-sm font-bold flex items-center justify-center gap-1.5"><Eye size={16} /> ดูรายการ</button>
                      {bill.source !== 'PREORDER' && bill.status !== 'VOIDED' && (
                        <button onClick={() => handleVoidBill(bill.id)} className="flex-1 text-red-600 bg-red-50 hover:bg-red-100 active:scale-95 py-2 rounded-lg transition text-sm font-bold flex items-center justify-center gap-1.5"><Trash2 size={16} /> ยกเลิก</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block overflow-x-auto border border-brand-border rounded-xl">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 text-gray-600 text-xs"><tr><th className="p-3 border-b">บิล</th><th className="p-3 border-b">ประเภท</th><th className="p-3 border-b">เวลา</th><th className="p-3 border-b">ยอดรวม</th><th className="p-3 border-b">ลูกค้า/แคชเชียร์</th><th className="p-3 border-b text-center">สถานะ</th><th className="p-3 border-b text-center">จัดการ</th></tr></thead>
                  <tbody>
                    {salesHistory.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-gray-400">ไม่พบข้อมูลการขาย</td></tr> : salesHistory.map(bill => (
                        <tr key={`${bill.source || 'POS'}-${bill.id}`} className="border-b hover:bg-brand-bg">
                          <td className="p-3 font-bold">#{bill.id}</td>
                          <td className="p-3">{bill.source === 'PREORDER' ? <span className="text-blue-600 font-bold text-xs bg-blue-50 px-2 py-1 rounded">จอง</span> : <span className="text-gray-500 font-bold text-xs bg-gray-100 px-2 py-1 rounded">หน้าร้าน</span>}</td>
                          <td className="p-3 text-sm text-gray-600">{new Date(bill.created_at ?? '').toLocaleString('th-TH')}</td><td className="p-3 font-bold text-brand">฿{Number(bill.total_amount).toFixed(2)}</td><td className="p-3 text-sm text-gray-600">{bill.cashier_name}</td>
                          <td className="p-3 text-center">{bill.status === 'VOIDED' ? <span className="text-red-500 font-bold text-xs bg-red-50 px-2 py-1 rounded">ยกเลิกแล้ว</span> : <span className="text-green-500 font-bold text-xs bg-green-50 px-2 py-1 rounded">สำเร็จ</span>}</td>
                          <td className="p-3 text-center flex justify-center gap-2">
                            <button onClick={() => handleViewBill(bill)} className="text-brand bg-brand-bg hover:bg-brand-border p-2 rounded-lg transition"><Eye size={18} /></button>
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
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Package className="text-brand" /> สินค้าในระบบ</h2>
                <div className="flex w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-64">
                    <input type="text" placeholder="ค้นหาสินค้า..." value={searchProduct} onChange={e => setSearchProduct(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-brand-border rounded-full focus:ring-2 focus:ring-brand focus:bg-white outline-none text-sm font-medium transition-colors duration-150" />
                    <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                  </div>
                  <ExportImportButtons entity="products" onImportDone={fetchProducts} />
                  <Button onClick={() => { setActiveModal('ADD_PRODUCT'); setVendorSearch(''); }} className="shrink-0"><Plus size={18} /> <span className="hidden sm:inline">เพิ่มสินค้า</span></Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProducts.map(p => (
                  <div key={p.id} className="bg-white p-4 md:p-5 rounded-3xl shadow-sm border border-brand-border relative group">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-12 h-12 bg-brand-bg rounded-lg overflow-hidden shrink-0 border border-brand-border flex items-center justify-center">
                        {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <Package size={20} className="text-gray-300" />}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-gray-800 line-clamp-1 text-sm">{p.name}</p>
                        <p className="text-xs text-gray-400">บาร์โค้ด: {p.barcode || '-'}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-end mt-2">
                      <span className="text-xl md:text-2xl font-bold text-brand">฿{Number(p.price).toFixed(2)}</span>
                      <span className="text-xs font-medium text-gray-500 bg-brand-bg px-2 py-1 rounded-md">สต๊อก: {p.stock}</span>
                    </div>
                    <div className="absolute top-3 right-3 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition bg-white p-1 rounded-lg shadow-sm border border-brand-border md:border-0 md:shadow-none">
                      <button onClick={() => { setEditingProduct(p); setActiveModal('EDIT_PRODUCT'); setVendorSearch(''); }} className="text-brand-mid hover:text-brand-dark hover:bg-brand-bg p-1.5 rounded-md transition" title="แก้ไขสินค้า"><Edit size={16} /></button>
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
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Tags className="text-brand" /> หมวดหมู่สินค้า</h2>
                <div className="flex w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-64">
                    <input type="text" placeholder="ค้นหาหมวดหมู่..." value={searchCategory} onChange={e => setSearchCategory(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-brand-border rounded-full focus:ring-2 focus:ring-brand focus:bg-white outline-none text-sm font-medium transition-colors duration-150" />
                    <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                  </div>
                  <ExportImportButtons entity="categories" onImportDone={fetchCategories} />
                  <Button onClick={() => setActiveModal('ADD_CATEGORY')} className="shrink-0"><Plus size={18} /> <span className="hidden sm:inline">เพิ่มหมวดหมู่</span></Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {filteredCategories.map(c => (
                  <div key={c.id} className="bg-white p-4 rounded-xl border border-brand-border flex justify-between items-center group shadow-sm">
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
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Truck className="text-brand" /> ซัพพลายเออร์</h2>
                <div className="flex w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-64">
                    <input type="text" placeholder="ค้นหาชื่อ, เบอร์ติดต่อ..." value={searchSupplier} onChange={e => setSearchSupplier(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-brand-border rounded-full focus:ring-2 focus:ring-brand focus:bg-white outline-none text-sm font-medium transition-colors duration-150" />
                    <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                  </div>
                  <ExportImportButtons entity="suppliers" onImportDone={fetchSuppliers} />
                  <Button onClick={() => setActiveModal('ADD_SUPPLIER')} className="shrink-0"><Plus size={18} /> <span className="hidden sm:inline">เพิ่มบริษัท</span></Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredSuppliers.map(s => (
                  <div key={s.id} className="bg-white p-4 md:p-5 rounded-3xl shadow-sm border border-brand-border flex justify-between items-center group relative">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 bg-brand-bg rounded-xl flex items-center justify-center text-brand"><Truck size={20} /></div>
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
          {activeTab === 'USERS' && isAdmin && (
            <div className="animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Users className="text-brand" /> สมาชิกและผู้ใช้งานในระบบทั้งหมด</h2>
                <div className="flex w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-64">
                    <input type="text" placeholder="ค้นหาชื่อ, รหัสนักศึกษา..." value={searchUser} onChange={e => setSearchUser(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-brand-border rounded-full focus:ring-2 focus:ring-brand focus:bg-white outline-none text-sm font-medium transition-colors duration-150" />
                    <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                  </div>
                  {/* ⭐️ Export ข้อมูลพนักงาน/สมาชิกออกไปแก้ (import กลับใช้ปุ่ม "ซิงค์รายชื่อจาก CSV" ด้านล่าง
                      ซึ่งเป็นเครื่องมือเทียบรายชื่อ create/reactivate/deactivate อยู่แล้ว ไม่ทำซ้ำ) */}
                  <ExportImportButtons entity="users" onImportDone={fetchUsers} showImport={false} />
                  {/* ⭐️ ซิงค์รายชื่อจาก CSV */}
                  <label className="shrink-0 bg-white border border-brand-border text-brand px-4 py-2 rounded-xl font-bold hover:bg-brand-bg flex justify-center items-center gap-2 transition cursor-pointer">
                    <Upload size={18} /> <span className="hidden sm:inline">นำเข้า CSV</span>
                    <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
                  </label>
                  {/* ปุ่มเปลี่ยนชื่อจาก เพิ่มพนักงาน เป็น แต่งตั้งสิทธิ์ */}
                  <Button onClick={() => setActiveModal('ADD_USER')} className="shrink-0"><Plus size={18} /> <span className="hidden sm:inline">แต่งตั้งสิทธิ์</span></Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredUsers.map(u => {
                  const rs = roleStyle(u.role);
                  // ⭐️ soft-deleted (is_active=0) — เทาการ์ดทั้งใบ + badge ระงับแล้ว ให้เห็นชัดว่าถูกระงับ ไม่ใช่หาย
                  const inactive = u.is_active === 0 || u.is_active === false;
                  return (
                  <div key={u.id} className={`bg-white p-4 md:p-5 rounded-3xl shadow-sm border flex flex-col group relative ${rs.card} ${inactive ? 'opacity-60 grayscale' : ''}`}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-10 h-10 md:w-12 md:h-12 shrink-0 rounded-full flex items-center justify-center font-bold text-white shadow-inner text-lg relative ${inactive ? 'bg-gray-400' : rs.avatar}`}>
                        {u.full_name.charAt(0)}
                        {u.line_user_id && (
                          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#06C755] border-2 border-white flex items-center justify-center" title="ผูกบัญชี LINE แล้ว">
                            <span className="text-white text-[8px] font-black">L</span>
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 line-clamp-1 text-sm md:text-base">{u.full_name}</p>
                        <p className="text-xs text-gray-400">@{u.username}{u.phone_number ? ` · ${u.phone_number}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-end mt-auto">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-1 rounded-md text-[10px] md:text-xs font-bold ${rs.badge}`}>{u.role}</span>
                        {inactive && <span className="px-2 py-1 rounded-md text-[10px] md:text-xs font-bold bg-gray-200 text-gray-500">ระงับแล้ว</span>}
                      </div>
                      <span className="text-xs md:text-sm font-bold text-brand">{Number(u.points || 0).toLocaleString()} แต้ม</span>
                    </div>

                    {/* ⭐️ ปุ่มจัดการ — active: แก้ไข + ระงับ | inactive: ปลดระงับ + ลบถาวร */}
                    <div className="absolute top-3 right-3 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition bg-white p-1 rounded-lg shadow-sm border border-brand-border md:border-0 md:shadow-none">
                      <button onClick={() => { setEditingUser(u); setActiveModal('EDIT_USER'); }} className="text-brand-mid hover:text-brand-dark hover:bg-brand-bg p-1.5 rounded-md transition" title="✏️ แก้ไข">
                        <Edit size={16} />
                      </button>
                      {inactive ? (
                        <>
                          <button onClick={() => handleReactivateUser(u.id)} className="text-green-500 hover:text-green-700 hover:bg-green-50 p-1.5 rounded-md transition" title="ปลดระงับ">
                            <UserCheck size={16} />
                          </button>
                          <button onClick={() => handleHardDeleteUser(u.id, u.full_name)} className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-md transition" title="ลบบัญชีถาวร">
                            <UserX size={16} />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => handleDeleteUser(u.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition" title="ระงับการใช้งาน">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* ⭐️ Developer & Testing Tools — โชว์เฉพาะ ADMIN (อยู่ใน block activeTab === 'USERS' && isAdmin
                  อยู่แล้ว) เครื่องมือล้างข้อมูลทดสอบ กดพลาดกู้คืนไม่ได้บางปุ่ม (โดยเฉพาะลบสมาชิก) จึงเน้นสีแดง/ส้ม
                  ชัดเจน + confirm ทุกปุ่ม ฝั่ง backend เองก็บล็อกทั้งชุดถ้า NODE_ENV=production */}
              <div className="mt-8 bg-red-50 border-2 border-red-200 rounded-3xl p-4 md:p-5">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle size={20} className="text-red-500" />
                  <h3 className="text-base md:text-lg font-bold text-red-700">เครื่องมือสำหรับผู้ดูแลระบบ (Developer & Testing Tools)</h3>
                </div>
                <p className="text-xs text-red-500 mb-4">ใช้สำหรับเทสต์ระบบเท่านั้น การกระทำเหล่านี้กู้คืนไม่ได้ — ปิดใช้งานอัตโนมัติบน production</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <button
                    onClick={() => handleAdminReset('unlink-line', 'ปลดผูกบัญชี LINE ทั้งหมด?', 'สมาชิกทุกคนจะต้องสแกน/ผูกบัญชี LINE ใหม่ผ่าน LIFF', 'unlink-line')}
                    disabled={resetLoading === 'unlink-line'}
                    className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold py-3 rounded-2xl transition-all duration-150 active:scale-[0.98] disabled:opacity-50"
                  >
                    <RotateCcw size={16} className={resetLoading === 'unlink-line' ? 'animate-spin' : ''} /> ปลดผูกบัญชี LINE ทั้งหมด
                  </button>
                  <button
                    onClick={handleDeleteMembers}
                    disabled={resetLoading === 'members'}
                    className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold py-3 rounded-2xl transition-all duration-150 active:scale-[0.98] disabled:opacity-50"
                  >
                    <Trash2 size={16} className={resetLoading === 'members' ? 'animate-spin' : ''} /> ลบสมาชิก LINE ทั้งหมด
                  </button>
                  <button
                    onClick={() => handleAdminReset('member-points', 'รีเซ็ตแต้มสะสมทั้งหมดเป็น 0?', 'แต้มของทุกบัญชีในระบบจะถูกล้างเป็น 0 ทันที', 'member-points')}
                    disabled={resetLoading === 'member-points'}
                    className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold py-3 rounded-2xl transition-all duration-150 active:scale-[0.98] disabled:opacity-50"
                  >
                    <Coins size={16} className={resetLoading === 'member-points' ? 'animate-spin' : ''} /> รีเซ็ตแต้มสะสมทั้งหมด
                  </button>
                  {/* ⭐️ Phase 5 — ล้างสินค้า+หมวดหมู่+โปรโมชั่นทั้งหมด (กว้างกว่าปุ่มอื่น: อาจรวมประวัติการขาย/
                      ออเดอร์/ใบสั่งซื้อของสินค้าที่ติดอยู่ด้วย ถ้าเลือก "ลบทั้งหมด" ในขั้นยืนยันที่สอง) */}
                  <button
                    onClick={handleResetProducts}
                    disabled={resetLoading === 'products'}
                    className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold py-3 rounded-2xl transition-all duration-150 active:scale-[0.98] disabled:opacity-50"
                  >
                    <Package size={16} className={resetLoading === 'products' ? 'animate-spin' : ''} /> ล้างสินค้า+หมวดหมู่ทั้งหมด
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: โปรโมชั่น (ใหม่!) */}
          {activeTab === 'PROMOTIONS' && (
            <div className="animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><Gift className="text-brand" /> โปรโมชั่น / ส่วนลด</h2>
                <div className="flex w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-64">
                    <input type="text" placeholder="ค้นหาชื่อโปรโมชั่น..." value={searchPromotion} onChange={e => setSearchPromotion(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-brand-border rounded-full focus:ring-2 focus:ring-brand focus:bg-white outline-none text-sm font-medium transition-colors duration-150" />
                    <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                  </div>
                  <Button onClick={() => setActiveModal('ADD_PROMOTION')} className="shrink-0"><Plus size={18} /> <span className="hidden sm:inline">สร้างโปรโมชั่น</span></Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPromotions.map(p => (
                  <div key={p.id} className="bg-white p-4 rounded-3xl shadow-sm border border-brand-border flex flex-col gap-2 relative">
                    <div className="flex justify-between items-start">
                      <h3 className="font-bold text-gray-800">{p.name}</h3>
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-1 rounded-md text-[10px] font-bold ${p.is_active ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>{p.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
                        <button onClick={() => handleDeletePromotion(p)} title="ลบโปรโมชั่น" className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-md transition-colors duration-150"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-brand mt-2">
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
                {filteredPromotions.length === 0 && (
                  <div className="col-span-full">
                    <EmptyState compact icon={<Tags size={22} />} title="ไม่พบข้อมูลโปรโมชั่น" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ⭐️ TAB: ราคา & แต้มสะสม (Part 2) */}
          {activeTab === 'LOYALTY' && <LoyaltySettingsPanel />}

          {/* ⭐️ TAB: กลุ่มสมาชิก (Part 3) */}
          {activeTab === 'GROUPS' && isAdmin && <MemberGroupsPanel />}

          {/* TAB 8: คิวคำขอรีเซ็ตรหัสผ่าน — ⭐️ FIX: ระบบยังไม่ต่อ SMS/อีเมลจริง ADMIN ต้องคัดลอกลิงก์ไปส่งให้นักเรียนเอง */}
          {activeTab === 'PASSWORD_RESETS' && isAdmin && (
            <div className="animate-fade-in">
              <div className="mb-6">
                <h2 className="text-lg md:text-xl font-bold flex items-center gap-2"><KeyRound className="text-brand" /> คำขอรีเซ็ตรหัสผ่าน</h2>
                <p className="text-xs md:text-sm text-gray-500 mt-1">ระบบยังไม่ได้ต่อ SMS/อีเมลจริง — เมื่อนักเรียนขอรีเซ็ตรหัสผ่าน คำขอจะมาค้างที่นี่ ให้กด "คัดลอกลิงก์" แล้วส่งให้นักเรียนเอง (เช่น ทาง LINE) หลังยืนยันตัวตนแล้ว ลิงก์หมดอายุใน 1 ชั่วโมง</p>
              </div>

              {passwordResets.length === 0 ? (
                <EmptyState compact icon={<KeyRound size={22} />} title="ไม่มีคำขอรีเซ็ตรหัสผ่านที่ค้างอยู่" />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {passwordResets.map(r => (
                    <div key={r.id} className="bg-white p-4 rounded-3xl shadow-sm border border-brand-border flex flex-col gap-3">
                      <div>
                        <p className="font-bold text-gray-800">{r.full_name}</p>
                        <p className="text-xs text-gray-400">รหัสนักศึกษา {r.student_id}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Phone size={13} className="text-gray-400 shrink-0" /> {r.phone_number || '-'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Clock size={13} className="text-gray-400 shrink-0" /> หมดอายุ {new Date(r.expires_at ?? '').toLocaleString('th-TH')}
                      </div>
                      <div className="flex gap-2 mt-auto pt-2">
                        <Button className="flex-1" onClick={() => handleCopyResetLink(r.reset_token ?? '')}><Copy size={15} /> คัดลอกลิงก์</Button>
                        <Button variant="outline-danger" onClick={() => handleRejectPasswordReset(r.id)} aria-label="ปิด"><X size={15} /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
        </div>
      </div>

      {/* ================= MODALS ================= */}

      {/* ⭐️ MODAL แก้ไขสินค้า */}
      {activeModal === 'EDIT_PRODUCT' && editingProduct && (
        <CustomModal title="แก้ไขข้อมูลสินค้า" onClose={() => { setActiveModal(null); setEditingProduct(null); setVendorSearch(''); }}>
          <form onSubmit={handleEditProduct} className="space-y-3 md:space-y-4">
            <Input label="ชื่อสินค้า" value={editingProduct.name} onChange={(v) => setEditingProduct({ ...editingProduct, name: v })} />
            <Input label="บาร์โค้ด (ถ้ามี)" value={editingProduct.barcode || ''} required={false} onChange={(v) => setEditingProduct({ ...editingProduct, barcode: v })} />

            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">หมวดหมู่</label>
              <select className="w-full p-2.5 md:p-3 border border-brand-border rounded-full outline-none focus:ring-2 focus:ring-brand text-sm md:text-base font-medium" value={editingProduct.category_id || ''} onChange={e => setEditingProduct({ ...editingProduct, category_id: e.target.value ? Number(e.target.value) : null })}>
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
                    onChange={e => setEditingProduct({ ...editingProduct, vendor_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">-- สินค้าของสหกรณ์ (ไม่หัก GP) --</option>
                    {filteredVendors.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>)}
                  </select>
                </div>
                <Input label="GP ส่วนแบ่งสหกรณ์ (%)" type="number" value={editingProduct.gp_rate || ''} required={false} onChange={(v) => setEditingProduct({ ...editingProduct, gp_rate: v })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="ต้นทุน/ชิ้น (฿)" type="number" value={editingProduct.cost ?? ''} required={false} onChange={(v) => setEditingProduct({ ...editingProduct, cost: v })} />
              <Input label="ราคาขาย (฿)" type="number" value={editingProduct.price} onChange={(v) => setEditingProduct({ ...editingProduct, price: v })} />
            </div>
            <Input label="สต๊อกปัจจุบัน" type="number" value={editingProduct.stock} disabled={true} required={false} onChange={() => { }} />

            <Input label="URL รูปภาพ (ถ้ามี)" value={editingProduct.image_url || ''} required={false} onChange={(v) => setEditingProduct({ ...editingProduct, image_url: v })} />

            {/* ⭐️ Phase 1 — โปรโมชั่นช่วงวันที่ (ลด % เฉพาะช่วง ใช้ทั้ง POS + จอง) */}
            <div className="bg-brand-bg border border-brand-mid rounded-xl p-3 space-y-3">
              <p className="text-xs font-bold text-brand">🏷️ โปรโมชั่นช่วงวันที่ (ลดเฉพาะช่วง)</p>
              <Input label="ลดราคา % ช่วงโปร" type="number" min="0" max="100" value={editingProduct.promo_percent || ''} required={false} onChange={(v) => setEditingProduct({ ...editingProduct, promo_percent: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="เริ่มโปร" type="date" value={editingProduct.promo_start ? String(editingProduct.promo_start).slice(0, 10) : ''} required={false} onChange={(v) => setEditingProduct({ ...editingProduct, promo_start: v })} />
                <Input label="สิ้นสุดโปร" type="date" value={editingProduct.promo_end ? String(editingProduct.promo_end).slice(0, 10) : ''} required={false} onChange={(v) => setEditingProduct({ ...editingProduct, promo_end: v })} />
              </div>
              {editingProduct.vendor_id && <p className="text-[11px] text-amber-600">⚠️ สินค้าฝากขาย — ควรคุยกับเจ้าของสินค้าก่อนตั้งโปร (ส่วนลดหักตามสัดส่วน เจ้าของได้น้อยลงด้วย)</p>}
            </div>

            {/* ⭐️ Sprint 2 — Expiry Discount: expiry_date + discount_percent */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 space-y-3">
              <p className="text-xs font-bold text-yellow-800">วันหมดอายุและส่วนลด</p>
              {/* 🐛 FIX — เดิมไม่ตัด .slice(0,10) เหมือน promo_start/promo_end ด้านบน ถ้า backend ส่ง
                  expiry_date มาเป็น ISO string เต็ม (มีเวลาต่อท้าย) input type="date" จะโชว์ "ว่าง"
                  เงียบๆ (เป็นกฎ HTML — ไม่ error) ทั้งที่ข้อมูลจริงมีอยู่ ทำให้แอดมินเข้าใจผิดว่าวันหมดอายุหาย */}
              <Input
                label="วันหมดอายุ (ถ้ามี)"
                type="date"
                value={editingProduct.expiry_date ? String(editingProduct.expiry_date).slice(0, 10) : ''}
                required={false}
                onChange={(v) => setEditingProduct({ ...editingProduct, expiry_date: v })}
              />
              <Input
                label="ลดราคา % (ใกล้หมดอายุ)"
                type="number"
                min="0"
                max="100"
                value={editingProduct.discount_percent || 40}
                required={false}
                onChange={(v) => setEditingProduct({ ...editingProduct, discount_percent: v })}
              />
            </div>

            {/* ⭐️ Part 4 — สินค้าแลกของรางวัลด้วยแต้ม */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-3">
              <label className="flex items-center gap-2 text-xs font-bold text-amber-800 cursor-pointer">
                <input type="checkbox" checked={!!editingProduct.is_reward_item} onChange={e => setEditingProduct({ ...editingProduct, is_reward_item: e.target.checked })} className="w-4 h-4 accent-brand" />
                🎁 ตั้งเป็นสินค้าแลกของรางวัล
              </label>
              {editingProduct.is_reward_item && (
                <Input label="ใช้กี่แต้มในการแลก" type="number" min="0" value={editingProduct.points_required || ''} required={false} onChange={(v) => setEditingProduct({ ...editingProduct, points_required: v })} />
              )}
            </div>

            <Button type="submit" className="w-full mt-2">บันทึกการแก้ไข</Button>
          </form>
        </CustomModal>
      )}

      {/* ⭐️ MODAL เพิ่มสินค้า */}
      {activeModal === 'ADD_PRODUCT' && (
        <CustomModal title="เพิ่มสินค้าใหม่" onClose={() => { setActiveModal(null); setVendorSearch(''); }}>
          <form onSubmit={handleAddProduct} className="space-y-3 md:space-y-4">
            <Input label="ชื่อสินค้า" value={newProduct.name} onChange={(v) => setNewProduct({ ...newProduct, name: v })} />
            
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
                <Input label="GP ส่วนแบ่งสหกรณ์ (%)" type="number" value={newProduct.gp_rate || ''} required={false} onChange={(v) => setNewProduct({ ...newProduct, gp_rate: v })} />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Input label="ต้นทุน/ชิ้น (฿)" type="number" value={newProduct.cost} required={false} onChange={(v) => setNewProduct({ ...newProduct, cost: v })} />
              <Input label="ราคาขาย (฿)" type="number" value={newProduct.price} onChange={(v) => setNewProduct({ ...newProduct, price: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="สต๊อกตั้งต้น" type="number" value={newProduct.stock} required={false} onChange={(v) => setNewProduct({ ...newProduct, stock: v })} />
            </div>
            <Input label="URL รูปภาพ (ถ้ามี)" value={newProduct.image_url} required={false} onChange={(v) => setNewProduct({ ...newProduct, image_url: v })} />

            {/* ⭐️ Phase 1 — โปรโมชั่นช่วงวันที่ */}
            <div className="bg-brand-bg border border-brand-mid rounded-xl p-3 space-y-3">
              <p className="text-xs font-bold text-brand">🏷️ โปรโมชั่นช่วงวันที่ (ลดเฉพาะช่วง)</p>
              <Input label="ลดราคา % ช่วงโปร" type="number" min="0" max="100" value={newProduct.promo_percent} required={false} onChange={(v) => setNewProduct({ ...newProduct, promo_percent: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="เริ่มโปร" type="date" value={newProduct.promo_start} required={false} onChange={(v) => setNewProduct({ ...newProduct, promo_start: v })} />
                <Input label="สิ้นสุดโปร" type="date" value={newProduct.promo_end} required={false} onChange={(v) => setNewProduct({ ...newProduct, promo_end: v })} />
              </div>
              {newProduct.vendor_id && <p className="text-[11px] text-amber-600">⚠️ สินค้าฝากขาย — ควรคุยกับเจ้าของสินค้าก่อนตั้งโปร (ส่วนลดหักตามสัดส่วน เจ้าของได้น้อยลงด้วย)</p>}
            </div>

            {/* ⭐️ Sprint 2 — Expiry Discount: expiry_date + discount_percent */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 space-y-3">
              <p className="text-xs font-bold text-yellow-800">วันหมดอายุและส่วนลด (ถ้ามี)</p>
              <Input
                label="วันหมดอายุ (ถ้ามี)"
                type="date"
                value={newProduct.expiry_date ? String(newProduct.expiry_date).slice(0, 10) : ''}
                required={false}
                onChange={(v) => setNewProduct({ ...newProduct, expiry_date: v })}
              />
              <Input
                label="ลดราคา % (ใกล้หมดอายุ)"
                type="number"
                min="0"
                max="100"
                value={newProduct.discount_percent || 40}
                required={false}
                onChange={(v) => setNewProduct({ ...newProduct, discount_percent: v })}
              />
            </div>

            {/* ⭐️ Part 4 — สินค้าแลกของรางวัลด้วยแต้ม */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-3">
              <label className="flex items-center gap-2 text-xs font-bold text-amber-800 cursor-pointer">
                <input type="checkbox" checked={!!newProduct.is_reward_item} onChange={e => setNewProduct({ ...newProduct, is_reward_item: e.target.checked })} className="w-4 h-4 accent-brand" />
                🎁 ตั้งเป็นสินค้าแลกของรางวัล
              </label>
              {newProduct.is_reward_item && (
                <Input label="ใช้กี่แต้มในการแลก" type="number" min="0" value={newProduct.points_required || ''} required={false} onChange={(v) => setNewProduct({ ...newProduct, points_required: v })} />
              )}
            </div>

            <Button type="submit" className="w-full mt-2">บันทึกสินค้าใหม่</Button>
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
            } catch (err) { Swal.fire({ icon: 'error', text: getErrorMessage(err, 'ไม่พบรหัสนักศึกษานี้') }); }
          }} className="space-y-4">
            <Input label="รหัสนักศึกษาที่ต้องการจัดการ" value={newUser.username} onChange={(v) => setNewUser({ ...newUser, username: v })} />
            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">เลือกบทบาท (Role)</label>
              <select className="w-full p-2.5 md:p-3 border border-brand-border rounded-full outline-none focus:ring-2 focus:ring-brand text-sm md:text-base font-medium" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                <option value="MEMBER">นักศึกษาทั่วไป (MEMBER)</option>
                <option value="CASHIER">แคชเชียร์ (CASHIER)</option>
                <option value="MANAGER">ผู้จัดการร้าน (MANAGER)</option>
                <option value="ADMIN">ผู้ดูแลระบบ (ADMIN)</option>
              </select>
            </div>
            <Button type="submit" className="w-full mt-2">ยืนยัน</Button>
          </form>
        </CustomModal>
      )}

      {/* ⭐️ MODAL เปลี่ยนสิทธิ์พนักงานตรงๆ จากหน้าการ์ด */}
      {activeModal === 'EDIT_USER' && editingUser && (
        <CustomModal title="แก้ไขข้อมูลผู้ใช้งาน" onClose={() => { setActiveModal(null); setEditingUser(null); }}>
          <form onSubmit={handleEditUserRole} className="space-y-4">
            <Input label="ชื่อ-นามสกุล" value={editingUser.full_name} onChange={(v) => setEditingUser({ ...editingUser, full_name: v })} />
            <div>
              {/* ⭐️ ผูก LINE แล้ว = ล็อกรหัสนักศึกษา (สมัครผ่าน LIFF ผูก student_id คู่กับ line_user_id
                  ไว้แน่นตั้งแต่แรก แก้ตรงนี้จะทำให้บัตรสมาชิก/QR ที่แคชเชียร์สแกนไม่ตรงตัวจริงเจ้าของ LINE
                  อีกต่อไป — backend เองก็ล็อกด้วย ดู PUT /api/users/:id — ต้องปลดผูก LINE ก่อนถึงจะแก้ได้) */}
              <Input label="รหัสนักศึกษา" value={editingUser.student_id ?? editingUser.username}
                onChange={(v) => setEditingUser({ ...editingUser, student_id: v })}
                disabled={!!editingUser.line_user_id} />
              {editingUser.line_user_id && (
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <p className="text-[11px] text-gray-400">🔒 ผูกบัญชี LINE แล้ว แก้รหัสนี้ไม่ได้ (ปลดผูกก่อนถ้าต้องแก้)</p>
                  <button type="button" onClick={() => handleUnlinkLine(editingUser)}
                    className="shrink-0 text-[11px] font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors duration-150">
                    ยกเลิกผูก LINE
                  </button>
                </div>
              )}
            </div>
            <Input label="เบอร์โทรศัพท์" value={editingUser.phone_number || ''} onChange={(v) => setEditingUser({ ...editingUser, phone_number: v })} required={false} />
            <Input label="แต้มสะสม" type="number" value={editingUser.points ?? 0} onChange={(v) => setEditingUser({ ...editingUser, points: v === '' ? 0 : Number(v) })} required={false} />
            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">เลือกบทบาทใหม่ (Role)</label>
              <select className="w-full p-2.5 md:p-3 border border-brand-border rounded-full outline-none focus:ring-2 focus:ring-brand text-sm md:text-base font-medium" value={editingUser.role} onChange={e => setEditingUser({ ...editingUser, role: e.target.value })}>
                <option value="MEMBER">ลดขั้นเป็นนักศึกษาทั่วไป (MEMBER)</option>
                <option value="CASHIER">แคชเชียร์ (CASHIER)</option>
                <option value="MANAGER">ผู้จัดการร้าน (MANAGER)</option>
                <option value="ADMIN">ผู้ดูแลระบบ (ADMIN)</option>
              </select>
            </div>
            {/* ⭐️ Part 3 — กำหนดกลุ่มสมาชิก (ส่วนลดอัตโนมัติ) */}
            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">กลุ่มสมาชิก (ส่วนลดอัตโนมัติ)</label>
              <select className="w-full p-2.5 md:p-3 border border-brand-border rounded-full outline-none focus:ring-2 focus:ring-brand text-sm md:text-base font-medium" value={editingUser.group_id || ''} onChange={e => setEditingUser({ ...editingUser, group_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— ไม่กำหนดกลุ่ม —</option>
                {memberGroups.map((g: MemberGroup) => <option key={g.id} value={g.id}>{g.name} (ลด {Number(g.default_discount_percent)}%)</option>)}
              </select>
            </div>
            <Button type="submit" className="w-full mt-2">บันทึกสิทธิ์</Button>
          </form>
        </CustomModal>
      )}

      {/* ⭐️ MODAL สร้างโปรโมชั่น (ใหม่!) */}
      {activeModal === 'ADD_PROMOTION' && (
        <CustomModal title="สร้างโปรโมชั่นใหม่" onClose={() => setActiveModal(null)}>
          <form onSubmit={handleAddPromotion} className="space-y-4">
            <Input label="ชื่อโปรโมชั่น" value={newPromotion.name} onChange={(v) => setNewPromotion({...newPromotion, name: v})} />
            <div>
              <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">ประเภทส่วนลด</label>
              <select className="w-full p-2.5 border border-brand-border rounded-full outline-none focus:ring-2 focus:ring-brand text-sm font-medium" value={newPromotion.discount_type} onChange={e => setNewPromotion({...newPromotion, discount_type: e.target.value})}>
                <option value="PERCENT">ลดเป็นเปอร์เซ็นต์ (%)</option>
                <option value="FIXED">ลดเป็นจำนวนเงิน (฿)</option>
                <option value="BOGO">ซื้อครบแถม (เช่น ซื้อ 1 แถม 1, ซื้อ 2 แถม 1)</option>
              </select>
            </div>

            {newPromotion.discount_type !== 'BOGO' ? (
              <Input label="มูลค่าส่วนลด" type="number" value={newPromotion.discount_value} onChange={(v) => setNewPromotion({...newPromotion, discount_value: v})} />
            ) : (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel size="xs" className="!text-blue-800 !font-bold">สินค้าที่ต้องซื้อ</FieldLabel>
                    <select className="w-full p-2 border border-blue-200 rounded-lg outline-none text-sm" value={newPromotion.buy_product_id} onChange={e => setNewPromotion({...newPromotion, buy_product_id: e.target.value})}>
                      <option value="">-- เลือกสินค้า --</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <Input label="ซื้อครบ (ชิ้น)" type="number" value={newPromotion.buy_qty} onChange={(v) => setNewPromotion({...newPromotion, buy_qty: v})} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel size="xs" className="!text-blue-800 !font-bold">สินค้าที่แถม</FieldLabel>
                    <select className="w-full p-2 border border-blue-200 rounded-lg outline-none text-sm" value={newPromotion.free_product_id} onChange={e => setNewPromotion({...newPromotion, free_product_id: e.target.value})}>
                      <option value="">-- เลือกสินค้า --</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <Input label="แถม (ชิ้น)" type="number" value={newPromotion.free_qty} onChange={(v) => setNewPromotion({...newPromotion, free_qty: v})} />
                </div>
                <p className="text-[11px] text-blue-700">* สินค้าที่แถมต้องอยู่ในตะกร้าจริง ระบบจะคิดส่วนลดเท่ากับราคาสินค้าที่แถมเท่านั้น</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Input label="วันเริ่มต้น (เว้นได้)" type="date" required={false} value={newPromotion.start_date} onChange={(v) => setNewPromotion({...newPromotion, start_date: v})} />
              <Input label="วันหมดเขต (เว้นได้)" type="date" required={false} value={newPromotion.end_date} onChange={(v) => setNewPromotion({...newPromotion, end_date: v})} />
            </div>

            <div className="pt-3 border-t border-brand-border">
              <p className="text-xs font-bold text-gray-600 mb-2">จำกัดสิทธิ์การใช้ (เว้นว่าง = ไม่จำกัด)</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="ใช้ได้รวมกี่ครั้ง" type="number" required={false} value={newPromotion.usage_limit} onChange={(v) => setNewPromotion({...newPromotion, usage_limit: v})} />
                <Input label="ใช้ได้กี่ครั้ง/คน" type="number" required={false} value={newPromotion.usage_limit_per_user} onChange={(v) => setNewPromotion({...newPromotion, usage_limit_per_user: v})} />
              </div>
            </div>

            <Button type="submit" className="w-full mt-2">บันทึกโปรโมชั่น</Button>
          </form>
        </CustomModal>
      )}

      {/* Modals ยิบย่อยอื่นๆ */}
      {viewingBillItems && viewingBillInfo && (
        <CustomModal title={`บิล #${viewingBillInfo.id}`} onClose={() => { setViewingBillItems(null); setViewingBillInfo(null); }}>
          <p className="text-gray-500 text-xs md:text-sm mb-4">{new Date(viewingBillInfo.created_at ?? '').toLocaleString('th-TH')}</p>
          <div className="overflow-y-auto max-h-60 mb-4 border border-brand-border rounded-lg">
            <table className="w-full text-left text-xs md:text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs sticky top-0"><tr><th className="p-2 border-b">สินค้า</th><th className="p-2 border-b text-center">จำนวน</th><th className="p-2 border-b text-right">รวม</th></tr></thead>
              <tbody>
                {viewingBillItems.map((item, idx) => (
                  <tr key={idx} className="border-b last:border-0"><td className="p-2 font-bold text-gray-800">{item.product_name}</td><td className="p-2 text-center">{item.quantity}</td><td className="p-2 text-right font-bold text-brand">฿{Number(item.subtotal).toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center p-4 bg-brand-bg rounded-xl mb-4 border border-brand-border">
            <span className="font-bold text-brand-dark text-sm">ยอดรวมทั้งสิ้น</span><span className="text-xl md:text-2xl font-bold text-brand">฿{Number(viewingBillInfo.total_amount).toFixed(2)}</span>
          </div>
          {viewingBillInfo.status !== 'VOIDED' && (
            <Button variant="danger" size="lg" className="w-full" onClick={() => handleVoidBill(viewingBillInfo.id)}><Trash2 size={18} /> ยกเลิกบิล (Void)</Button>
          )}
        </CustomModal>
      )}
      {activeModal === 'ADD_CATEGORY' && (<CustomModal title="เพิ่มหมวดหมู่" onClose={() => setActiveModal(null)}><form onSubmit={handleAddCategory} className="space-y-4"><Input label="ชื่อหมวดหมู่" value={newCategory} onChange={setNewCategory} /><Button type="submit" className="w-full mt-2">เพิ่มหมวดหมู่</Button></form></CustomModal>)}
      {activeModal === 'ADD_SUPPLIER' && (<CustomModal title="เพิ่มตัวแทนจำหน่าย" onClose={() => setActiveModal(null)}><form onSubmit={handleAddSupplier} className="space-y-4"><Input label="ชื่อบริษัท / บุคคล" value={newSupplier.name} onChange={(v) => setNewSupplier({ ...newSupplier, name: v })} /><Input label="ข้อมูลติดต่อ" value={newSupplier.contact_info} required={false} onChange={(v) => setNewSupplier({ ...newSupplier, contact_info: v })} /><Button type="submit" className="w-full mt-2">บันทึกข้อมูล</Button></form></CustomModal>)}
      
      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; } .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
    </div>
  );
}

const TabButton = ({ icon, label, isActive, onClick, badge }: { icon: React.ReactNode; label: string; isActive: boolean; onClick: () => void; badge?: React.ReactNode }) => (
  <Button onClick={onClick} variant={isActive ? 'primary' : 'secondary'} className="shrink-0 snap-start">
    {icon} <span className="whitespace-nowrap">{label}</span>
    {!!badge && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isActive ? 'bg-white/25 text-white' : 'bg-brand-bg text-brand'}`}>{badge}</span>}
  </Button>
);

// ⭐️ Export/Import CSV+Excel ใช้ร่วมกัน 4 แท็บ (สินค้า/หมวดหมู่/ซัพพลายเออร์/พนักงาน) — ดึงออกไปแก้ไข
// นอกระบบ (Excel/Google Sheets) แล้วนำเข้ากลับ backend endpoint คู่กันของแต่ละ entity (ดู server.js:
// GET /api/<entity>/export, POST /api/<entity>/import — users ใช้ /api/members/import ของเดิม)
function ExportImportButtons({ entity, onImportDone, showImport = true }: { entity: 'products' | 'categories' | 'suppliers' | 'users'; onImportDone: () => void; showImport?: boolean }) {
  const [busy, setBusy] = useState<'excel' | 'csv' | 'import' | null>(null);
  const fileInputId = `import-file-${entity}`;

  const handleExport = async (format: 'excel' | 'csv') => {
    setBusy(format);
    try {
      const res = await api.get(`/${entity}/export`, { params: { format }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entity}-export.${format === 'excel' ? 'xlsx' : 'csv'}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);    } catch (err) { Swal.fire({ icon: 'error', title: 'Export ไม่สำเร็จ', text: getErrorMessage(err) }); } finally { setBusy(null); }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // กันเลือกไฟล์เดิมซ้ำแล้วไม่ trigger onChange
    if (!file) return;
    setBusy('import');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post(entity === 'users' ? '/members/import' : `/${entity}/import`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      Swal.fire({ icon: 'success', title: res.data.message, showConfirmButton: false, timer: 2500 });
      onImportDone();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'นำเข้าไม่สำเร็จ', text: getErrorMessage(err) });
    } finally { setBusy(null); }
  };

  return (
    <div className="flex gap-1.5 shrink-0">
      <Button variant="secondary" size="sm" className="p-2" type="button" onClick={() => handleExport('excel')} disabled={!!busy} title="ส่งออก Excel">
        <FileSpreadsheet size={16} />
      </Button>
      <Button variant="secondary" size="sm" className="p-2" type="button" onClick={() => handleExport('csv')} disabled={!!busy} title="ส่งออก CSV">
        <Download size={16} />
      </Button>
      {showImport && (
        <label htmlFor={fileInputId} title="นำเข้า CSV (แก้ไข/เพิ่มจากไฟล์)"
          className={`p-2 bg-white border border-brand-border text-gray-500 rounded-xl hover:bg-brand-bg active:scale-95 transition-all duration-150 cursor-pointer flex items-center justify-center ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
          <Upload size={16} />
          <input id={fileInputId} type="file" accept=".csv,text/csv" onChange={handleImport} className="hidden" />
        </label>
      )}
    </div>
  );
}

const Input = ({ label, value, onChange, type = "text", required = true, disabled = false, min, max }: {
  label: string;
  value?: string | number;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
}) => (
  <div>
    <FieldLabel size="sm">{label}</FieldLabel>
    <input type={type} required={required} disabled={disabled} min={min} max={max} value={value} onChange={e => onChange(e.target.value)} className={`w-full p-2.5 md:p-3 border border-brand-border rounded-full focus:ring-2 focus:ring-brand outline-none transition-colors duration-150 text-sm md:text-base font-medium ${disabled ? 'bg-brand-bg text-gray-400 cursor-not-allowed' : ''}`} />
  </div>
);

const CustomModal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <Modal title={title} onClose={onClose}>
    <div className="p-5 pb-12 md:pb-5">
      {children}
    </div>
  </Modal>
);