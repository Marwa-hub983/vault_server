import multer from 'multer';
import { ZodError } from 'zod';

// An error we throw on purpose, with an HTTP status the client should see.
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Express 4 does not catch errors from async functions by itself.
// This wrapper sends them to the error handler below.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Must have 4 parameters so Express knows it is the error handler.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // zod: request data was invalid
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid request', details: err.issues });
  }
  // multer: upload problems (file too large, too many files, ...)
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.code, message: err.message });
  }

  const status = err.status || 500;
  const expected = err instanceof HttpError;
  if (!expected) console.error(err); // log unexpected bugs

  res.status(status).json({
    error: err.code || (status >= 500 ? 'server_error' : 'error'),
    message: expected || status < 500 ? err.message : 'Internal server error',
  });
}