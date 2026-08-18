// 📄 pages/Profile.tsx — หน้าบัญชีของฉัน (ทุก role): แก้เบอร์โทร/รูปโปรไฟล์/เปลี่ยนรหัสผ่าน
// ✅ NEW: หน้าโปรไฟล์เต็มหน้า — เดิมเป็น modal (components/layout/ProfileModal.tsx) ที่เด้งจาก
//   ปุ่มโปรไฟล์ใน sidebar/แถบล่าง ขอบเขตเท่าเดิมทุกอย่าง (รูปโปรไฟล์ / เบอร์โทร / เปลี่ยนรหัสผ่าน)
//   แค่ย้ายมาเป็นหน้าจริงที่ route /profile ให้มีที่ว่างพอและกดกลับ/แชร์ลิงก์ได้ตามปกติ
// 🔒 UNCHANGED: logic อัปเดตเบอร์ (PUT /users/:id/profile) และอัปโหลดรูป (POST /users/:id/profile-photo)
//   ยกมาจาก Layout.tsx ตรงๆ ไม่แก้ payload/endpoint

import { useRef, useState } from 'react';
import { User, Phone, KeyRound, Camera } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { ChangePasswordModal } from '../components/auth/ChangePasswordModal';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';

export default function Profile() {
  const user = getCurrentUserOrRedirect();
  // ⭐️ บัญชีพนักงาน = ทำงาน (ไม่มีสิทธิ์แต้มสมาชิก) — badge แยกจาก badge role ให้เห็นชัด
  const isStaff = user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'CASHIER';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phoneNumber, setPhoneNumber] = useState(user.phone_number || '');
  const [saving, setSaving] = useState(false);
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(user.profile_image_url || null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    // ⭐️ SECURITY FIX (#4) — เปลี่ยนรหัสผ่านอยู่ในโมดัลแยก (ยืนยันรหัสเดิม) ทางเดียว ฟอร์มนี้แก้แค่เบอร์โทร
    setSaving(true);
    try {
      await api.put(`/users/${user.id}/profile`, { full_name: user.full_name, phone_number: phoneNumber || null });
      localStorage.setItem('user', JSON.stringify({ ...user, phone_number: phoneNumber }));
      Swal.fire({ icon: 'success', title: 'อัปเดตข้อมูลสำเร็จ!', showConfirmButton: false, timer: 1500 });
    } catch (error) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(error) }); }
    finally { setSaving(false); }
  };

  const handlePhotoSelected = async (file: File) => {
    setPhotoUploading(true);
    try {
      const fd = new FormData(); fd.append('photo', file);
      const res = await api.post(`/users/${user.id}/profile-photo`, fd);
      setProfileImageUrl(res.data.photo_url);
      localStorage.setItem('user', JSON.stringify({ ...user, profile_image_url: res.data.photo_url }));
      // ⭐️ Sidebar/แถบล่างใน Layout.tsx เก็บรูปโปรไฟล์ไว้ใน state ของตัวเอง — ยิง event บอกให้อัปเดตตาม
      //   ไม่งั้นรูปในเมนูจะยังเป็นรูปเก่าจนกว่าจะรีเฟรชหน้า (pattern เดียวกับ 'tokenChanged' ใน Login.tsx)
      window.dispatchEvent(new Event('profilePhotoChanged'));
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'เปลี่ยนรูปโปรไฟล์แล้ว', showConfirmButton: false, timer: 1500 });
    } catch (error) { Swal.fire({ icon: 'error', title: 'อัปโหลดรูปไม่สำเร็จ', text: getErrorMessage(error) }); }
    finally { setPhotoUploading(false); }
  };

  return (
    <div className="min-h-screen bg-brand-bg pb-24">
      <div className="max-w-lg mx-auto">

        {/* ⭐️ แถบหัวหน้ามาตรฐานเดียวกับทุกหน้า (PageHeader) + ชายคาหยัก (awning) ภาษาเดียวกับ Home
            sticky เหมือนหน้าแจ้งเตือน — แถบหัวติดด้านบนตอนเลื่อน ชายคาบังเนื้อหาที่เลื่อนผ่านด้านล่าง */}
        <PageHeader icon={User} title="บัญชีของฉัน" className="sticky top-0 z-10 awning-edge" />

        {/* pt-5 เผื่อชายคาหยัก (awning) ยื่นลงมา 12px */}
        <div className="px-4 sm:px-6 pt-5 pb-4 sm:pb-6">
        {/* Identity card — รูปโปรไฟล์ + ชื่อ + สิทธิ์ */}
        <div className="bg-white border border-brand-border rounded-3xl shadow-sm p-5 mb-4 flex flex-col items-center">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handlePhotoSelected(f); }} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={photoUploading}
            className="relative w-20 h-20 rounded-2xl mb-3 group disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            title="เปลี่ยนรูปโปรไฟล์"
          >
            <img src={profileImageUrl || '/Default profile.png'} alt={user.full_name} className="w-20 h-20 rounded-2xl object-cover border-2 border-brand-border" />
            <span className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors duration-150">
              <Camera size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
            </span>
            {photoUploading && (
              <span className="absolute inset-0 rounded-2xl bg-black/40 flex items-center justify-center">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </span>
            )}
          </button>
          <p className="text-xs text-gray-400 font-medium mb-3">แตะรูปเพื่อเปลี่ยน</p>

          <p className="font-display font-bold text-ink">{user.full_name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{user.student_id || user.username}</p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-brand-bg text-brand border border-brand-mid">{user.role}</span>
            {/* ⭐️ badge บัญชีพนักงาน — เห็นชัดว่านี่ไม่ใช่บัญชีสมาชิก (ไม่มีสิทธิ์แต้ม) */}
            {isStaff && (
              <span title="บัญชีพนักงาน — สั่งจองสินค้าได้ แต่ไม่มีสิทธิ์สะสม/แลกแต้มสมาชิก" className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500 border border-brand-border">
                💼 พนักงาน
              </span>
            )}
          </div>
        </div>

        {/* Phone */}
        <form onSubmit={handleUpdateProfile} className="bg-white border border-brand-border rounded-3xl shadow-sm p-5 mb-4">
          <label className="flex items-center gap-1.5 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
            <Phone size={13} /> เบอร์โทรศัพท์
          </label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={e => setPhoneNumber(e.target.value)}
            placeholder="08X-XXX-XXXX"
            className="w-full px-4 py-3 bg-brand-bg border border-brand-border rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150"
          />
          <p className="text-[11px] text-amber-600 mt-2">⚠️ รหัสผ่านเริ่มต้นคือเบอร์โทรตอนสมัคร ถ้าเปลี่ยนเบอร์ควรเปลี่ยนรหัสผ่านด้วย</p>

          <Button type="submit" size="lg" className="w-full mt-4" disabled={saving}>
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}
          </Button>
        </form>

        {/* Security */}
        <div className="bg-white border border-brand-border rounded-3xl shadow-sm p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">ความปลอดภัย</p>
          <button
            type="button"
            onClick={() => setShowChangePassword(true)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-white text-brand border border-brand-border font-bold text-sm rounded-full shadow-sm hover:bg-brand-bg transition-all duration-150 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <KeyRound size={16} /> เปลี่ยนรหัสผ่าน
          </button>
        </div>
      </div>

      {showChangePassword && (
        <ChangePasswordModal userId={user.id} onClose={() => setShowChangePassword(false)} />
      )}
      </div>
    </div>
  );
}
