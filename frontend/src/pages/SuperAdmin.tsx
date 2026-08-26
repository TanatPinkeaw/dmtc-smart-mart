// 📄 pages/SuperAdmin.tsx — หน้าควบคุมหลักสำหรับผู้ดูแลระบบ (ADMIN เท่านั้น)
//    ทำอะไร: ดูรายการร้านค้า (tenants) ทั้งหมด + สถิติรวม + สร้างร้านใหม่ (provision DB)
//    + ดูรายละเอียด/ผู้ใช้ของแต่ละร้าน + เปิด/ปิดใช้งานร้าน
//    หมายเหตุ: ไฟล์เดิมโดนตัดครึ่งตอนเขียน (JSX ไม่ปิด) ทำให้ build พัง — เขียนใหม่ให้สมบูรณ์
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Package,
  ShoppingCart,
  DollarSign,
  Plus,
  Search,
  Eye,
  Power,
  PowerOff,
  Store,
  ChevronRight,
  X,
  Check,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { formatBangkokTime } from '../utils/timezone';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';

// ── Types ──────────────────────────────────────────────────────────────
interface Tenant {
  id: number;
  shop_name: string;
  db_name: string;
  admin_username: string;
  plan: string;
  max_users: number;
  max_products: number;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
  user_count?: number;
  product_count?: number;
  order_count?: number;
  total_revenue?: number;
}

interface TenantUser {
  id: number;
  student_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

interface TenantDetail extends Tenant {
  stats?: {
    users: number;
    products: number;
    orders: number;
    revenue: number;
  };
  users?: TenantUser[];
}

type ViewMode = 'list' | 'detail';

const PLAN_OPTIONS = [
  { value: 'free', label: 'Free (5 users, 500 products)' },
  { value: 'basic', label: 'Basic (10 users, 1,000 products)' },
  { value: 'pro', label: 'Pro (20 users, 2,000 products)' },
  { value: 'enterprise', label: 'Enterprise (ไม่จำกัด)' },
];

export default function SuperAdmin() {
  const user = getCurrentUserOrRedirect();
  const [view, setView] = useState<ViewMode>('list');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ shop_name: '', admin_username: '', admin_password: '', plan: 'free' });

  // ⭐️ ประกาศฟังก์ชัน fetch ก่อน useEffect ที่เรียกมัน (กัน "accessed before declaration")
  const fetchTenants = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/dashboard');
      setTenants(res.data?.tenants || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ⭐️ โหลดรายการร้านค้าครั้งแรกตอน mount — hook ทุกตัวต้องถูกเรียก "ก่อน" return แบบมีเงื่อนไข
  //   เสมอ (Rules of Hooks) เดิม useEffect ถูกวางหลังเช็คสิทธิ์ ทำให้ eslint react-hooks/rules-of-hooks
  //   ฟ้อง "useEffect is called conditionally" และ fetchTenants ถูกเรียกก่อนประกาศ
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchTenants();
  }, []);

  // 🔒 เฉพาะ ADMIN เท่านั้น (เช็คหลัง hooks ทั้งหมดแล้ว — ลำดับการเรียก hook จะเหมือนกันทุก render)
  if (user.role !== 'ADMIN') {
    return (
      <div className="bg-brand-bg min-h-screen">
        <PageHeader icon={LayoutDashboard} title="Super Admin" />
        <EmptyState icon={<LayoutDashboard size={28} />} title="ไม่มีสิทธิ์เข้าถึงหน้านี้" className="m-6" />
      </div>
    );
  }

  const fetchTenantDetail = async (id: number) => {
    try {
      const res = await api.get(`/admin/dashboard/tenant/${id}`);
      setSelectedTenant(res.data);
      setView('detail');
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'ดึงข้อมูลไม่สำเร็จ', text: getErrorMessage(err) });
    }
  };

  const handleCreateTenant = async () => {
    if (!createForm.shop_name.trim() || !createForm.admin_username.trim() || !createForm.admin_password.trim()) {
      return Swal.fire({ icon: 'warning', title: 'กรุณากรอกข้อมูลให้ครบ', text: 'ชื่อร้าน, username และ password จำเป็น' });
    }
    setCreating(true);
    try {
      await api.post('/admin/dashboard/create', createForm);
      setShowCreateModal(false);
      setCreateForm({ shop_name: '', admin_username: '', admin_password: '', plan: 'free' });
      await fetchTenants();
      Swal.fire({ icon: 'success', title: 'สร้างร้านค้าสำเร็จ!' });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'สร้างไม่สำเร็จ', text: getErrorMessage(err) });
    } finally {
      setCreating(false);
    }
  };

  const handleToggleTenant = async (tenant: Tenant) => {
    const action = tenant.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน';
    const confirm = await Swal.fire({
      title: `${action} "${tenant.shop_name}"?`,
      text: tenant.is_active ? 'ผู้ใช้ของร้านนี้จะเข้าสู่ระบบไม่ได้ชั่วคราว' : 'ร้านค้าจะกลับมาใช้งานได้ตามปกติ',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: action,
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: tenant.is_active ? '#ef4444' : '#10b981',
    });
    if (!confirm.isConfirmed) return;
    try {
      await api.put(`/admin/dashboard/tenant/${tenant.id}/toggle`);
      await fetchTenants();
      Swal.fire({ icon: 'success', title: `${action}สำเร็จ`, timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'ดำเนินการไม่สำเร็จ', text: getErrorMessage(err) });
    }
  };

  const handleDeleteTenant = async (tenant: Tenant) => {
    const confirm = await Swal.fire({
      title: `ลบร้าน "${tenant.shop_name}"?`,
      text: 'ร้านจะถูกซ่อนจากรายการและปิดใช้งานทันที (ข้อมูลใน database ยังเก็บไว้ — soft delete)',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'ลบร้านค้า',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#ef4444',
    });
    if (!confirm.isConfirmed) return;
    try {
      await api.delete(`/admin/dashboard/tenant/${tenant.id}`);
      await fetchTenants();
      Swal.fire({ icon: 'success', title: 'ลบร้านค้าสำเร็จ', timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'ลบไม่สำเร็จ', text: getErrorMessage(err) });
    }
  };

  const planBadge = (plan: string) => {
    switch (plan) {
      case 'enterprise': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'pro': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'basic': return 'bg-green-100 text-green-700 border-green-200';
      default: return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const filteredTenants = tenants.filter(t =>
    t.shop_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.db_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalUsers = tenants.reduce((sum, t) => sum + (t.user_count || 0), 0);
  const totalProducts = tenants.reduce((sum, t) => sum + (t.product_count || 0), 0);
  const totalRevenue = tenants.reduce((sum, t) => sum + (t.total_revenue || 0), 0);

  // ══════════════════════════════════════════════════════════════════
  //  DETAIL VIEW — รายละเอียดร้านค้าแต่ละร้าน
  // ══════════════════════════════════════════════════════════════════
  if (view === 'detail' && selectedTenant) {
    const stats = selectedTenant.stats;
    return (
      <div className="bg-brand-bg min-h-screen pb-24">
        <PageHeader
          icon={Store}
          title={selectedTenant.shop_name}
          subtitle={selectedTenant.db_name}
          onBack={() => { setView('list'); setSelectedTenant(null); }}
        />
        <div className="max-w-7xl mx-auto p-4 md:p-6">

          {/* สถิติร้าน */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-brand-border">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center shrink-0"><Users size={20} className="text-blue-600" /></div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900 truncate">{stats?.users ?? selectedTenant.user_count ?? 0}<span className="text-sm text-gray-400">/{selectedTenant.max_users}</span></p>
                  <p className="text-xs text-gray-500">ผู้ใช้</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-brand-border">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-purple-100 rounded-xl flex items-center justify-center shrink-0"><Package size={20} className="text-purple-600" /></div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900 truncate">{stats?.products ?? selectedTenant.product_count ?? 0}<span className="text-sm text-gray-400">/{selectedTenant.max_products}</span></p>
                  <p className="text-xs text-gray-500">สินค้า</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-brand-border">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-amber-100 rounded-xl flex items-center justify-center shrink-0"><ShoppingCart size={20} className="text-amber-600" /></div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900 truncate">{stats?.orders ?? selectedTenant.order_count ?? 0}</p>
                  <p className="text-xs text-gray-500">ออเดอร์</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-brand-border">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-green-100 rounded-xl flex items-center justify-center shrink-0"><DollarSign size={20} className="text-green-600" /></div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900 truncate">฿{Number(stats?.revenue ?? selectedTenant.total_revenue ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-gray-500">รายได้รวม</p>
                </div>
              </div>
            </div>
          </div>

          {/* ข้อมูลทั่วไป */}
          <div className="bg-white rounded-2xl shadow-sm border border-brand-border p-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-xs text-gray-500 mb-0.5">Plan</p><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold border ${planBadge(selectedTenant.plan)}`}>{selectedTenant.plan}</span></div>
            <div><p className="text-xs text-gray-500 mb-0.5">Admin username</p><p className="font-bold text-gray-800">{selectedTenant.admin_username}</p></div>
            <div><p className="text-xs text-gray-500 mb-0.5">สร้างเมื่อ</p><p className="font-bold text-gray-800">{formatBangkokTime(selectedTenant.created_at)}</p></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">สถานะ</p>
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${selectedTenant.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                {selectedTenant.is_active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
              </span>
            </div>
          </div>

          {/* ตารางผู้ใช้ */}
          <div className="bg-white rounded-2xl shadow-sm border border-brand-border overflow-hidden">
            <div className="p-4 border-b border-brand-border flex items-center justify-between">
              <h3 className="font-bold text-gray-800">ผู้ใช้ในระบบ ({selectedTenant.users?.length || 0})</h3>
              <Button variant="secondary" size="sm" onClick={() => void fetchTenantDetail(selectedTenant.id)}>
                <RefreshCw size={14} /> รีเฟรช
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="p-3 border-b">Username</th>
                    <th className="p-3 border-b">ชื่อ</th>
                    <th className="p-3 border-b">บทบาท</th>
                    <th className="p-3 border-b">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedTenant.users || []).map(u => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-brand-bg">
                      <td className="p-3 font-bold text-gray-800">{u.student_id}</td>
                      <td className="p-3 text-sm text-gray-600">{u.full_name}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : u.role === 'MANAGER' ? 'bg-indigo-100 text-indigo-700' : u.role === 'CASHIER' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{u.role}</span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{u.is_active ? 'Active' : 'Inactive'}</span>
                      </td>
                    </tr>
                  ))}
                  {(selectedTenant.users || []).length === 0 && (
                    <tr><td colSpan={4} className="p-6 text-center text-gray-400 text-sm">ไม่มีผู้ใช้ในระบบ</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  //  LIST VIEW — รายการร้านค้าทั้งหมด
  // ══════════════════════════════════════════════════════════════════
  return (
    <div className="bg-brand-bg min-h-screen pb-24">
      <PageHeader icon={LayoutDashboard} title="Super Admin" subtitle="ควบคุม POS ทุกร้าน" />

      <div className="max-w-7xl mx-auto p-4 md:p-6">

        {/* การ์ดสรุปรวม */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-brand-border">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25 shrink-0"><Store size={20} className="text-white" /></div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-gray-900">{tenants.length}</p>
                <p className="text-xs text-gray-500">ร้านค้าทั้งหมด</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-brand-border">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/25 shrink-0"><Users size={20} className="text-white" /></div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-gray-900">{totalUsers}</p>
                <p className="text-xs text-gray-500">ผู้ใช้ทั้งหมด</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-brand-border">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/25 shrink-0"><Package size={20} className="text-white" /></div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-gray-900">{totalProducts}</p>
                <p className="text-xs text-gray-500">สินค้าทั้งหมด</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-brand-border">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/25 shrink-0"><DollarSign size={20} className="text-white" /></div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-gray-900">฿{Number(totalRevenue).toLocaleString()}</p>
                <p className="text-xs text-gray-500">รายได้รวม</p>
              </div>
            </div>
          </div>
        </div>

        {/* ช่องค้นหา + ปุ่มสร้าง */}
        <div className="bg-white rounded-2xl shadow-sm border border-brand-border p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="ค้นหาชื่อร้าน หรือชื่อ database..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-brand-bg rounded-full border border-brand-border outline-none focus:ring-2 focus:ring-brand text-sm font-medium"
              />
            </div>
            <Button variant="primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={18} /> เพิ่มร้านค้าใหม่
            </Button>
          </div>
        </div>

        {/* รายการร้านค้า */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="bg-white rounded-2xl h-20 shadow-sm animate-pulse" />)}
          </div>
        ) : filteredTenants.length === 0 ? (
          <EmptyState
            icon={<Store size={28} />}
            title={searchTerm ? 'ไม่พบร้านค้าที่ค้นหา' : 'ยังไม่มีร้านค้า — กด "เพิ่มร้านค้าใหม่" เพื่อเริ่มต้น'}
            className="bg-white border border-brand-border rounded-2xl"
          />
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-brand-border overflow-hidden">
            <div className="divide-y divide-brand-border">
              {filteredTenants.map(tenant => {
                // ⭐️ badge class แยกตัวแปร — literal gradient ต้องไม่อยู่ในแท็กปุ่ม (กฎ uiConsistencyContract)
                const badgeCls = tenant.is_active ? 'bg-gradient-to-br from-brand to-brand-dark' : 'bg-gray-300';
                return (
                <div key={tenant.id} className="p-4 hover:bg-brand-bg transition-colors duration-150">
                  <div className="flex items-center justify-between gap-3">
                    <button onClick={() => void fetchTenantDetail(tenant.id)} className="flex items-center gap-3 min-w-0 text-left flex-1">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${badgeCls}`}>
                        <Store size={20} className="text-white" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-gray-900 truncate">{tenant.shop_name}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${planBadge(tenant.plan)}`}>{tenant.plan}</span>
                          {!tenant.is_active && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600 border border-red-200">ปิดใช้งาน</span>}
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{tenant.db_name} • สร้าง {formatBangkokTime(tenant.created_at)}</p>
                      </div>
                    </button>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="hidden md:flex items-center gap-5 text-sm">
                        <div className="text-center"><p className="font-bold text-gray-900">{tenant.user_count ?? 0}</p><p className="text-[10px] text-gray-500">ผู้ใช้</p></div>
                        <div className="text-center"><p className="font-bold text-gray-900">{tenant.product_count ?? 0}</p><p className="text-[10px] text-gray-500">สินค้า</p></div>
                        <div className="text-center"><p className="font-bold text-brand">{tenant.order_count ?? 0}</p><p className="text-[10px] text-gray-500">ออเดอร์</p></div>
                        <div className="text-center"><p className="font-bold text-green-600">฿{Number(tenant.total_revenue ?? 0).toLocaleString()}</p><p className="text-[10px] text-gray-500">รายได้</p></div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => void fetchTenantDetail(tenant.id)} className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors" title="ดูรายละเอียด"><Eye size={18} /></button>
                        <button onClick={() => void handleDeleteTenant(tenant)} className="p-2 hover:bg-red-50 rounded-lg text-red-500 transition-colors" title="ลบร้านค้า (soft delete)"><Trash2 size={18} /></button>
                        <button onClick={() => void handleToggleTenant(tenant)} className={`p-2 rounded-lg transition-colors ${tenant.is_active ? 'hover:bg-red-50 text-red-600' : 'hover:bg-green-50 text-green-600'}`} title={tenant.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}>
                          {tenant.is_active ? <PowerOff size={18} /> : <Power size={18} />}
                        </button>
                        <ChevronRight size={16} className="text-gray-300 hidden sm:block" />
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ══════════ Modal สร้างร้านค้าใหม่ ══════════ */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-brand-border bg-brand-bg flex justify-between items-center">
              <h2 className="font-bold text-lg text-gray-800">เพิ่มร้านค้าใหม่</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1.5 hover:bg-brand-border rounded-lg text-gray-500" aria-label="ปิด"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">ชื่อร้านค้า <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={createForm.shop_name}
                  onChange={(e) => setCreateForm({ ...createForm, shop_name: e.target.value })}
                  className="w-full px-4 py-2.5 bg-brand-bg rounded-xl border border-brand-border outline-none focus:ring-2 focus:ring-brand text-sm"
                  placeholder="เช่น ร้านค้าสวัสดิการ"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">Username ของ Admin ร้าน <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={createForm.admin_username}
                  onChange={(e) => setCreateForm({ ...createForm, admin_username: e.target.value })}
                  className="w-full px-4 py-2.5 bg-brand-bg rounded-xl border border-brand-border outline-none focus:ring-2 focus:ring-brand text-sm"
                  placeholder="เช่น admin"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">รหัสผ่านเริ่มต้น <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={createForm.admin_password}
                  onChange={(e) => setCreateForm({ ...createForm, admin_password: e.target.value })}
                  className="w-full px-4 py-2.5 bg-brand-bg rounded-xl border border-brand-border outline-none focus:ring-2 focus:ring-brand text-sm"
                  placeholder="รหัสผ่าน (แนะนำให้เปลี่ยนหลังส่งมอบ)"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">แพ็กเกจ</label>
                <select
                  value={createForm.plan}
                  onChange={(e) => setCreateForm({ ...createForm, plan: e.target.value })}
                  className="w-full px-4 py-2.5 bg-brand-bg rounded-xl border border-brand-border outline-none focus:ring-2 focus:ring-brand text-sm"
                >
                  {PLAN_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <p className="text-xs text-gray-500 bg-brand-bg rounded-xl p-3 border border-brand-border">
                ระบบจะสร้าง <b>database แยก</b> ให้ร้านนี้โดยอัตโนมัติ (pos_&lt;ชื่อร้าน&gt;) พร้อมตารางทั้งหมด + บัญชี admin — ข้อมูลร้านอื่นจะไม่ปนกันแน่นอน
              </p>
            </div>
            <div className="px-5 py-4 border-t border-brand-border bg-gray-50 flex gap-3">
              <Button variant="primary" className="flex-1" onClick={() => void handleCreateTenant()} loading={creating}>
                <Check size={18} /> สร้างร้านค้า
              </Button>
              <Button variant="secondary" onClick={() => setShowCreateModal(false)}>ยกเลิก</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
