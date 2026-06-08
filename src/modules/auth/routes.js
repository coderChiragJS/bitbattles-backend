/**
 * Auth routes (PLAN.md §6). Mounted at /auth in app.js.
 *   POST /auth/signup       — customer signup (mobile app)
 *   POST /auth/login        — customer login (mobile app)
 *   POST /auth/admin/login  — admin login (admin panel)
 *   GET  /auth/me           — current user (any authenticated client)
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { signupSchema, loginSchema } from './schema.js';
import { authController } from './controller.js';

export const authRouter = Router();

authRouter.post('/signup', validate(signupSchema), authController.signup);
authRouter.post('/login', validate(loginSchema), authController.login);
authRouter.post('/admin/login', validate(loginSchema), authController.adminLogin);
authRouter.get('/me', requireAuth, authController.me);
