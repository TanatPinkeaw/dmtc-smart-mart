import { useCallback, useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { API_BASE_URL } from '../config';

// ⭐️ LIFF endpoint URL page — /register ไม่มี auth guard ใน App.tsx เพราะเปิดจาก LIFF ก่อน login
// เข้าระบบนี้เสมอ (LIFF มี session ของ LINE เอง ไม่ใช่ JWT ของแอปนี้) ยิง fetch ตรงไป API_BASE_URL
// แทนที่จะใช้ api.ts instance ตัวหลัก — instance นั้นมี global state (sessionExpired/csrfToken/
// forceLogout) ผูกกับ auth flow ปกติของแอป ใช้ในหน้านี้เสี่ยงชนกับ session ที่ไม่มีอยู่จริง
const LIFF_ID = '2010928001-YxK4Atjv';
const LIFF_SDK_SRC = 'https://static.line-scdn.net/liff/edge/2/sdk.js';

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

type Stage = 'loading' | 'error' | 'card' | 'form' | 'submitting' | 'done';

function loadLiffSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.liff) return resolve(w.liff);
    const script = document.createElement('script');
    script.src = LIFF_SDK_SRC;
    script.onload = () => resolve(w.liff);
    script.onerror = () => reject(new Error('โหลด LINE SDK ไม่สำเร็จ กรุณาลองใหม่'));
    document.head.appendChild(script);
  });
}

// ⭐️ เบอร์มือถือไทย: ขึ้นต้น 0 ตามด้วยเลข 9 หลัก รวม 10 หลัก
const PHONE_RE = /^0[0-9]{9}$/;

export default function Register() {
  const [stage, setStage] = useState<Stage>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [lineUserId, setLineUserId] = useState('');
  const [member, setMember] = useState<MemberUser | null>(null);

  const [studentId, setStudentId] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldError, setFieldError] = useState<{ [k: string]: string }>({});
  const [refreshing, setRefreshing] = useState(false);

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
    } catch (err: any) {
      if (!isBackground) {
        setErrorMsg(err?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่ภายหลัง');
        setStage('error');
      }
      // ⭐️ background refresh ล้มเหลว (เช่นเน็ตสะดุด) — เงียบไว้ ปล่อยให้บัตรที่โชว์อยู่ค้างข้อมูลเดิม
      // ดีกว่าดีดผู้ใช้ออกจากหน้าบัตรที่กำลังโชว์พนักงานเก็บเงินอยู่
    } finally {
      if (isBackground) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const liff = await loadLiffSdk();
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) {
          liff.login();
          return; // ⭐️ liff.login() นำทางออกจากหน้านี้ไป LINE login ก่อน — component จะ mount ใหม่ตอนกลับมา
        }
        const profile = await liff.getProfile();
        setLineUserId(profile.userId);
        await refreshMemberStatus(profile.userId, false);
      } catch (err: any) {
        setErrorMsg(err?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่ภายหลัง');
        setStage('error');
      }
    })();
  }, [refreshMemberStatus]);

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

      setStage('done');
      setTimeout(() => {
        const liff = (window as any).liff;
        if (liff?.closeWindow) liff.closeWindow();
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'ลงทะเบียนไม่สำเร็จ กรุณาลองใหม่');
      setStage('form');
    }
  }

  function closeLiff() {
    const liff = (window as any).liff;
    if (liff?.closeWindow) liff.closeWindow();
  }

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
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
              <button
                onClick={closeLiff}
                className="w-full py-3.5 bg-gradient-to-br from-brand to-brand-dark text-white font-bold rounded-full transition-all duration-150 active:scale-[0.98]"
              >
                ปิดหน้านี้
              </button>
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
              <button
                type="submit"
                disabled={stage === 'submitting'}
                className="w-full py-3.5 mt-2 bg-gradient-to-br from-brand to-brand-dark hover:opacity-95 text-white font-bold rounded-full transition-all duration-150 active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {stage === 'submitting' ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    กำลังลงทะเบียน...
                  </>
                ) : 'ยืนยันการลงทะเบียน'}
              </button>
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
    </div>
  );
}
