/**
 * Centralized error handling and logging utilities
 */

export enum ErrorType {
  VALIDATION = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  DUPLICATE = 'DUPLICATE_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  DATABASE = 'DATABASE_ERROR',
  EXTERNAL_SERVICE = 'EXTERNAL_SERVICE_ERROR',
  INTERNAL = 'INTERNAL_ERROR',
}

export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly timestamp: string;

  constructor(
    message: string,
    type: ErrorType = ErrorType.INTERNAL,
    statusCode: number = 500,
    isOperational: boolean = true
  ) {
    super(message);
    
    this.type = type;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, ErrorType.VALIDATION, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, ErrorType.NOT_FOUND, 404);
  }
}

export class DuplicateError extends AppError {
  constructor(message: string) {
    super(message, ErrorType.DUPLICATE, 409);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, ErrorType.UNAUTHORIZED, 401);
  }
}

/**
 * Log levels
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

/**
 * Logger utility
 */
export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message}${metaStr}`;
  }

  error(message: string, error?: Error | any, meta?: any): void {
    console.error(this.formatMessage(LogLevel.ERROR, message, { ...meta, error: error?.message, stack: error?.stack }));
  }

  warn(message: string, meta?: any): void {
    console.warn(this.formatMessage(LogLevel.WARN, message, meta));
  }

  info(message: string, meta?: any): void {
    console.log(this.formatMessage(LogLevel.INFO, message, meta));
  }

  debug(message: string, meta?: any): void {
    if (process.env.NODE_ENV === 'development') {
      console.log(this.formatMessage(LogLevel.DEBUG, message, meta));
    }
  }
}

/**
 * Create logger instance for a specific context
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}

/**
 * Global error handler middleware
 */
export function errorHandler(err: any, req: any, res: any, next: any) {
  const logger = createLogger('ErrorHandler');

  // Log error
  if (err instanceof AppError) {
    logger.error(`${err.type}: ${err.message}`, err, {
      path: req.path,
      method: req.method,
      statusCode: err.statusCode,
    });
  } else {
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
export function asyncHandler(fn: Function) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
