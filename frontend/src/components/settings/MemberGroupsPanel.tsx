// 📄 components/settings/MemberGroupsPanel.tsx — แผงจัดการกลุ่มสมาชิก + กฎส่วนลดรายหมวดหมู่ (แท็บใน Settings)
//    ทำอะไร: สร้าง/แก้กลุ่มสมาชิก และตั้งส่วนลดเฉพาะหมวดหมู่ต่อกลุ่ม (เช่น อาจารย์ลด 10% เฉพาะเครื่องเขียน)
// ⭐️ Part 3 — จัดการกฎส่วนลดรายหมวดหมู่ของแต่ละกลุ่มสมาชิก (ADMIN + MANAGER)
//   เช่น อาจารย์ได้ลด 10% เฉพาะหมวด "เครื่องเขียน" — override ส่วนลด default ของกลุ่มเฉพาะหมวดนั้น
import { useState, useEffect } from 'react';
import { Users, Plus, Trash2 } from 'lucide-react';
import { SkeletonLine } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import api from '../../api';
import Swal from '../../swal';
import { getErrorMessage } from '../../utils/errorMessage';

interface Rule { id: number; category_id: number; discount_percent: number; category_name: string; }
interface Group { id: number; name: string; code: string; default_discount_percent: number; rules: Rule[]; }
interface Category { id: number; name: string; }

export function MemberGroupsPanel() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  // form state per group: { [groupId]: { category_id, discount_percent } }
  const [ruleForm, setRuleForm] = useState<Record<number, { category_id: string; discount_percent: string }>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [gRes, cRes] = await Promise.all([api.get('/member-groups'), api.get('/categories')]);
      setGroups(gRes.data || []);
      setCategories(cRes.data || []);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ', text: getErrorMessage(err) });
    } finally { setLoading(false); }
  };
  // IIFE: ให้กฎ set-state-in-effect มองว่า setState อยู่ใน async continuation
  useEffect(() => { void (async () => { await load(); })(); }, []);

  const addRule = async (groupId: number) => {
    const f = ruleForm[groupId];
    if (!f?.category_id) return Swal.fire({ icon: 'warning', title: 'เลือกหมวดหมู่ก่อน' });
    try {
      await api.post(`/member-groups/${groupId}/rules`, { category_id: Number(f.category_id), discount_percent: Number(f.discount_percent) || 0 });
      setRuleForm(prev => ({ ...prev, [groupId]: { category_id: '', discount_percent: '' } }));
      load();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: getErrorMessage(err) });
    }
  };

  const deleteRule = async (groupId: number, ruleId: number) => {
    try { await api.delete(`/member-groups/${groupId}/rules/${ruleId}`); load(); }
    catch (err) { Swal.fire({ icon: 'error', title: 'ลบไม่สำเร็จ', text: getErrorMessage(err) }); }
  };

  if (loading) return (
    <div className="space-y-3 py-6">
      <SkeletonLine width="w-1/3" height="h-4" />
      <SkeletonLine width="w-full" height="h-3" />
      <SkeletonLine width="w-4/5" height="h-3" />
    </div>
  );

  return (
    <div className="animate-fade-in max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2"><Users className="text-brand" size={20} /> กลุ่มสมาชิก & ส่วนลดรายหมวดหมู่</h2>
        <p className="text-xs text-gray-400 mt-1">ลำดับส่วนลด: โปรสินค้า &gt; กฎรายหมวดหมู่ &gt; ส่วนลด default ของกลุ่ม (ตั้ง default ได้ที่แท็บ "ราคา &amp; แต้มสะสม")</p>
      </div>

      {groups.map(g => (
        <div key={g.id} className="bg-white border border-brand-border rounded-3xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-bold text-gray-800">{g.name} <span className="text-[11px] text-gray-400 font-normal">({g.code})</span></p>
              <p className="text-[11px] text-gray-400">ส่วนลดเริ่มต้น {Number(g.default_discount_percent)}%</p>
            </div>
          </div>

          {/* existing rules */}
          {g.rules.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {g.rules.map(r => (
                <div key={r.id} className="flex items-center justify-between bg-brand-bg rounded-xl px-3 py-2">
                  <span className="text-sm text-gray-700">{r.category_name || `หมวด #${r.category_id}`} — <span className="font-bold text-brand">ลด {Number(r.discount_percent)}%</span></span>
                  <button onClick={() => deleteRule(g.id, r.id)} className="p-1 text-red-400 hover:bg-red-50 rounded-lg transition-colors" aria-label="ลบ"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}

          {/* add rule */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={ruleForm[g.id]?.category_id || ''}
              onChange={e => setRuleForm(prev => ({ ...prev, [g.id]: { ...(prev[g.id] || { discount_percent: '' }), category_id: e.target.value } }))}
              className="flex-1 min-w-[140px] px-3 py-2 rounded-xl border border-brand-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="">-- เลือกหมวดหมู่ --</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="number" min="0" max="100" placeholder="ลด %"
              value={ruleForm[g.id]?.discount_percent || ''}
              onChange={e => setRuleForm(prev => ({ ...prev, [g.id]: { ...(prev[g.id] || { category_id: '' }), discount_percent: e.target.value } }))}
              className="w-24 px-3 py-2 rounded-xl border border-brand-border bg-white text-sm font-bold text-right focus:outline-none focus:ring-2 focus:ring-brand" />
            <Button onClick={() => addRule(g.id)}><Plus size={14} /> เพิ่มกฎ</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
