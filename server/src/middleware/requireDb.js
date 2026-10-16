import mongoose from 'mongoose';

// Fails fast with a clear message instead of letting Mongoose buffer the query
// until its default (10s) buffering timeout expires.
export function requireDb(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      status: 'error',
      message: 'Database is not connected. This feature requires a working MongoDB connection.',
    });
  }
  next();
}
