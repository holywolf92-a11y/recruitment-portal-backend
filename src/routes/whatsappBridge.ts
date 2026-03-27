import { Router, Response } from 'express';
import fetch from 'node-fetch';
import { asyncHandler } from '../utils/errorHandling';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

const router = Router();

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4310';

function getBridgeBaseUrl(): string {
  return (process.env.WHATSAPP_BRIDGE_URL || DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
}

async function proxyBridge(pathname: string, options?: { method?: 'GET' | 'POST'; body?: string }) {
  const response = await fetch(`${getBridgeBaseUrl()}${pathname}`, {
    method: options?.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options?.body,
  });

  const text = await response.text();

  return {
    status: response.status,
    body: text,
    contentType: response.headers.get('content-type') || 'application/json',
  };
}

router.use(authenticate);
router.use(requireRole('admin', 'manager'));

router.get(
  '/status',
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    try {
      const result = await proxyBridge('/status');
      res.status(result.status).type(result.contentType).send(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
  })
);

router.get(
  '/sessions/:accountId/qr',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const accountId = encodeURIComponent(req.params.accountId);

    try {
      const result = await proxyBridge(`/sessions/${accountId}/qr`);
      res.status(result.status).type(result.contentType).send(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
  })
);

router.post(
  '/sessions/:accountId/pairing-code',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const accountId = encodeURIComponent(req.params.accountId);
    const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber : '';

    try {
      const result = await proxyBridge(`/sessions/${accountId}/pairing-code`, {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      });
      res.status(result.status).type(result.contentType).send(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
  })
);

router.post(
  '/sessions/:accountId/connect',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const accountId = encodeURIComponent(req.params.accountId);

    try {
      const result = await proxyBridge(`/sessions/${accountId}/connect`, {
        method: 'POST',
      });
      res.status(result.status).type(result.contentType).send(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
  })
);
router.post(
  '/sessions/:accountId/restart',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const accountId = encodeURIComponent(req.params.accountId);

    try {
      const result = await proxyBridge(`/sessions/${accountId}/restart`, {
        method: 'POST',
      });
      res.status(result.status).type(result.contentType).send(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
  })
);
router.post(
  '/sessions/:accountId/cancel',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const accountId = encodeURIComponent(req.params.accountId);

    try {
      const result = await proxyBridge(`/sessions/${accountId}/cancel`, {
        method: 'POST',
      });
      res.status(result.status).type(result.contentType).send(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
  })
);
export default router;