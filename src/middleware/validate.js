/**
 * validate({ body, params, query }) — each value is an optional zod schema.
 * On success, req[key] is replaced with the parsed (coerced) data.
 * On failure, forwards a 400 ApiError with the zod issues attached.
 */
import { ApiError } from '../utils/api-error.js';

export function validate(schemas) {
  return (req, _res, next) => {
    for (const key of ['body', 'params', 'query']) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        return next(
          ApiError.badRequest('Validation failed', 'VALIDATION', result.error.issues),
        );
      }
      req[key] = result.data;
    }
    next();
  };
}
