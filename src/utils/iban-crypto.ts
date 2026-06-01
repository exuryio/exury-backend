import crypto from 'crypto';

function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

function encryptionKey(): Buffer {
  const secret =
    process.env.BANK_IBAN_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'exury-dev-iban-key-change-in-production';
  return crypto.createHash('sha256').update(secret).digest();
}

export function hashIban(iban: string): string {
  return crypto.createHash('sha256').update(normalizeIban(iban)).digest('hex');
}

export function encryptIban(iban: string): string {
  const normalized = normalizeIban(iban);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(normalized, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptIban(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export function maskIban(iban: string): string {
  const n = normalizeIban(iban);
  if (n.length <= 8) return n;
  return `${n.slice(0, 4)} **** **** ${n.slice(-4)}`;
}

export { normalizeIban };
