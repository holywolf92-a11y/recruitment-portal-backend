"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idempotencyMiddleware = idempotencyMiddleware;
const idempotencyService_1 = require("../services/idempotencyService");
const errorHandling_1 = require("../utils/errorHandling");
const hashing_1 = require("../utils/hashing");
const logger = (0, errorHandling_1.createLogger)('IdempotencyMiddleware');
function idempotencyMiddleware(options) {
    return async function handleIdempotency(req, res, next) {
        const idempotencyKey = options.keyFromRequest
            ? options.keyFromRequest(req)
            : req.headers['x-idempotency-key'];
        if (!idempotencyKey) {
            return next(new errorHandling_1.AppError('Missing idempotency key', errorHandling_1.ErrorType.VALIDATION, 400));
        }
        const keyHash = (0, idempotencyService_1.generateKeyHash)(idempotencyKey);
        const requestHash = (0, hashing_1.hashRequest)(req.body ?? {});
        const attachmentHash = options.attachmentHashFromRequest?.(req);
        try {
            // If exists, return cached or appropriate status
            const existing = await (0, idempotencyService_1.checkIdempotency)(keyHash, requestHash);
            if (existing.exists) {
                if (existing.status === 'completed') {
                    return res.status(existing.responseStatus || 200).json(existing.responseBody ?? {});
                }
                if (existing.status === 'failed') {
                    return res.status(409).json({ error: 'Previous request failed', details: existing.error });
                }
                return res.status(202).json({ status: 'pending' });
            }
            // Create pending record
            await (0, idempotencyService_1.createIdempotencyKey)(keyHash, options.resourceType, requestHash, attachmentHash);
            // Auto-mark completion on successful json responses
            const originalJson = res.json.bind(res);
            res.json = ((body) => {
                // Fire and forget to avoid blocking the response
                void (0, idempotencyService_1.markIdempotencyComplete)(keyHash, body, res.statusCode || 200).catch((err) => {
                    logger.error('Failed to mark idempotency complete', err);
                });
                return originalJson(body);
            });
            // Auto-mark failures on non-2xx responses
            res.on('finish', () => {
                if (res.statusCode >= 400) {
                    void (0, idempotencyService_1.markIdempotencyFailed)(keyHash, {
                        statusCode: res.statusCode,
                        path: req.path,
                        method: req.method,
                    }).catch((err) => {
                        logger.error('Failed to mark idempotency failed', err);
                    });
                }
            });
            // Expose key hashes downstream if needed
            res.locals.idempotency = { keyHash, requestHash, attachmentHash };
            return next();
        }
        catch (err) {
            return next(err);
        }
    };
}
