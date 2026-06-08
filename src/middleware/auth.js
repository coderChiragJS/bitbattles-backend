/**
 * Auth middleware.
 *   requireAuth        — verifies the Bearer JWT, attaches req.user.
 *   requireRole(role)  — gates a route on req.user.role (use after requireAuth).
 * req.user shape: { id, role, mobile }.
 */
import { ApiError } from '../utils/api-error.js';
import { verifyToken } from '../utils/jwt.js';

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing bearer token', 'NO_TOKEN'));
  }

  const claims = verifyToken(token);
  req.user = { id: claims.sub, role: claims.role, mobile: claims.mobile };
  next();
}

export function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role !== role) {
      return next(ApiError.forbidden('Insufficient permissions', 'FORBIDDEN_ROLE'));
    }
    next();
  };
}
