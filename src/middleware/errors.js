export class HttpError extends Error {
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
export const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    const expected = err instanceof HttpError;
    if (!expected) console.error(err);

    res.status(status).json({
        error: err.code || (status >= 500 ? 'server_error' : 'error'),
        message: expected || status < 500 ? err.message : 'Internal server error'
    });
}