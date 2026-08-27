import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

const NAV = [
  { path: '/pos-admin/dashboard', label: 'แดชบอร์ด', icon: '📊' },
  { path: '/pos-admin/products', label: 'สินค้า', icon: '📦' },
  { path: '/pos-admin/categories', label: 'หมวดหมู่', icon: '🏷️' },
  { path: '/pos-admin/users', label: 'ผู้ใช้', icon: '👥' },
  { path: '/pos-admin/settings', label: 'ตั้งค่าร้าน', icon: '⚙️' },
  { path: '/pos-admin/reports', label: 'รายงาน', icon: '📈' },
];

export default function PosAdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const storeName = localStorage.getItem('pos_admin_store') || 'POS Admin';
  const user = JSON.parse(localStorage.getItem('pos_admin_user') || '{}');

  useEffect(() => {
    if (!localStorage.getItem('pos_admin_token')) {
      navigate('/pos-admin/login', { replace: true });
      return;
    }
    setReady(true);
  }, [navigate]);

  const logout = () => {
    ['pos_admin_user','pos_admin_db','pos_admin_store','pos_admin_token','pos_admin_csrf']
      .forEach(k => localStorage.removeItem(k));
    navigate('/pos-admin/login');
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen flex bg-gray-100">
      <aside className="w-64 bg-white shadow-lg flex flex-col">
        <div className="p-6 border-b">
          <h2 className="text-lg font-bold text-emerald-700">{storeName}</h2>
          <p className="text-sm text-gray-500">จัดการร้าน POS</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {NAV.map(n => (
            <Link key={n.path} to={n.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                location.pathname === n.path ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              <span>{n.icon}</span> {n.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t">
          <p className="text-xs text-gray-400 mb-2">{user.full_name} ({user.role})</p>
          <button onClick={logout} className="w-full text-sm text-red-600 hover:bg-red-50 py-2 rounded-xl">ออกจากระบบ</button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
