export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** The caller is doing too much at once; answered with 429 rather than 400. */
export class TooBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TooBusyError';
  }
}
