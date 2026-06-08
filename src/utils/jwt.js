/**
 * JWT signing/verification. HS256, secret + expiry from env.
 * Payload shape (PLAN.md §5): { sub: userId, role, mobile }.
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from './api-error.js';

export function signToken({ sub, role, mobile }) {
  return jwt.sign({ sub, role, mobile }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw ApiError.unauthorized('Invalid or expired token', 'TOKEN_INVALID');
  }
}
