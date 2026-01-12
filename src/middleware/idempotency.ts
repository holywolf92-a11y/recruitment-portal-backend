import { Request, Response, NextFunction } from 'express';
import {
  checkIdempotency,
  createIdempotencyKey,
  generateKeyHash,
  markIdempotencyComplete,
  markIdempotencyFailed
} from '../services/idempotencyService';
import { AppError, ErrorType, createLogger } from '../utils/errorHandling';
import { hashRequest } from '../utils/hashing';

const logger = createLogger('IdempotencyMiddleware');

export interface IdempotencyOptions {
  resourceType: string;
  keyFromRequest?: (req: Request) => string | undefined;
  attachmentHashFromRequest?: (req: Request) => string | undefined;
}

export function idempotencyMiddleware(options: IdempotencyOptions) {
  return async function handleIdempotency(req: Request, res: Response, next: NextFunction) {
    const idempotencyKey = options.keyFromRequest
      ? options.keyFromRequest(req)
      : (req.headers['x-idempotency-key'] as string | undefined);

    if (!idempotencyKey) {
      return next(new AppError('Missing idempotency key', ErrorType.VALIDATION, 400));
    }

    const keyHash = generateKeyHash(idempotencyKey);
    const requestHash = hashRequest(req.body ?? {});
    const attachmentHash = options.attachmentHashFromRequest?.(req);

    try {
      // If exists, return cached or appropriate status
      const existing = await checkIdempotency(keyHash, requestHash);
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
      await createIdempotencyKey(keyHash, options.resourceType, requestHash, attachmentHash);

      // Auto-mark completion on successful json responses
      const originalJson = res.json.bind(res);
      res.json = ((body: any) => {
        // Fire and forget to avoid blocking the response
        void markIdempotencyComplete(keyHash, body, res.statusCode || 200).catch((err) => {
          logger.error('Failed to mark idempotency complete', err);
        });
        return originalJson(body);
      }) as any;

      // Auto-mark failures on non-2xx responses
      res.on('finish', () => {
        if (res.statusCode >= 400) {
          void markIdempotencyFailed(keyHash, {
            statusCode: res.statusCode,
            path: req.path,
            method: req.method,
          }).catch((err) => {
            logger.error('Failed to mark idempotency failed', err);
          });
        }
      });

      // Expose key hashes downstream if needed
      (res.locals as any).idempotency = { keyHash, requestHash, attachmentHash };

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
