"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookLoggingMiddleware = webhookLoggingMiddleware;
exports.webhookErrorMonitor = webhookErrorMonitor;
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('WebhookLogger');
const logContexts = new WeakMap();
function sanitizePayload(payload, depth = 0) {
    if (depth > 5 || !payload)
        return payload;
    const sensitiveKeys = [
        'token',
        'secret',
        'key',
        'password',
        'auth',
        'authorization',
        'credentials',
        'access_token',
        'refresh_token',
        'api_key',
    ];
    if (typeof payload === 'object') {
        if (Array.isArray(payload)) {
            return payload.slice(0, 3).map((item) => sanitizePayload(item, depth + 1));
        }
        const sanitized = {};
        for (const [key, value] of Object.entries(payload)) {
            if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
                sanitized[key] = '[REDACTED]';
            }
            else {
                sanitized[key] = sanitizePayload(value, depth + 1);
            }
        }
        return sanitized;
    }
    return payload;
}
function webhookLoggingMiddleware(source) {
    return (req, res, next) => {
        const requestId = `${source}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const context = {
            path: req.path,
            method: req.method,
            ip: req.ip || 'unknown',
            source,
            startTime: Date.now(),
            requestId,
        };
        logContexts.set(req, context);
        // Log incoming request
        logger.info(`${source} webhook received`, {
            requestId,
            method: req.method,
            path: req.path,
            ip: req.ip,
            headers: {
                contentType: req.headers['content-type'],
                contentLength: req.headers['content-length'],
                ...(req.headers['x-hub-signature-256'] && { hasSignature: true }),
            },
        });
        // Capture response
        const originalJson = res.json.bind(res);
        res.json = function (body) {
            const duration = Date.now() - context.startTime;
            logger.info(`${source} webhook response`, {
                requestId,
                statusCode: res.statusCode,
                durationMs: duration,
                responseSize: JSON.stringify(body).length,
            });
            return originalJson(body);
        };
        // Handle errors
        res.on('finish', () => {
            if (res.statusCode >= 400) {
                const duration = Date.now() - context.startTime;
                logger.warn(`${source} webhook error`, {
                    requestId,
                    statusCode: res.statusCode,
                    durationMs: duration,
                    path: req.path,
                    ip: req.ip,
                });
            }
        });
        next();
    };
}
function webhookErrorMonitor(source) {
    return (err, req, res, next) => {
        const context = logContexts.get(req);
        const duration = context ? Date.now() - context.startTime : 0;
        logger.error(`${source} webhook error`, err, {
            requestId: context?.requestId,
            path: req.path,
            ip: req.ip,
            durationMs: duration,
            errorType: err.type,
            errorMessage: err.message,
        });
        next(err);
    };
}
