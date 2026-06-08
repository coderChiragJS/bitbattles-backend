/**
 * Auth business logic. Pure-ish: takes a `repo` dependency, throws ApiError on
 * failure, returns the same `{ token, user }` shape both clients expect
 * (AuthSession in quick_commerce/src/features/auth/types.ts).
 */
import { ApiError } from '../../utils/api-error.js';
import { newUserId } from '../../utils/ids.js';
import { signToken } from '../../utils/jwt.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';

/** Strip secrets/internal fields; map userId → id for the clients. */
function toPublicUser(user) {
  return {
    id: user.userId,
    mobile: user.mobile,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  };
}

function sessionFor(user) {
  const token = signToken({ sub: user.userId, role: user.role, mobile: user.mobile });
  return { token, user: toPublicUser(user) };
}

export function createAuthService(repo) {
  async function signup({ fullName, email, mobile, password }) {
    if (await repo.findByMobile(mobile)) {
      throw ApiError.conflict('An account with this mobile already exists', 'MOBILE_TAKEN');
    }

    const user = {
      userId: newUserId(),
      mobile,
      fullName,
      email,
      role: 'customer',
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };

    await repo.create(user);
    return sessionFor(user);
  }

  async function login({ mobile, password }) {
    const user = await repo.findByMobile(mobile);
    // Same generic error whether the user is missing or the password is wrong,
    // so we don't leak which mobiles are registered.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw ApiError.unauthorized('Invalid mobile or password', 'BAD_CREDENTIALS');
    }
    return sessionFor(user);
  }

  /** Admin login — same flow as login, then require the admin role. */
  async function adminLogin({ mobile, password }) {
    const user = await repo.findByMobile(mobile);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw ApiError.unauthorized('Invalid mobile or password', 'BAD_CREDENTIALS');
    }
    if (user.role !== 'admin') {
      throw ApiError.forbidden('This account is not an admin', 'NOT_ADMIN');
    }
    return sessionFor(user);
  }

  /** Resolve the authenticated user from a JWT subject (for GET /auth/me). */
  async function me(userId) {
    const user = await repo.findById(userId);
    if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
    return toPublicUser(user);
  }

  return { signup, login, adminLogin, me };
}
