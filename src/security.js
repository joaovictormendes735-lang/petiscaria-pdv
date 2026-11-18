import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb);
export const token = () => randomBytes(32).toString('hex');
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${salt}:${derived.toString('hex')}`;
}
export async function passwordVerify(password, encoded) {
  const [method, salt, encodedKey] = encoded.split(':');
  if (method !== 'scrypt' || !salt || !encodedKey) return false;
  const key = Buffer.from(encodedKey, 'hex');
  const candidate = await scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return key.length === candidate.length && timingSafeEqual(key, candidate);
}
export const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
