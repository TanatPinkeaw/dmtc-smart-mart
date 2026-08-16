// 📄 components/common/AuthImage.tsx — แสดงรูปที่ต้องล็อกอินก่อนถึงจะดูได้ (สลิป/รูปเข้างาน)
//    ทำอะไร: โหลดรูปผ่าน api (แนบ cookie อัตโนมัติ) เป็น blob แล้วแปลงเป็น object URL มาแสดง — เพราะ
//    <img src> ธรรมดาไม่แนบ auth = โดน 401; รูป Cloudinary (URL เต็ม) แสดงตรงได้ ไม่ต้องผ่าน api
import { useEffect, useState } from 'react';
import api from '../../api';
import { isFullUrl } from '../../utils/openAuthImage'; // ⭐️ ย้าย helper ออกให้ react-refresh ผ่าน (ดู utils/openAuthImage.ts)

// ⭐️ SECURITY FIX (วิกฤต #1) — เดิมรูปสลิป/รูปเข้างานโหลดด้วย <img src="http://localhost:3000/uploads/...">
// ตรงๆ ซึ่งไม่ได้แนบ JWT (browser <img> ไม่ผ่าน axios) หลังล็อก /uploads ให้ต้อง auth แล้ว
// ต้องโหลดผ่าน api (แนบ httpOnly cookie อัตโนมัติผ่าน withCredentials) เป็น blob แล้วแปลงเป็น object URL มาแสดงแทน
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
    // ⭐️ reset state ทันทีเมื่อ path เปลี่ยน (โชว์ skeleton แทนรูปเก่า) — เป็นการ sync state กับ prop
    // ที่เปลี่ยน ตามจุดประสงค์ของ effect (ไม่ใช่บัค/loop — setState ถัดๆ ไปอยู่ใน async callback ทั้งหมด)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!path) { setUrl(null); return; }
    // รูป Cloudinary (URL เต็ม) — ใช้ src ตรงๆ ไม่ต้อง fetch blob
    if (isFullUrl(path)) { setUrl(path); setError(false); return; }

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
