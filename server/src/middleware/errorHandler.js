import { redactUrl } from '../utils/redactUrl.js';

/**
 * The single place an error becomes a response.
 *
 * `_next` is unused but must stay: Express identifies error middleware by arity, and
 * dropping the fourth parameter turns this into ordinary middleware that never runs.
 */
/**
 * Errors raised before any route runs — by the JSON body parser — carry their own 4xx
 * status. Without this they fell through as 500 "Internal Server Error": a typo in a
 * body, or a file over the size limit, looked like the server had crashed.
 */
const PARSER_MESSAGES = {
  'entity.parse.failed': 'The request body is not valid JSON.',
  'entity.too.large': 'The request is too large. Files in a form body can add up to 5 MB.',
  'encoding.unsupported': 'The request body uses an unsupported encoding.',
  'charset.unsupported': 'The request body uses an unsupported character set.',
};

function statusFor(err, res) {
  if (res.statusCode && res.statusCode !== 200) return res.statusCode;
  const own = err.status ?? err.statusCode;
  return Number.isInteger(own) && own >= 400 && own < 500 ? own : 500;
}

export function errorHandler(err, req, res, _next) {
  const statusCode = statusFor(err, res);
  const isProduction = process.env.NODE_ENV === 'production';
  if (PARSER_MESSAGES[err.type]) err.message = PARSER_MESSAGES[err.type];

  // The full detail always goes to the server log, whatever the client is told.
  console.error(`[error] ${req.method} ${redactUrl(req.originalUrl)} -> ${err.message}`);

  // A 4xx message is deliberate and written for the user ("Invalid environment id."),
  // so it is always safe to return. A 5xx message is not: it is whatever the failing
  // library happened to say, and can carry connection strings, absolute paths or
  // schema details. In production those are replaced with something generic, while
  // development keeps them so the cause is visible while working.
  const isServerError = statusCode >= 500;
  const message =
    isProduction && isServerError
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';

  res.status(statusCode).json({
    status: 'error',
    message,
    // A short, stable reason the client can act on (e.g. NOT_A_MEMBER), only ever set
    // deliberately on 4xx errors — never a library's internal error code.
    ...(!isServerError && typeof err.code === 'string' && /^[A-Z_]+$/.test(err.code) ? { code: err.code } : {}),
    ...(isProduction ? {} : { stack: err.stack }),
  });
}
