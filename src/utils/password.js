/**
 * Password hashing. Thin wrapper over bcryptjs so call sites never touch the
 * round count directly (it comes from env).
 */
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

export function hashPassword(plain) {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
