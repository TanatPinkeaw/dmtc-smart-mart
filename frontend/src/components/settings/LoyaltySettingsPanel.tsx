// 📄 components/settings/LoyaltySettingsPanel.tsx — แผงตั้งค่าอัตราแต้มสะสม (แท็บในหน้า Settings)
//    ทำอะไร: ตั้ง "กี่บาทได้ 1 แต้ม" (earn) + "1 แต้ม = กี่บาท" (redeem) + ส่วนลด default ต่อกลุ่มสมาชิก
//    บันทึกแล้วมีผลทันทีทุกเครื่อง POS (checkout อ่านค่าจาก settings ทุกครั้ง ไม่ต้องรีสตาร์ท)
// ⭐️ Part 2 — แผงตั้งค่าอัตราแต้มสะสม + ส่วนลด default ของแต่ละกลุ่ม (ADMIN + MANAGER)
//   บันทึกแล้วมีผลทันทีทุกเครื่อง POS (checkout อ่านค่าจาก settings ต่อรายการ ไม่ต้อง restart)
import { useState, useEffect } from 'react';
import { Save, Coins } from 'lucide-react';
import api from '../../api';
import Swal from '../../swal';
import { getErrorMessage } from '../../utils/errorMessage';

interface Group { id: number; name: string; code: string; default_discount_percent: number; }

export function LoyaltySettingsPanel() {
  const [earn, setEarn] = useState('20');
  const [redeem, setRedeem] = useState('1');
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/settings/loyalty');
      setEarn(String(res.data.points_earn_amount_per_point ?? 20));
      setRedeem(String(res.data.points_redeem_value_per_point ?? 1));
      setGroups(res.data.groups || []);
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ', text: getErrorMessage(err) });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const saveRates = async () => {
    const e = Number(earn), r = Number(redeem);
    if (!Number.isFinite(e) || e <= 0) return Swal.fire({ icon: 'warning', title: 'ค่าไม่ถูกต้อง', text: 'จำนวนบาทต่อ 1 แต้ม ต้องมากกว่า 0' });
    if (!Number.isFinite(r) || r <= 0) return Swal.fire({ icon: 'warning', title: 'ค่าไม่ถูกต้อง', text: 'มูลค่าต่อแต้ม ต้องมากกว่า 0' });
    setSaving(true);
    try {
      await api.put('/settings/loyalty', { points_earn_amount_per_point: e, points_redeem_value_per_point: r });
      Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', showConfirmButton: false, timer: 1200 });
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: getErrorMessage(err) });
    } finally { setSaving(false); }
  };

  const saveGroupDiscount = async (g: Group, pct: number) => {
    try {
      await api.put(`/member-groups/${g.id}`, { name: g.name, default_discount_percent: pct, description: null });
      setGroups(prev => prev.map(x => x.id === g.id ? { ...x, default_discount_percent: pct } : x));
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: getErrorMessage(err) });
    }
  };

  if (loading) return <p className="text-center text-gray-400 py-10 text-sm">กำลังโหลด...</p>;

  return (
    <div className="animate-fade-in max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><Coins className="text-brand" size={20} /> อัตราแต้มสะสม</h2>
        <p className="text-xs text-gray-400 mb-4">แก้แล้วมีผลทันทีทุกเครื่อง POS ไม่ต้องรีสตาร์ท</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">ได้ 1 แต้ม ทุกๆ (บาท)</label>
            <input type="number" min="1" value={earn} onChange={e => setEarn(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-brand-border bg-brand-bg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors" />
            <p className="text-[11px] text-gray-400 mt-1">เช่น 20 = ซื้อครบ 20 บาท ได้ 1 แต้ม</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">1 แต้ม = ส่วนลด (บาท)</label>
            <input type="number" min="0" step="0.01" value={redeem} onChange={e => setRedeem(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-brand-border bg-brand-bg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors" />
            <p className="text-[11px] text-gray-400 mt-1">เช่น 1 = 1 แต้ม แลกส่วนลดได้ 1 บาท</p>
          </div>
        </div>
        <button onClick={saveRates} disabled={saving}
          className="mt-4 inline-flex items-center gap-2 bg-gradient-to-br from-brand to-brand-dark text-white px-6 py-2.5 rounded-full font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-50">
          <Save size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกอัตรา'}
        </button>
      </div>

      <div>
        <h2 className="text-lg font-bold mb-1">ส่วนลดเริ่มต้นตามกลุ่มสมาชิก</h2>
        <p className="text-xs text-gray-400 mb-4">ส่วนลดที่สมาชิกกลุ่มนั้นได้อัตโนมัติทุกชิ้น (ถ้าไม่มีโปรสินค้า/กฎรายหมวดหมู่มาก่อน)</p>
        <div className="space-y-2">
          {groups.map(g => (
            <div key={g.id} className="flex items-center justify-between bg-white border border-brand-border rounded-2xl p-3">
              <div>
                <p className="text-sm font-bold text-gray-800">{g.name}</p>
                <p className="text-[11px] text-gray-400">{g.code}</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" min="0" max="100" defaultValue={Number(g.default_discount_percent)}
                  onBlur={e => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); if (v !== Number(g.default_discount_percent)) saveGroupDiscount(g, v); }}
                  className="w-20 px-3 py-2 rounded-xl border border-brand-border bg-brand-bg text-sm font-bold text-right focus:outline-none focus:ring-2 focus:ring-brand" />
                <span className="text-sm font-bold text-gray-500">%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
