export interface PasswordStrengthResult {
  valid: boolean;
  errors: string[];
  strength: 'weak' | 'fair' | 'good' | 'strong';
  score: number;
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const errors: string[] = [];
  let score = 0;

  if (!password) {
    return { valid: false, errors: ['Password is required'], strength: 'weak', score: 0 };
  }

  // Length checks
  if (password.length >= 8) score++;
  else errors.push('At least 8 characters');

  if (password.length >= 12) score++;
  if (password.length >= 16) score++;

  // Uppercase
  if (/[A-Z]/.test(password)) score++;
  else errors.push('At least 1 uppercase letter (A-Z)');

  // Lowercase
  if (/[a-z]/.test(password)) score++;
  else errors.push('At least 1 lowercase letter (a-z)');

  // Numbers
  if (/[0-9]/.test(password)) score++;
  else errors.push('At least 1 number (0-9)');

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
