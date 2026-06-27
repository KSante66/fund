import 'server-only';
import crypto from 'crypto';

const hashAlgorithm = 'sha256';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return `${hashAlgorithm}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== hashAlgorithm) return false;
  const hash = crypto.createHash('sha256').update(parts[1] + password).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(hash));
}
