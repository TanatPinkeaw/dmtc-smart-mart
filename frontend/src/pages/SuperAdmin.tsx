// 📄 pages/SuperAdmin.tsx — Super Admin Dashboard หน้าหลักสำหรับควบคุม POS ทุกร้าน
// ทำอะไร: ดู/เพิ่ม/แก้ไข/ลบ customers ทั้งหมด + เข้าไปจัดการข้อมูลใน POS แต่ละร้าน
import { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Users, Package, ShoppingCart, DollarSign, 
  Plus, Search, Eye, Edit, Trash2, Power, PowerOff, 
  RefreshCw, Store, ChevronRight, X, Check, AlertTriangle,
  BarChart3, Settings, ArrowLeft
} from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { formatBangkokTime } from '../utils/timezone';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';

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

interface TenantDetail extends Tenant {
  stats: {
    users: number;
    products: number;
    orders: number;
    revenue: number;
  };
  users: Array<{
    id: number;
    student_id: string;
    full_name: string;
    role: string;
    is_active: boolean;
  }>;
}

type ViewMode = 'list' | 'detail' | 'create';

export default function SuperAdmin() {
  const user = getCurrentUserOrRedirect();
  const [view, setView] = useState<ViewMode>('list');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    shop_name: '',
    admin_username: '',
    admin_password: '',
    plan: 'free'
  });

  // Only ADMIN can access
  if (user.role !== 'ADMIN') {
    return <EmptyState icon={<LayoutDashboard size={28} />} title="ไม่มีสิทธิ์เข้าถึง" />;
  }

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/dashboard');
      setTenants(res.data.tenants || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTenantDetail = async (id: number) => {
    try {
      const res = await api.get(`/admin/dashboard/tenant/${id}`);
      setSelectedTenant(res.data);
      setView('detail');
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'ไม่สามารถดึงข้อมูลได้', text: getErrorMessage(err) });
    }
  };

  const handleCreateTenant = async () => {
    if (!createForm.shop_name || !createForm.admin_username || !createForm.admin_password) {
      return Swal.fire({ icon: 'warning', title: 'กรุณากรอกข้อมูลให้ครบ' });
    }
    try {
      const res = await api.post('/admin/dashboard/create', createForm);
      Swal.fire({ 
        icon: 'success', 
        title: 'สร้าง POS สำเร็จ!',
        html: `<div style="text-align:left">
          <p><b>ร้าน:</b> ${createForm.shop_name}</p>
          <p><b>Username:</b> ${createForm.admin_username}</p>
          <p><b>Password:</b> ${createForm.admin_password}</p>
        </div>`
      });
      setShowCreateModal(false);
      setCreateForm({ shop_name: '', admin_username: '', admin_password: '', plan: 'free' });
      fetchTenants();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'สร้างไม่สำเร็จ', text: getErrorMessage(err) });
    }
  };

  const handleToggleTenant = async (tenant: Tenant) => {
    const action = tenant.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน';
    const confirm = await Swal.fire({
      title: `${action} ${tenant.shop_name}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: tenant.is_active ? '#ef4444' : '#10b981'
    });
    if (!confirm.isConfirmed) return;

    try {
      await api.put(`/admin/dashboard/tenant/${tenant.id}/toggle`);
      Swal.fire({ icon: 'success', title: `${action}สำเร็จ` });
      fetchTenants();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'ไม่สามารถดำเนินการได้', text: getErrorMessage(err) });
    }
  };

  const getPlanColor = (plan: string) => {
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

  // ── Loading State ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-gray-50 min-h-screen">
        <PageHeader icon={LayoutDashboard} title="Super Admin" />
        <div className="max-w-7xl mx-auto p-4 md:p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl h-24 shadow-sm animate-pulse" />
            ))}
          </div>
          <div className="bg-white rounded-2xl h-96 shadow-sm animate-pulse" />
        </div>
      </div>
    );
  }

  // ── List View ──────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="bg-gray-50 min-h-screen">
        <PageHeader icon={LayoutDashboard} title="Super Admin" />
        
        <div className="max-w-7xl mx-auto p-4 md:p-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                  <Store size={24} className="text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{tenants.length}</p>
                  <p className="text-xs text-gray-500">ร้านค้าทั้งหมด</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/25">
                  <Users size={24} className="text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {tenants.reduce((sum, t) => sum + (t.user_count || 0), 0)}
                  </p>
                  <p className="text-xs text-gray-500">ผู้ใช้ทั้งหมด</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
                  <Package size={24} className="text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {tenants.reduce((sum, t) => sum + (t.product_co
