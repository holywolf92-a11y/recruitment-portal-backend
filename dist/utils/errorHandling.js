"use strict";
/**
 * Centralized error handling and logging utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.LogLevel = exports.UnauthorizedError = exports.DuplicateError = exports.NotFoundError = exports.ValidationError = exports.AppError = exports.ErrorType = void 0;
exports.createLogger = createLogger;
exports.errorHandler = errorHandler;
exports.asyncHandler = asyncHandler;
var ErrorType;
(function (ErrorType) {
    ErrorType["VALIDATION"] = "VALIDATION_ERROR";
    ErrorType["NOT_FOUND"] = "NOT_FOUND";
    ErrorType["DUPLICATE"] = "DUPLICATE_ERROR";
    ErrorType["UNAUTHORIZED"] = "UNAUTHORIZED";
    ErrorType["FORBIDDEN"] = "FORBIDDEN";
    ErrorType["DATABASE"] = "DATABASE_ERROR";
    ErrorType["EXTERNAL_SERVICE"] = "EXTERNAL_SERVICE_ERROR";
    ErrorType["INTERNAL"] = "INTERNAL_ERROR";
})(ErrorType || (exports.ErrorType = ErrorType = {}));
class AppError extends Error {
    constructor(message, type = ErrorType.INTERNAL, statusCode = 500, isOperational = true) {
        super(message);
        this.type = type;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.timestamp = new Date().toISOString();
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AppError = AppError;
class ValidationError extends AppError {
    constructor(message) {
        super(message, ErrorType.VALIDATION, 400);
    }
}
exports.ValidationError = ValidationError;
class NotFoundError extends AppError {
    constructor(resource) {
        super(`${resource} not found`, ErrorType.NOT_FOUND, 404);
    }
}
exports.NotFoundError = NotFoundError;
class DuplicateError extends AppError {
    constructor(message) {
        super(message, ErrorType.DUPLICATE, 409);
    }
}
exports.DuplicateError = DuplicateError;
class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(message, ErrorType.UNAUTHORIZED, 401);
    }
}
exports.UnauthorizedError = UnauthorizedError;
/**
 * Log levels
 */
var LogLevel;
(function (LogLevel) {
    LogLevel["ERROR"] = "error";
    LogLevel["WARN"] = "warn";
    LogLevel["INFO"] = "info";
    LogLevel["DEBUG"] = "debug";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
/**
 * Logger utility
 */
class Logger {
    constructor(context) {
        this.context = context;
    }
    formatMessage(level, message, meta) {
        const timestamp = new Date().toISOString();
        const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message}${metaStr}`;
    }
    error(message, error, meta) {
        console.error(this.formatMessage(LogLevel.ERROR, message, { ...meta, error: error?.message, stack: error?.stack }));
    }
    warn(message, meta) {
        console.warn(this.formatMessage(LogLevel.WARN, message, meta));
    }
    info(message, meta) {
        console.log(this.formatMessage(LogLevel.INFO, message, meta));
    }
    debug(message, meta) {
        if (process.env.NODE_ENV === 'development') {
            console.log(this.formatMessage(LogLevel.DEBUG, message, meta));
        }
    }
}
exports.Logger = Logger;
/**
 * Create logger instance for a specific context
 */
function createLogger(context) {
    return new Logger(context);
}
/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
    const logger = createLogger('ErrorHandler');
    // Log error
    if (err instanceof AppError) {
        logger.error(`${err.type}: ${err.message}`, err, {
            path: req.path,
            method: req.method,
            statusCode: err.statusCode,
        });
    }
    else {
        logger.error('Unexpected error', err, {
            path: req.path,
            method: req.method,
        });
    }
    // Send response
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            error: err.message,
            type: err.type,
            timestamp: err.timestamp,
        });
    }
    // Default error response
    return res.status(500).json({
        error: 'Internal server error',
        type: ErrorType.INTERNAL,
        timestamp: new Date().toISOString(),
    });
}
/**
 * Async handler wrapper to catch errors in async route handlers
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
