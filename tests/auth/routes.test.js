import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

/**
 * Route-level checks that never reach DynamoDB: validation and token guards
 * both short-circuit before the repo. (Full signup/login happy paths live in
 * service.test.js against a fake repo, and in the integration suite vs
 * DynamoDB Local.)
 */
describe('auth routes — guards', () => {
  const app = createApp();

  it('rejects signup with a short password (400 VALIDATION)', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ fullName: 'Bo', mobile: '9876543210', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects login with a missing mobile (400 VALIDATION)', async () => {
    const res = await request(app).post('/auth/login').send({ password: 'longenough' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects /auth/me without a token (401 NO_TOKEN)', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_TOKEN');
  });

  it('rejects /auth/me with a malformed token (401 TOKEN_INVALID)', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});
