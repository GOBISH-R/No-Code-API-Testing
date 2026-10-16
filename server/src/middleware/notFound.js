import { redactUrl } from '../utils/redactUrl.js';

export function notFound(req, res, next) {
  res.status(404);
  next(new Error(`Route not found: ${req.method} ${redactUrl(req.originalUrl)}`));
}
