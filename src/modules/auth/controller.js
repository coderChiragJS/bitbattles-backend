/**
 * HTTP glue for the auth module — thin: no business logic, just wires the
 * validated request to the service and shapes the response. Wraps async
 * handlers so thrown ApiErrors reach the central error handler.
 */
import { createAuthService } from './service.js';
import { usersRepo } from './repo.js';

const service = createAuthService(usersRepo);

const handle = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export const authController = {
  signup: handle(async (req, res) => {
    res.status(201).json(await service.signup(req.body));
  }),

  login: handle(async (req, res) => {
    res.json(await service.login(req.body));
  }),

  adminLogin: handle(async (req, res) => {
    res.json(await service.adminLogin(req.body));
  }),

  me: handle(async (req, res) => {
    res.json({ user: await service.me(req.user.id) });
  }),
};
