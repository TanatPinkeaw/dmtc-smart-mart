/**
 * ⭐️ Sprint 2 — B9: File Upload Validation
 * Client-side validators for payment slips and shift photos
 */

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  file?: File;
  dimensions?: { width: number; height: number };
}

/**
 * Validate payment slip for PreOrder
 * - Type: JPG, PNG, GIF, WebP
 * - Size: max 5 MB
 * - Dimensions: 400×300 to 4000×3000
 */
export async function validatePaymentSlip(file: File): Promise<FileValidationResult> {
  // Type check
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Only JPG, PNG, GIF, WebP allowed' };
  }

  // Size check (5 MB max)
  if (file.size > 5 * 1024 * 1024) {
    return { valid: false, error: 'File too large (max 5 MB)' };
  }

  // Dimension check
  const dimensions = await getImageDimensions(file);
  if (!dimensions) {
    return { valid: false, error: 'Could not read image dimensions' };
  }

  if (dimensions.width < 400 || dimensions.height < 300) {
    return { valid: false, error: `Image too small (min 400×300, got ${dimensions.width}×${dimensions.height})` };
  }

  if (dimensions.width > 4000 || dimensions.height > 3000) {
    return { valid: false, error: `Image too large (max 4000×3000, got ${dimensions.width}×${dimensions.height})` };
  }

  return { valid: true, file, dimensions };
}

/**
 * Validate shift close photo for POS
 * - Type: JPG, PNG only
 * - Size: max 10 MB
 * - Dimensions: min 800×600
 */
export async function validateShiftPhoto(file: File): Promise<FileValidationResult> {
  // Type check (JPG, PNG only)
  const allowedTypes = ['image/jpeg', 'image/png'];
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Only JPG or PNG allowed for shift photos' };
  }

  // Size check (10 MB max)
  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: 'File too large (max 10 MB)' };
  }

  // Dimension check
  const dimensions = await getImageDimensions(file);
  if (!dimensions) {
    return { valid: false, error: 'Could not read image dimensions' };
  }

  if (dimensions.width < 800 || dimensions.height < 600) {
    return { valid: false, error: `Image too small (min 800×600, got ${dimensions.width}×${dimensions.height})` };
  }

  return { valid: true, file, dimensions };
}

/**
 * Helper: Get image dimensions from File object
 * Returns Promise<{width, height}> or null if image cannot be read
 */
export async function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}
