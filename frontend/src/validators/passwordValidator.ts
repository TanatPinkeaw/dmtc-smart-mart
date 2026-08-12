// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 validators/passwordValidator.ts — ตรวจความแข็งแรงของรหัสผ่าน (ฝั่ง frontend)
// ทำอะไร: รับรหัสผ่าน คืน { valid, errors[], strength, score } — ใช้ในหน้าเปลี่ยนรหัส/ตั้งรหัสใหม่
//   คู่กับ PasswordStrengthMeter.tsx โชว์แถบความแข็งแรง + บอกว่าต้องแก้อะไร
// ═══════════════════════════════════════════════════════════════════════════════════
export interface PasswordStrengthResult {
  valid: boolean;
  errors: string[];
  strength: 'weak' | 'fair' | 'good' | 'strong';
  score: number;
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const errors: string[] = [];
  let score = 0;

  // ⭐️ ข้อความทั้งหมดเป็นภาษาไทย — errors ถูกโชว์ตรงๆ ให้ผู้ใช้เห็นใน PasswordStrengthMeter
  //   และ Swal ของ ChangePasswordModal (เดิมเป็นอังกฤษล้วนทั้งที่ทั้งแอปเป็นไทย)
  if (!password) {
    return { valid: false, errors: ['กรุณากรอกรหัสผ่าน'], strength: 'weak', score: 0 };
  }

  // Length checks
  if (password.length >= 8) score++;
  else errors.push('ยาวอย่างน้อย 8 ตัวอักษร');

  if (password.length >= 12) score++;
  if (password.length >= 16) score++;

  // Uppercase
  if (/[A-Z]/.test(password)) score++;
  else errors.push('มีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว (A-Z)');

  // Lowercase
  if (/[a-z]/.test(password)) score++;
  else errors.push('มีตัวพิมพ์เล็กอย่างน้อย 1 ตัว (a-z)');

  // Numbers
  if (/[0-9]/.test(password)) score++;
  else errors.push('มีตัวเลขอย่างน้อย 1 ตัว (0-9)');

  // Special chars (bonus)
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score++;

  // Determine strength
  let strength: 'weak' | 'fair' | 'good' | 'strong' = 'weak';
  if (score <= 2) strength = 'weak';
  else if (score <= 4) strength = 'fair';
  else if (score <= 6) strength = 'good';
  else strength = 'strong';

  return {
    valid: errors.length === 0,
    errors,
    strength,
    score
  };
}
