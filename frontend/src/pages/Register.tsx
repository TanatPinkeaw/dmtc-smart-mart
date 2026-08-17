// 📄 pages/Register.tsx — หน้าสมัคร/ผูกบัญชีสมาชิกผ่าน LINE (LIFF endpoint) + แสดงบัตรสมาชิก
//    ทำอะไร: เปิดจาก LINE Rich Menu → เช็คว่าผูกบัญชีแล้วยัง; ยังไม่ผูก = ฟอร์มสมัคร; ผูกแล้ว = โชว์บัตรสมาชิก
//    (QR รหัสนักศึกษา + แต้ม auto-refresh); ถ้ามี session อยู่แล้วโชว์การ์ด "เป็นสมาชิกอยู่แล้ว"
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { API_BASE_URL } from '../config';
import { liff, ensureLiffInit } from '../utils/liff';
import { getCurrentUser } from '../utils/getCurrentUser';
import { type ErrorLike } from '../utils/errorMessage';
import { performLogout } from '../utils/logout';
import api, { setCsrfToken, setBearerToken } from '../api';
import { MobileBottomNav } from '../components/layout/MobileBottomNav';
import { MobileMenuDrawer } from '../components/layout/MobileMenuDrawer';
import { Button } from '../components/ui/Button';

// ⭐️ LIFF endpoint URL page — /register ไม่มี auth guard ใน App.tsx เพราะเปิดจาก LIFF ก่อน login
// เข้าระบบนี้เสมอ (LIFF มี session ของ LINE เอง ไม่ใช่ JWT ของแอปนี้) ยิง fetch ตรงไป API_BASE_URL
// แทนที่จะใช้ api.ts instance ตัวหลัก — instance นั้นมี global state (sessionExpired/csrfToken/
// forceLogout) ผูกกับ auth flow ปกติของแอป ใช้ในหน้านี้เสี่ยงชนกับ session ที่ไม่มีอยู่จริง
// ⭐️ ข้อยกเว้น: ถ้ามี session ของแอปอยู่จริง (persistent login — โชว์การ์ด "เป็นสมาชิกอยู่แล้ว")
// ใช้ api.ts instance ปกติได้ (GET /users/me, logout) เพราะ session มีจริง ไม่เสี่ยงชนแบบข้างต้น
// ⭐️ LIFF ID/SDK loading — เดิมหน้านี้มี LIFF_ID + script loader แยกของตัวเอง (คนละ id กับ Login.tsx)
// รวมเป็น liffId เดียวทั้งแอปแล้ว ใช้ utils/liff.ts ร่วมกัน (ensureLiffInit กัน init ซ้ำซ้อนตอนสลับหน้า)

type MemberUser = {
  id: number;
  student_id: string;
  full_name: string;
  role: string;
  points: number;
  group_name?: string | null;
  group_default_discount?: string | number | null;
};

// ⭐️ ทุก 60 วิ รีเฟรชแต้ม/กลุ่มอัตโนมัติ — QR ที่แสดงเป็นแค่ student_id เฉยๆ (ไม่ได้เข้ารหัส/หมดอายุ
// จริงจัง — สแกนแล้ว backend ค้นตรงๆ) "รีเฟรชเพื่อความปลอดภัย" ในสเปกหมายถึงข้อมูลตัวเลข (แต้ม/กลุ่ม)
// ที่โชว์บนจอต้องไม่ค้างเก่าไว้นาน ไม่ใช่ตัว QR code เปลี่ยนค่า — เพราะรหัสนักศึกษาไม่เปลี่ยนอยู่แล้ว
const AUTO_REFRESH_MS = 60 * 1000;

// ⭐️ 'authenticated' — ผู้ใช้ที่มี session ของแอปอยู่แล้ว (persistent login) เปิด /register จะเจอการ์ด
//   "คุณเป็นสมาชิกอยู่แล้ว" แทนฟอร์มสมัคร (ไม่ redirect ออก, ไม่ล้าง localStorage — ยังคง session ไว้)
type Stage = 'loading' | 'error' | 'card' | 'form' | 'submitting' | 'done' | 'authenticated';

type SessionMember = { full_name: string; role: string; points: number };

// ⭐️ เบอร์มือถือไทย: ขึ้นต้น 0 ตามด้วยเลข 9 หลัก รวม 10 หลัก
const PHONE_RE = /^0[0-9]{9}$/;

export default function Register() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [lineUserId, setLineUserId] = useState('');
  const [member, setMember] = useState<MemberUser | null>(null);
  // ⭐️ ข้อมูลจาก session ของแอป (persistent login) — โชว์ในการ์ด "เป็นสมาชิกอยู่แล้ว"
  const [sessionMember, setSessionMember] = useState<SessionMember | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [studentId, setStudentId] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldError, setFieldError] = useState<{ [k: string]: string }>({});
  const [refreshing, setRefreshing] = useState(false);
  // ⭐️ แถบล่างใช้ MobileBottomNav ตัวเดียวกับทุกหน้า (member) — เมนูเปิด drawer เดียวกับ Layout
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // ⭐️ ใช้ทั้งตอนโหลดครั้งแรกและตอนกด "รีเฟรช" / auto-refresh — ยิงซ้ำ endpoint เดิม (public,
  // ไม่ต้องมี JWT) เอาแต้ม/กลุ่มสมาชิกล่าสุดมาโชว์ ไม่แตะ stage ถ้ากำลัง refresh บัตรที่แสดงอยู่แล้ว
  // (กันหน้าจอกระพริบกลับไป loading ทุก 60 วิ)
  const refreshMemberStatus = useCallback(async (uid: string, isBackground: boolean) => {
    if (isBackground) setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/members/check-line/${encodeURIComponent(uid)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'ตรวจสอบสถานะสมาชิกไม่สำเร็จ');

      if (data.registered) {
        setMember(data.user);
        setStage('card');
      } else if (!isBackground) {
        setStage('form');
      }
    } catch (err) {
      if (!isBackground) {
        setErrorMsg((err as ErrorLike)?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่ภายหลัง');
        setStage('error');
      }
      // ⭐️ background refresh ล้มเหลว (เช่นเน็ตสะดุด) — เงียบไว้ ปล่อยให้บัตรที่โชว์อยู่ค้างข้อมูลเดิม
      // ดีกว่าดีดผู้ใช้ออกจากหน้าบัตรที่กำลังโชว์พนักงานเก็บเงินอยู่
    } finally {
      if (isBackground) setRefreshing(false);
    }
  }, []);

  // ⭐️ LIFF flow ล้วนๆ (ไม่เช็ค session ของแอป) — แยกออกมาเป็นฟังก์ชันเรียกซ้ำได้ เพราะหลัง logout
  // ต้องเรียกใหม่อีกครั้งเพื่อกลับไปเจอฟอร์มสมัคร/บัตรสมาชิกตาม LINE ปกติ (useEffect เดิม deps [] ไม่
  // รีรันเองตอน state เปลี่ยน — ต้อง call ตรงๆ จาก handleLogout)
  const runLiffFlow = useCallback(async () => {
    try {
      await ensureLiffInit();
      // ⭐️ CRITICAL: ห้ามเรียก liff.login() ตอนอยู่ในแอป LINE (isInClient=true) — จะบังคับ reload
      //   หน้าวนไม่จบ. เรียก liff.login() ได้เฉพาะเบราว์เซอร์ภายนอก (นอกแอป LINE) ที่ยังไม่ได้ login
      //   จริงๆ เท่านั้น. ในแอป LINE จะ auto-login ให้เอง เรียก getProfile ต่อได้เลย
      if (!liff.isLoggedIn() && !liff.isInClient()) {
        liff.login();
        return; // liff.login() นำทางออกไป LINE login ก่อน — component จะ mount ใหม่ตอนกลับมา
      }
      const profile = await liff.getProfile();
      setLineUserId(profile.userId);
      await refreshMemberStatus(profile.userId, false);
    } catch (err) {
      setErrorMsg((err as ErrorLike)?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่ภายหลัง');
      setStage('error');
    }
  }, [refreshMemberStatus]);

  // ⭐️ กัน LIFF init/login ทำงานซ้ำ (StrictMode double-invoke / re-render) — ต้องรันครั้งเดียวเท่านั้น
  const hasInit = useRef(false);
  useEffect(() => {
    if (hasInit.current) return;
    hasInit.current = true;
    (async () => {
      // ⭐️ UX fix — persistent session (localStorage 'user' จาก login ปกติ หรือ LIFF auto-login
      // ที่ผ่านมาก่อนหน้านี้) ยังคงอยู่ → ไม่ redirect ออกจาก /register และไม่แตะ localStorage เลย
      // (ไม่ทำลาย persistent login) แค่โชว์การ์ด "เป็นสมาชิกอยู่แล้ว" แทนฟอร์มสมัคร ข้าม LIFF flow
      // ทั้งหมดไปเลย เพราะมี session ของแอปอยู่แล้ว ไม่จำเป็นต้องผูก LINE ซ้ำ
      const sessionUser = getCurrentUser();
      if (sessionUser) {
        // ⭐️ localStorage.user (จาก login response) ไม่มีฟิลด์ points — ต้องดึงสดจาก /api/users/me
        // (self-only endpoint, ปลอดภัยสำหรับทุก role เพราะคืนแค่ข้อมูลของ req.user เอง) ใช้ api.ts
        // instance ปกติได้ตรงนี้เพราะ session มีอยู่จริง (ต่างจากฟลว LIFF ด้านล่างที่ยังไม่มี JWT)
        let points = 0;
        try {
          const meRes = await api.get('/users/me');
          points = Number(meRes.data?.points) || 0;
        } catch { /* ดึงแต้มสดไม่สำเร็จ — โชว์การ์ดต่อได้ แค่แต้มเป็น 0 ชั่วคราว ไม่ block UX */ }
        setSessionMember({ full_name: sessionUser.full_name, role: sessionUser.role, points });
        setStage('authenticated');
        return;
      }
      await runLiffFlow();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⭐️ Logout จากการ์ด "เป็นสมาชิกอยู่แล้ว" — เรียก logout จริง (performLogout: POST /auth/logout +
  // เคลียร์ cookie/csrf ฝั่ง backend, ล้าง localStorage.user ฝั่ง client) จากนั้นกลับไปรันฟลว LIFF ปกติ
  // ต่อทันที (ไม่ reload หน้า) ให้เจอฟอร์มสมัคร/บัตรสมาชิกตาม LINE เหมือนผู้ใช้ใหม่
  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await performLogout();
    } finally {
      setSessionMember(null);
      setStage('loading');
      setLoggingOut(false);
      await runLiffFlow();
    }
  };

  // ⭐️ auto-refresh แต้ม/กลุ่มทุก 60 วิ ระหว่างที่บัตรสมาชิกกำลังแสดงอยู่ (เช่น เปิดค้างไว้ให้พนักงานดู)
  useEffect(() => {
    if (stage !== 'card' || !lineUserId) return;
    const timer = setInterval(() => refreshMemberStatus(lineUserId, true), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [stage, lineUserId, refreshMemberStatus]);

  function validate() {
    const errs: { [k: string]: string } = {};
    if (!studentId.trim()) errs.studentId = 'กรุณากรอกรหัสนักศึกษา';
    if (!fullName.trim()) errs.fullName = 'กรุณากรอกชื่อ-นามสกุล';
    if (!PHONE_RE.test(phone.trim())) errs.phone = 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0';
    setFieldError(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setStage('submitting');
    try {
      const res = await fetch(`${API_BASE_URL}/members/register-line`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId.trim(),
          full_name: fullName.trim(),
          phone_number: phone.trim(),
          line_user_id: lineUserId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'ลงทะเบียนไม่สำเร็จ');

      // ⭐️ backend login ให้ทันทีหลังสมัครสำเร็จ (ตั้ง auth cookie แล้ว) — ให้ frontend state ตรงกัน
      // เผื่อ closeWindow() ไม่ทำงาน/ผู้ใช้ navigate ต่อก่อนหน้าต่างปิด (เช่น เข้า /pre-order เอง)
      // และเก็บ bearer token ไว้ด้วย (LINE in-app ITP บล็อก cookie เหมือนกับ line-login — ดู api.ts)
      if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
      if (data.csrfToken) setCsrfToken(data.csrfToken);
      if (data.access_token) setBearerToken(data.access_token);
      window.dispatchEvent(new Event('tokenChanged'));

      setStage('done');
      setTimeout(() => {
        const winLiff = (window as unknown as { liff?: { closeWindow?: () => void } }).liff;
        if (winLiff?.closeWindow) winLiff.closeWindow();
      }, 2000);
    } catch (err) {
      setErrorMsg((err as ErrorLike)?.message || 'ลงทะเบียนไม่สำเร็จ กรุณาลองใหม่');
      setStage('form');
    }
  }

  function closeLiff() {
    const winLiff = (window as unknown as { liff?: { closeWindow?: () => void } }).liff;
    if (winLiff?.closeWindow) winLiff.closeWindow();
  }

  return (
    <div className={`min-h-screen bg-brand-bg flex items-center justify-center p-4 ${stage === 'authenticated' ? 'pb-28' : ''}`}>
      <div className="w-full max-w-md">
        {stage === 'loading' && (
          <div className="bg-white rounded-3xl shadow-md border border-brand-border p-8 flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand" />
            <p className="text-sm font-medium text-gray-500">กำลังตรวจสอบข้อมูลสมาชิก...</p>
          </div>
        )}

        {stage === 'error' && (
          <div className="bg-white rounded-3xl shadow-md border border-brand-border p-8 text-center">
            <p className="text-red-500 font-bold mb-2">เกิดข้อผิดพลาด</p>
            <p className="text-sm text-gray-500">{errorMsg}</p>
          </div>
        )}

        {/* ⭐️ persistent session อยู่แล้ว (login ปกติ หรือ LIFF auto-login ก่อนหน้านี้) — โชว์การ์ด
            "เป็นสมาชิกอยู่แล้ว" แทนฟอร์มสมัครซ้ำ ไม่ redirect ออก ไม่แตะ localStorage */}
        {stage === 'authenticated' && sessionMember && (
          <div className="bg-white rounded-3xl shadow-md border border-brand-border overflow-hidden">
            <div className="bg-gradient-to-br from-brand to-brand-dark px-6 py-8 text-white text-center">
              <p className="text-3xl mb-1">👋</p>
              <p className="text-sm font-medium opacity-90">คุณเป็นสมาชิกอยู่แล้ว</p>
              <p className="text-2xl font-bold mt-1">{sessionMember.full_name}</p>
              <span className="inline-block mt-2 bg-white/25 text-white text-xs font-bold px-3 py-1 rounded-full">
                {sessionMember.role}
              </span>
            </div>
            <div className="p-6 text-center">
              <p className="text-xs text-gray-400 mb-1">แต้มสะสมปัจจุบัน</p>
              <p className="text-4xl font-bold text-brand mb-6">{sessionMember.points.toLocaleString()} <span className="text-base font-medium text-gray-400">แต้ม</span></p>
              <Button size="lg" className="w-full" onClick={() => navigate('/pre-order')}>
                🛒 ไปที่ร้านค้า
              </Button>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="w-full py-3.5 mt-3 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-full transition-all duration-150 active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loggingOut ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500" />
                    กำลังออกจากระบบ...
                  </>
                ) : '🚪 ออกจากระบบ'}
              </button>
            </div>
          </div>
        )}

        {stage === 'card' && member && (
          <div className="bg-white rounded-3xl shadow-md border border-brand-border overflow-hidden">
            <div className="bg-gradient-to-br from-brand to-brand-dark px-6 py-8 text-white text-center relative">
              {/* ⭐️ ปุ่มรีเฟรชด้วยมือ — เผื่อผู้ใช้เพิ่งใช้แต้มไปที่แคชเชียร์ อยากเห็นยอดล่าสุดทันทีไม่ต้องรอ 60 วิ */}
              <button
                onClick={() => refreshMemberStatus(lineUserId, true)}
                disabled={refreshing}
                aria-label="รีเฟรชข้อมูล"
                className="absolute top-3 right-3 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-all duration-150 active:scale-90 disabled:opacity-50"
              >
                <span className={`inline-block text-sm ${refreshing ? 'animate-spin' : ''}`}>🔄</span>
              </button>
              <p className="text-xs font-medium opacity-80 mb-1">บัตรสมาชิก DMTC Smart Mart</p>
              <p className="text-2xl font-bold">{member.full_name}</p>
              <p className="text-sm opacity-90 mt-1">รหัสนักศึกษา {member.student_id}</p>
              {member.group_name && (
                <span className="inline-block mt-2 bg-white/25 text-white text-xs font-bold px-3 py-1 rounded-full">
                  🏷️ {member.group_name}
                  {Number(member.group_default_discount) > 0 ? ` — ลด ${Number(member.group_default_discount)}%` : ''}
                </span>
              )}
            </div>
            <div className="p-6 text-center">
              {/* ⭐️ QR code เข้ารหัส student_id ตรงๆ — แคชเชียร์สแกนแล้วยิง GET /api/members/lookup/:identifier
                  ที่ backend หา user ตรงตัว ไม่ต้องมี token/session แยกฝั่งลูกค้า */}
              <div className="flex justify-center mb-4">
                <div className="bg-white p-3 rounded-2xl border border-brand-border">
                  <QRCode value={member.student_id} size={160} />
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-1">แต้มสะสมปัจจุบัน</p>
              <p className="text-4xl font-bold text-brand mb-6">{member.points.toLocaleString()} <span className="text-base font-medium text-gray-400">แต้ม</span></p>
              <Button size="lg" className="w-full" onClick={closeLiff}>
                ปิดหน้านี้
              </Button>
            </div>
          </div>
        )}

        {(stage === 'form' || stage === 'submitting') && (
          <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-md border border-brand-border overflow-hidden">
            <div className="bg-gradient-to-r from-brand to-brand-dark px-6 py-5">
              <p className="text-white font-bold text-lg">สมัครสมาชิก DMTC Smart Mart</p>
              <p className="text-white/80 text-xs mt-0.5">กรอกข้อมูลเพื่อผูกบัญชี LINE กับสมาชิก</p>
            </div>
            <div className="p-6 flex flex-col gap-4">
              {errorMsg && stage === 'form' && (
                <p className="text-sm text-red-500 font-medium -mt-1">{errorMsg}</p>
              )}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">รหัสนักศึกษา / รหัสประจำตัว</label>
                <input
                  type="text"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="w-full px-4 py-3 bg-brand-bg border border-brand-border rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150"
                  placeholder="เช่น 6512345678"
                />
                {fieldError.studentId && <p className="text-xs text-red-500 mt-1 ml-2">{fieldError.studentId}</p>}
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">ชื่อ - นามสกุล</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-4 py-3 bg-brand-bg border border-brand-border rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150"
                  placeholder="เช่น สมชาย ใจดี"
                />
                {fieldError.fullName && <p className="text-xs text-red-500 mt-1 ml-2">{fieldError.fullName}</p>}
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">เบอร์โทรศัพท์</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-full px-4 py-3 bg-brand-bg border border-brand-border rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150"
                  placeholder="0812345678"
                />
                {fieldError.phone && <p className="text-xs text-red-500 mt-1 ml-2">{fieldError.phone}</p>}
              </div>
              <Button type="submit" size="lg" className="w-full mt-2" disabled={stage === 'submitting'}>
                {stage === 'submitting' ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    กำลังลงทะเบียน...
                  </>
                ) : 'ยืนยันการลงทะเบียน'}
              </Button>
            </div>
          </form>
        )}

        {stage === 'done' && (
          <div className="bg-white rounded-3xl shadow-md border border-brand-border p-8 text-center">
            <p className="text-3xl mb-2">✅</p>
            <p className="font-bold text-lg mb-1">ลงทะเบียนสำเร็จ</p>
            <p className="text-sm text-gray-500">กำลังปิดหน้าต่างอัตโนมัติ...</p>
          </div>
        )}
      </div>

      {/* ⭐️ แถบล่างตัวเดียวกับทุกหน้า (mobile) — โชว์เฉพาะตอน login แล้ว (การ์ด "เป็นสมาชิกอยู่แล้ว") */}
      {stage === 'authenticated' && (
        <>
          <MobileBottomNav
            isStaff={false}
            isCashier={false}
            unreadCount={0}
            pendingOrders={0}
            onOpenMobileMenu={() => setShowMobileMenu(true)}
            onOpenProfile={() => navigate('/profile')}
          />
          {showMobileMenu && (
            <MobileMenuDrawer
              isStaff={false}
              isAdmin={false}
              isStoreAdmin={false}
              onClose={() => setShowMobileMenu(false)}
              onLogoutClick={handleLogout}
            />
          )}
        </>
      )}
    </div>
  );
}
