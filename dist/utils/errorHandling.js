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
    safeStringify(value) {
        try {
            return JSON.stringify(value);
        }
        catch {
            return '[unserializable meta]';
        }
    }
    formatMessage(level, message, meta) {
        const timestamp = new Date().toISOString();
        const metaStr = meta ? ` | ${this.safeStringify(meta)}` : '';
        return `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message}${metaStr}`;
    }
    error(message, errorOrMeta, meta) {
        const baseMeta = meta && typeof meta === 'object' ? meta : {};
        // Backward-compatible overload:
        // - error(message, err, meta)
        // - error(message, meta)
        let errMessage;
        let errStack;
        let mergedMeta = { ...baseMeta };
        if (errorOrMeta instanceof Error) {
            errMessage = errorOrMeta.message;
            errStack = errorOrMeta.stack;
        }
        else if (typeof errorOrMeta === 'string') {
            errMessage = errorOrMeta;
        }
        else if (errorOrMeta && typeof errorOrMeta === 'object') {
            const maybeMessage = errorOrMeta.message;
            const maybeStack = errorOrMeta.stack;
            const looksLikeError = typeof maybeMessage === 'string' || typeof maybeStack === 'string';
            if (looksLikeError) {
                errMessage = typeof maybeMessage === 'string' ? maybeMessage : undefined;
                errStack = typeof maybeStack === 'string' ? maybeStack : undefined;
            }
            else {
                mergedMeta = { ...errorOrMeta, ...mergedMeta };
            }
        }
        else if (errorOrMeta != null) {
            errMessage = String(errorOrMeta);
        }
        console.error(this.formatMessage(LogLevel.ERROR, message, {
            ...mergedMeta,
            error: errMessage,
            stack: errStack,
        }));
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
    // Ensure CORS headers are set for all error responses
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    // Handle Multer errors (file upload errors)
    if (err.code && err.code.startsWith('LIMIT_')) {
        logger.error(`Multer error: ${err.code}`, err, {
            path: req.path,
            method: req.method,
        });
        let message = 'File upload error';
        let statusCode = 400;
        switch (err.code) {
            case 'LIMIT_FILE_SIZE':
                message = 'File too large. Maximum file size is 10MB.';
                statusCode = 413;
                break;
            case 'LIMIT_FILE_COUNT':
                message = 'Too many files uploaded.';
                statusCode = 400;
                break;
            case 'LIMIT_UNEXPECTED_FILE':
                message = 'Unexpected file field.';
                statusCode = 400;
                break;
            default:
                message = err.message || 'File upload error';
        }
        return res.status(statusCode).json({
            error: message,
            type: ErrorType.VALIDATION,
            code: err.code,
            timestamp: new Date().toISOString(),
        });
    }
    // Handle file filter errors (from multer fileFilter)
    if (err.message && err.message.includes('Invalid file type')) {
        logger.error('File type validation error', err, {
            path: req.path,
            method: req.method,
        });
        return res.status(400).json({
            error: err.message,
            type: ErrorType.VALIDATION,
            timestamp: new Date().toISOString(),
        });
    }
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
    // Handle thrown errors with statusCode (from upload validation, etc.)
    if (err.statusCode && typeof err.statusCode === 'number') {
        return res.status(err.statusCode).json({
            error: err.message || 'Request failed',
            type: err.type || 'VALIDATION_ERROR',
            timestamp: new Date().toISOString(),
        });
    }
    // Send response for AppError
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
