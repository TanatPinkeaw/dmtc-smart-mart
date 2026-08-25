// 📄 pages/SuperAdminDashboard.tsx — Super Admin Dashboard สำหรับจัดการ tenants ทั้งหมด
// ทำอะไร: แสดงภาพรวม tenants, แผนการใช้งาน, usage stats, ปุ่มจัดการ (impersonate/disable)
import { useState, useEffect } from 'react';
import { LayoutDashboard, Users, Package, ShoppingCart, DollarSign, AlertTriangle, Eye, Power, PowerOff, RefreshCw } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { formatBangkokTime } from '../utils/timezone';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';

interface TenantSummary {
  total_tenants: number;
  active_tenants: number;
  total_users: number;
  total_products: number;
  recent_orders: number;
  recent_sales: number;
}

interface Tenant {
  id: number;
  name: string;
  slug: string;
  plan: string;
  max_users: number;
  max_products: number;
  user_count: number;
  product_count: number;
  order_count: number;
  total_revenue: number;
  is_active: boolean;
  last_activity: string;
  user_usage_pct: number;
  product_usage_pct: number;
}

interface ApproachingLimit {
  id: number;
  name: string;
  plan: string;
  limit_type: string;
  user_count: number;
  max_users: number;
  product_count: number;
  max_products: number;
}

export default function SuperAdminDashboard() {
  const user = getCurrentUserOrRedirect();
  const [summary, setSummary] = useState<TenantSummary | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [approachingLimits, setApproachingLimits] = useState<ApproachingLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

  // Only ADMIN can access
  if (user.role !== 'ADMIN') {
    return <EmptyState icon={<LayoutDashboard size={28} />} title="ไม่มีสิทธิ์เข้าถึง" />;
  }

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const [dashRes, tenantsRes] = await Promise.all([
        api.get('/admin/dashboard'),
        api.get('/admin/dashboard/tenants')
      ]);
      setSummary(dashRes.data.summary);
      setApproachingLimits(dashRes.data.approaching_limits || []);
      setTenants(tenantsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleImpersonate = async (tenant: Tenant) => {
    const confirm = await Swal.fire({
      title: `เข้าสู่ระบบในฐานะ ${tenant.name}?`,
      text: 'คุณจะเห็นระบบในมุมมองของ tenant นี้ (1 ชั่วโมง)',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#10b981'
    });
    if (!confirm.isConfirmed) return;

    try {
      const res = await api.post(`/admin/dashboard/tenant/${tenant.id}/impersonate`);
      // Store impersonation token and redirect
      localStorage.setItem('impersonate_token', res.data.token);
      localStorage.setItem('impersonate_tenant', JSON.stringify(res.data.tenant));
      Swal.fire({ icon: 'success', title: 'กำลังเข้าสู่ระบบ...', timer: 1500, showConfirmButton: false });
      // Reload to apply impersonation
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'ไม่สามารถเข้าสู่ระบบได้', text: getErrorMessage(err) });
    }
  };

  const handleToggleTenant = async (tenant: Tenant) => {
    const action = tenant.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน';
    const confirm = await Swal.fire({
      title: `${action} ${tenant.name}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: tenant.is_active ? '#ef4444' : '#10b981'
    });
    if (!confirm.isConfirmed) return;

    try {
      await api.put(`/tenants/${tenant.id}`, { is_active: !tenant.is_active });
      Swal.fire({ icon: 'success', title: `${action}สำเร็จ` });
      fetchDashboard();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'ไม่สามารถดำเนินการได้', text: getErrorMessage(err) });
    }
  };

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'enterprise': return 'bg-purple-100 text-purple-700';
      case 'pro': return 'bg-blue-100 text-blue-700';
      case 'basic': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getUsageColor = (pct: number) => {
    if (pct >= 90) return 'text-red-600';
    if (pct >= 70) return 'text-yellow-600';
    return 'text-green-600';
  };

  if (loading) {
    return (
      <div className="bg-brand-bg min-h-screen pb-24">
        <PageHeader icon={LayoutDashboard} title="Super Admin Dashboard" />
        <div className="max-w-7xl mx-auto p-4 md:p-6">
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-3xl h-32 shadow-sm" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-brand-bg min-h-screen pb-24">
      <PageHeader icon={LayoutDashboard} title="Super Admin Dashboard" />
      
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-3xl p-4 shadow-sm border border-brand-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <LayoutDashboard size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-800">{summary.total_tenants}</p>
                  <p className="text-xs text-gray-500">Total Tenants</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-3xl p-4 shadow-sm border border-brand-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                  <Users size={20} className="text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-800">{summary.total_users}</p>
                  <p className="text-xs text-gray-500">Total Users</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-3xl p-4 shadow-sm border border-brand-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                  <Package size={20} className="text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-800">{summary.total_products}</p>
                  <p className="text-xs text-gray-500">Total Products</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-3xl p-4 shadow-sm border border-brand-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                  <DollarSign size={20} className="text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-800">฿{Number(summary.recent_sales).toLocaleString()}</p>
                  <p className="text-xs text-gray-500">Revenue (30d)</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Alerts */}
        {approachingLimits.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-3xl p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} className="text-yellow-600" />
              <h3 className="font-bold text-yellow-800">Tenants ใกล้ถึงขีดจำกัด</h3>
            </div>
            <div className="space-y-2">
              {approachingLimits.map(t => (
                <div key={t.id} className="flex items-center justify-between bg-white rounded-xl p-3">
                  <div>
                    <p className="font-bold text-gray-800">{t.name}</p>
                    <p className="text-xs text-gray-500">
                      {t.limit_type === 'users' 
                        ? `Users: ${t.user_count}/${t.max_users} (${Math.round(t.user_count/t.max_users*100)}%)`
                        : `Products: ${t.product_count}/${t.max_products} (${Math.round(t.product_count/t.max_products*100)}%)`
                      }
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${getPlanColor(t.plan)}`}>
                    {t.plan}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tenant List */}
        <div className="bg-white rounded-3xl shadow-sm border border-brand-border overflow-hidden">
          <div className="p-4 border-b border-brand-border flex justify-between items-center">
            <h2 className="font-bold text-gray-800">All Tenants ({tenants.length})</h2>
            <Button variant="secondary" size="sm" onClick={fetchDashboard}>
              <RefreshCw size={16} /> Refresh
            </Button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="p-3">Tenant</th>
                  <th className="p-3">Plan</th>
                  <th className="p-3">Users</th>
                  <th className="p-3">Products</th>
                  <th className="p-3">Revenue</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-brand-bg">
                    <td className="p-3">
                      <div>
                        <p className="font-bold text-gray-800">{t.name}</p>
                        <p className="text-xs text-gray-500">{t.slug}</p>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${getPlanColor(t.plan)}`}>
                        {t.plan}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${getUsageColor(t.user_usage_pct) === 'text-red-600' ? 'bg-red-500' : getUsageColor(t.user_usage_pct) === 'text-yellow-600' ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${Math.min(t.user_usage_pct, 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-bold ${getUsageColor(t.user_usage_pct)}`}>
                          {t.user_count}/{t.max_users}
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${getUsageColor(t.product_usage_pct) === 'text-red-600' ? 'bg-red-500' : getUsageColor(t.product_usage_pct) === 'text-yellow-600' ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${Math.min(t.product_usage_pct, 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-bold ${getUsageColor(t.product_usage_pct)}`}>
                          {t.product_count}/{t.max_products}
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="font-bold text-brand">฿{Number(t.total_revenue).toLocaleString()}</span>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {t.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onClick={() => handleImpersonate(t)}
                          className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600"
                          title="เข้าสู่ระบบในฐานะ tenant นี้"
                        >
                          <Eye size={16} />
                        </button>
                        <button 
                          onClick={() => handleToggleTenant(t)}
                          className={`p-1.5 hover:bg-red-100 rounded-lg ${t.is_active ? 'text-red-600' : 'text-green-600'}`}
                          title={t.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                        >
                          {t.is_active ? <PowerOff size={16} /> : <Power size={16} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
