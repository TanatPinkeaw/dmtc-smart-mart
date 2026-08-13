// 📄 components/dashboard/AdminDashboardHero.tsx — ส่วนหัวหน้า Dashboard (การ์ดสรุป + กราฟยอดขาย)
//    ทำอะไร: โชว์ตัวเลขสรุปวันนี้ + กราฟ (recharts) — หน้าตาล้วน รับข้อมูลจาก pages/Dashboard.tsx
import type { ReactNode } from 'react';
import { ArrowUpRight, ArrowDownRight, TrendingUp, ShoppingBag, Package, XCircle } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatBangkokTime } from '../../utils/timezone';

// ⭐️ Design-ref — โครงหน้า Dashboard ผู้จัดการ อ้างอิงจาก AdminDashboardScreen.tsx (Figma Make)
// สถิติ + กราฟ ใช้ข้อมูลจริงจาก backend เท่านั้น (ไม่ fabricate เทรนด์ที่ไม่มีข้อมูลย้อนหลังรองรับ)

function StatCard({ icon, label, value, sub, trend }: {
  icon: ReactNode; label: string; value: string; sub: string; trend?: { text: string; up: boolean };
}) {
  return (
    <div className="bg-white rounded-3xl border border-brand-border p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-brand-bg shrink-0">{icon}</div>
        {trend && (
          <span className={`flex items-center gap-0.5 text-xs font-bold ${trend.up ? 'text-emerald-500' : 'text-red-400'}`}>
            {trend.up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {trend.text}
          </span>
        )}
      </div>
      <div>
        <p className="text-xl font-extrabold text-gray-900">{value}</p>
        <p className="text-xs font-semibold text-gray-500 mt-0.5">{label}</p>
      </div>
      <p className="text-xs text-gray-400 font-medium border-t border-brand-border pt-2">{sub}</p>
    </div>
  );
}

function SalesTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (active && payload?.length) {
    return (
      <div className="bg-white border border-brand-border rounded-xl px-3 py-2 shadow-lg">
        <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
        <p className="text-sm font-extrabold text-gray-900">฿{payload[0].value.toLocaleString()}</p>
      </div>
    );
  }
  return null;
}

interface AdminDashboardHeroProps {
  summary: any;
  comparison: any;
  lowStockCount: number;
  voidSummary: any;
  weeklySales: { day: string; total: number }[];
  topProducts: any[];
  recentOrders: any[];
}

export function AdminDashboardHero({ summary, comparison, lowStockCount, voidSummary, weeklySales, topProducts, recentOrders }: AdminDashboardHeroProps) {
  const pctYesterday = comparison?.pct_vs_yesterday;
  const card = "bg-white rounded-3xl border border-brand-border p-4 shadow-sm";

  return (
    <div className="max-w-7xl mx-auto space-y-4 mb-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<TrendingUp size={18} className="text-brand" />}
          label="ยอดขายวันนี้"
          value={`฿${Number(summary?.total_sales || 0).toLocaleString()}`}
          sub={comparison?.yesterday != null ? `เมื่อวาน ฿${Number(comparison.yesterday).toLocaleString()}` : 'ข้อมูลรีเซ็ตทุกเที่ยงคืน'}
          trend={pctYesterday != null ? { text: `${pctYesterday > 0 ? '+' : ''}${pctYesterday}%`, up: pctYesterday >= 0 } : undefined}
        />
        <StatCard
          icon={<ShoppingBag size={18} className="text-brand" />}
          label="ออเดอร์วันนี้"
          value={String(summary?.total_bills || 0)}
          sub="รวมหน้าร้านและสั่งจอง"
        />
        <StatCard
          icon={<Package size={18} className="text-brand" />}
          label="สินค้าใกล้หมด"
          value={String(lowStockCount)}
          sub="ควรเติมสต๊อกเร็วๆ นี้"
        />
        <StatCard
          icon={<XCircle size={18} className="text-brand" />}
          label="บิลยกเลิกวันนี้"
          value={String(voidSummary?.void_count || 0)}
          sub={`มูลค่า ฿${Number(voidSummary?.void_amount || 0).toLocaleString()}`}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className={`lg:col-span-2 ${card}`}>
          <div className="mb-4">
            <h3 className="font-extrabold text-gray-900 text-sm">ยอดขายรายสัปดาห์</h3>
            <p className="text-xs text-gray-400 font-medium mt-0.5">ย้อนหลัง 7 วัน (รวมวันนี้)</p>
          </div>
          {weeklySales.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-12">กำลังโหลดข้อมูล...</p>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={weeklySales} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F12B6B" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#F12B6B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F6C7C7" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9CA3AF', fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <Tooltip content={<SalesTooltip />} />
                <Area type="monotone" dataKey="total" stroke="#F12B6B" strokeWidth={2.5} fill="url(#salesGrad)" dot={{ fill: '#F12B6B', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: '#F12B6B' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className={card}>
          <div className="mb-4">
            <h3 className="font-extrabold text-gray-900 text-sm">สินค้าขายดี</h3>
            <p className="text-xs text-gray-400 font-medium mt-0.5">จำนวนที่ขายได้</p>
          </div>
          {topProducts.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-12">ยังไม่มีข้อมูลวันนี้</p>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={topProducts.slice(0, 5)} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#9CA3AF', fontWeight: 600 }} axisLine={false} tickLine={false} width={70} />
                <Tooltip formatter={(value) => [`${value} ชิ้น`, '']} contentStyle={{ border: '1px solid #F6C7C7', borderRadius: 12, fontSize: 11, fontWeight: 700 }} />
                <Bar dataKey="total_quantity" fill="#F12B6B" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent orders feed */}
      <div className={card}>
        <h3 className="font-extrabold text-gray-900 text-sm mb-2">ออเดอร์ล่าสุด</h3>
        {recentOrders.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">ยังไม่มีออเดอร์วันนี้</p>
        ) : (
          <div className="divide-y divide-brand-border">
            {recentOrders.slice(0, 6).map((o: any) => (
              <div key={`${o.source}-${o.id}`} className="flex items-center gap-3 py-3">
                <div className="w-8 h-8 rounded-xl bg-brand-bg flex items-center justify-center shrink-0">
                  <span className="text-brand text-xs font-extrabold">{(o.cashier_name || '?').charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-800 text-xs truncate">{o.cashier_name}</span>
                    <span className="text-gray-300 text-xs shrink-0">·</span>
                    <span className="text-gray-400 text-xs font-medium shrink-0">{formatBangkokTime(o.created_at).slice(-5)}</span>
                  </div>
                  <p className="text-xs text-gray-400 font-medium">
                    {o.source === 'PREORDER' ? 'สั่งจอง' : 'หน้าร้าน'}{o.status === 'VOIDED' ? ' · ยกเลิกแล้ว' : ''}
                  </p>
                </div>
                <span className="font-extrabold text-gray-800 text-xs shrink-0">฿{Number(o.total_amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
