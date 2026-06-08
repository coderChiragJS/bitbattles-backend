import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthService } from '../../src/modules/auth/service.js';
import { verifyToken } from '../../src/utils/jwt.js';

/** In-memory stand-in for the DynamoDB users repo. */
function makeFakeRepo(seed = []) {
  const byId = new Map(seed.map((u) => [u.userId, u]));
  return {
    store: byId,
    async findByMobile(mobile) {
      return [...byId.values()].find((u) => u.mobile === mobile) ?? null;
    },
    async findById(userId) {
      return byId.get(userId) ?? null;
    },
    async create(user) {
      byId.set(user.userId, user);
      return user;
    },
  };
}

const signupInput = {
  fullName: 'Asha Rao',
  email: 'asha@example.com',
  mobile: '9876543210',
  password: 'supersecret',
};

describe('auth service', () => {
  let repo;
  let service;

  beforeEach(() => {
    repo = makeFakeRepo();
    service = createAuthService(repo);
  });

  it('signup creates a hashed user and returns a valid session', async () => {
    const { token, user } = await service.signup(signupInput);

    expect(user.id).toMatch(/^usr_/);
    expect(user.mobile).toBe(signupInput.mobile);
    expect(user.role).toBe('customer');
    expect(user).not.toHaveProperty('passwordHash');

    // Password is stored hashed, never in plaintext.
    const stored = repo.store.get(user.id);
    expect(stored.passwordHash).toBeDefined();
    expect(stored.passwordHash).not.toBe(signupInput.password);

    // Token carries the right claims.
    const claims = verifyToken(token);
    expect(claims.sub).toBe(user.id);
    expect(claims.role).toBe('customer');
    expect(claims.mobile).toBe(signupInput.mobile);
  });

  it('signup rejects a duplicate mobile', async () => {
    await service.signup(signupInput);
    await expect(service.signup(signupInput)).rejects.toMatchObject({
      status: 409,
      code: 'MOBILE_TAKEN',
    });
  });

  it('login succeeds with the correct password', async () => {
    await service.signup(signupInput);
    const { token, user } = await service.login({
      mobile: signupInput.mobile,
      password: signupInput.password,
    });
    expect(user.mobile).toBe(signupInput.mobile);
    expect(verifyToken(token).sub).toBe(user.id);
  });

  it('login fails with a wrong password (generic error)', async () => {
    await service.signup(signupInput);
    await expect(
      service.login({ mobile: signupInput.mobile, password: 'wrongpass1' }),
    ).rejects.toMatchObject({ status: 401, code: 'BAD_CREDENTIALS' });
  });

  it('login fails for an unknown mobile with the same generic error', async () => {
    await expect(
      service.login({ mobile: '0000000000', password: 'whatever1' }),
    ).rejects.toMatchObject({ status: 401, code: 'BAD_CREDENTIALS' });
  });

  it('adminLogin rejects a customer account', async () => {
    await service.signup(signupInput);
    await expect(
      service.adminLogin({ mobile: signupInput.mobile, password: signupInput.password }),
    ).rejects.toMatchObject({ status: 403, code: 'NOT_ADMIN' });
  });

  it('adminLogin succeeds for an admin account', async () => {
    repo = makeFakeRepo();
    service = createAuthService(repo);
    // Seed an admin via signup then promote (mirrors the bootstrap script).
    const { user } = await service.signup({ ...signupInput, mobile: '1112223334' });
    repo.store.get(user.id).role = 'admin';

    const { token } = await service.adminLogin({
      mobile: '1112223334',
      password: signupInput.password,
    });
    expect(verifyToken(token).role).toBe('admin');
  });

  it('me returns the public user for a known id', async () => {
    const { user } = await service.signup(signupInput);
    const me = await service.me(user.id);
    expect(me.id).toBe(user.id);
    expect(me).not.toHaveProperty('passwordHash');
  });

  it('me throws 404 for an unknown id', async () => {
    await expect(service.me('usr_missing')).rejects.toMatchObject({ status: 404 });
  });
});
