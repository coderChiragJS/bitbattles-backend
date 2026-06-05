/**
 * 404 + central error handler. Every error funnels through here. Known errors
 * (ApiError) map to their status; everything else is a logged 500.
 * Response shape matches what the clients parse: { error: { message, code } }.
 */
import { ApiError } from '../utils/api-error.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
export function errorHandler(err, req, res, next) {
  const log = req.log ?? console;

  if (err instanceof ApiError) {
    if (err.status >= 500) log.error({ err, code: err.code }, err.message);
    else log.warn({ code: err.code }, err.message);

    return res.status(err.status).json({
      error: {
        message: err.message,
        code: err.code,
        ...(err.details ? { issues: err.details } : {}),
      },
    });
  }

  log.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: { message: 'Internal server error', code: 'INTERNAL' },
  });
}
