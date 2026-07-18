import { useEffect, useState } from 'react';
import api from '../api';

// ⭐️ SECURITY FIX (วิกฤต #1) — เดิมรูปสลิป/รูปเข้างานโหลดด้วย <img src="http://localhost:3000/uploads/...">
// ตรงๆ ซึ่งไม่ได้แนบ JWT (browser <img> ไม่ผ่าน axios) หลังล็อก /uploads ให้ต้อง auth แล้ว
// ต้องโหลดผ่าน api (แนบ Bearer token อัตโนมัติ) เป็น blob แล้วแปลงเป็น object URL มาแสดงแทน
//
// path = ค่าที่เก็บใน DB เช่น "/uploads/slips/2026-07-18/xxx.jpg"
type Props = {
  path?: string | null;
  alt?: string;
  className?: string;
  onClick?: () => void;
  fallback?: React.ReactNode; // แสดงตอนไม่มี path / โหลดพลาด
};

export default function AuthImage({ path, alt = '', className, onClick, fallback = null }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let objectUrl: string | null = null;
    let cancelled = false;
    setError(false);

    api.get('/media', { params: { path }, responseType: 'blob' })
      .then(res => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setError(true); });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl); // กัน memory leak
    };
  }, [path]);

  if (!path || error) return <>{fallback}</>;
  if (!url) {
    // สถานะกำลังโหลด — skeleton จางๆ
    return <div className={`animate-pulse bg-gray-100 ${className || ''}`} />;
  }
  return <img src={url} alt={alt} className={className} onClick={onClick} />;
}

// ⭐️ helper — เปิดรูปในแท็บใหม่ (แทน window.open ตรงๆ ที่ browser จะ 401 เพราะไม่มี token)
export async function openAuthImage(path: string) {
  try {
    const res = await api.get('/media', { params: { path }, responseType: 'blob' });
    const objectUrl = URL.createObjectURL(res.data);
    window.open(objectUrl, '_blank');
    // ปล่อย object URL ทีหลังเพื่อให้แท็บใหม่โหลดทัน
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    /* เงียบไว้ — รูปโหลดไม่ได้ */
  }
}
