import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import api from '../api';
import customSwal from '../swal';

// ⭐️ ตรงกับ backend จริง: GET /api/auth/reset-token/:token, POST /api/auth/reset-password { reset_token, new_password }
// เงื่อนไขรหัสผ่าน (ต้องตรงกับ regex ฝั่ง backend): 8+ ตัวอักษร, มีพิมพ์เล็ก, พิมพ์ใหญ่, ตัวเลข

type TokenState = 'checking' | 'valid' | 'invalid';

function passwordChecks(pw: string) {
  return {
    length: pw.length >= 8,
    lower: /[a-z]/.test(pw),
    upper: /[A-Z]/.test(pw),
    digit: /\d/.test(pw),
  };
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [tokenState, setTokenState] = useState<TokenState>('checking');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) { setTokenState('invalid'); return; }
    api.get(`/auth/reset-token/${token}`)
      .then(res => setTokenState(res.data?.valid ? 'valid' : 'invalid'))
      .catch(() => setTokenState('invalid'));
  }, [token]);

  const checks = passwordChecks(password);
  const isStrong = checks.length && checks.lower && checks.upper && checks.digit;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isStrong) return;
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { reset_token: token, new_password: password });
      await customSwal.fire({ icon: 'success', title: 'ตั้งรหัสผ่านใหม่สำเร็จ', text: 'กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' });
      navigate('/login');
    } catch (err: any) {
      customSwal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.response?.data?.error || 'ไม่สามารถตั้งรหัสผ่านใหม่ได้' });
    } finally {
      setLoading(false);
    }
  };

  const CheckRow = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className={`flex items-center gap-1.5 text-xs ${ok ? 'text-green-600' : 'text-gray-400'}`}>
      {ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {label}
    </div>
  );

  return (
    <div className="min-h-dvh bg-brand-bg flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center mb-4 shadow-lg">
            <Lock size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">ตั้งรหัสผ่านใหม่</h1>
        </div>

        <div className="bg-white border border-brand-border rounded-3xl shadow-sm p-6">
          {tokenState === 'checking' && (
            <p className="text-center text-sm text-gray-500 font-medium py-4">กำลังตรวจสอบลิงก์...</p>
          )}

          {tokenState === 'invalid' && (
            <div className="text-center py-4">
              <p className="text-sm text-red-600 font-medium">ลิงก์นี้ไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว</p>
              <Link to="/forgot-password" className="mt-4 inline-block text-sm text-brand font-semibold hover:underline">
                ขอลิงก์ใหม่
              </Link>
            </div>
          )}

          {tokenState === 'valid' && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">รหัสผ่านใหม่</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'} required value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 pr-12 rounded-2xl border border-brand-border bg-brand-bg text-sm font-medium text-gray-800 placeholder:text-gray-400 transition-colors duration-150 focus:outline-none focus:border-brand focus:bg-white"
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand transition-colors duration-150 p-1">
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* ⭐️ Password strength indicator */}
              <div className="grid grid-cols-2 gap-1.5 px-1">
                <CheckRow ok={checks.length} label="8+ ตัวอักษร" />
                <CheckRow ok={checks.upper} label="ตัวพิมพ์ใหญ่" />
                <CheckRow ok={checks.lower} label="ตัวพิมพ์เล็ก" />
                <CheckRow ok={checks.digit} label="ตัวเลข" />
              </div>

              <button
                type="submit" disabled={loading || !isStrong}
                className="w-full py-3.5 mt-1 rounded-2xl text-white font-bold text-sm transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed
                  enabled:bg-gradient-to-br enabled:from-brand enabled:to-brand-dark disabled:bg-brand-border
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    กำลังบันทึก...
                  </span>
                ) : 'ตั้งรหัสผ่านใหม่'}
              </button>
            </form>
          )}
        </div>

        <Link to="/login" className="mt-6 flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-brand font-medium transition-colors duration-150">
          <ArrowLeft size={14} /> กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </div>
  );
}
