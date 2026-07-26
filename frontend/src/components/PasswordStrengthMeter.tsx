import { validatePasswordStrength } from '../utils/passwordValidator';

interface PasswordStrengthMeterProps {
  password: string;
}

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const { valid, errors, strength, score } = validatePasswordStrength(password);

  const strengthColors = {
    weak: 'bg-red-500',
    fair: 'bg-yellow-500',
    good: 'bg-blue-500',
    strong: 'bg-green-500'
  };

  const strengthLabels = {
    weak: 'อ่อน',
    fair: 'พอใช้',
    good: 'ดี',
    strong: 'แข็งแรง'
  };

  return (
    <div className="mt-2 space-y-2">
      {/* Strength Bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full ${strengthColors[strength]} transition-all duration-300`}
            style={{ width: `${(score / 7) * 100}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-gray-700 whitespace-nowrap">
          {strengthLabels[strength]}
        </span>
      </div>

      {/* Requirements List */}
      <div className="text-xs space-y-1">
        {errors.length > 0 && (
          <div className="text-red-600 space-y-0.5">
            {errors.map((err, i) => (
              <p key={i} className="flex items-center gap-1">
                <span className="text-red-500">×</span> {err}
              </p>
            ))}
          </div>
        )}

        {/* Show what's satisfied */}
        {password && (
          <div className="text-gray-600 space-y-0.5 pt-1">
            {password.length >= 8 && (
              <p className="flex items-center gap-1 text-green-600">
                <span className="text-green-500">✓</span> ยาวอย่างน้อย 8 ตัวอักษร
              </p>
            )}
            {/[A-Z]/.test(password) && (
              <p className="flex items-center gap-1 text-green-600">
                <span className="text-green-500">✓</span> มีตัวพิมพ์ใหญ่
              </p>
            )}
            {/[a-z]/.test(password) && (
              <p className="flex items-center gap-1 text-green-600">
                <span className="text-green-500">✓</span> มีตัวพิมพ์เล็ก
              </p>
            )}
            {/[0-9]/.test(password) && (
              <p className="flex items-center gap-1 text-green-600">
                <span className="text-green-500">✓</span> มีตัวเลข
              </p>
            )}
            {/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) && (
              <p className="flex items-center gap-1 text-green-600">
                <span className="text-green-500">✓</span> มีอักขระพิเศษ (คะแนนโบนัส)
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
