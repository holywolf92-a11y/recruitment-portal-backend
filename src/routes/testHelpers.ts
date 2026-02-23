import { Router } from 'express';
import { whatsappLimiter, gmailLimiter } from '../middleware/rateLimit';
import { createLogger } from '../utils/errorHandling';
import { testConnection as testGmailConnection, listMessages, getMessage, getAttachment } from '../services/gmailService';

const router = Router();
const logger = createLogger('TestHelpers');

// Only enable test endpoints in non-production environments
const isTestMode = process.env.NODE_ENV !== 'production';

if (isTestMode) {
  router.post('/reset-rate-limits', (req, res) => {
    try {
      // Reset rate limit stores by calling resetKey on all IPs
      // express-rate-limit stores are typically in-memory Maps
      // We can access the store's reset method if available
      const resetStore = (limiter: any) => {
        if (limiter && limiter.resetKey) {
          // Reset for the requesting IP
          const ip = req.ip || 'unknown';
          limiter.resetKey(ip);
        }
      };

      resetStore(whatsappLimiter);
      resetStore(gmailLimiter);

      logger.info('Rate limits reset', { ip: req.ip });
      res.json({ message: 'Rate limits reset successfully' });
    } catch (err) {
      logger.error('Failed to reset rate limits', err);
      res.status(500).json({ error: 'Failed to reset rate limits' });
    }
  });

  router.get('/gmail-connection', async (_req, res) => {
    try {
      const result = await testGmailConnection();
      if (result.ok) return res.json({ ok: true, email: result.email });
      return res.status(500).json({ ok: false, error: result.error });
    } catch (err: any) {
      logger.error('Gmail connection check failed', err);
      return res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
    }
  });

  router.get('/openai-ping', async (_req, res) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(400).json({ ok: false, error: 'OPENAI_API_KEY missing' });
    try {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status).json({ ok: false, status: r.status, body: text });
      }
      const data = await r.json();
      const count = Array.isArray(data?.data) ? data.data.length : undefined;
      return res.json({ ok: true, models: count });
    } catch (err: any) {
      logger.error('OpenAI ping failed', err);
      return res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
    }
  });

  router.get('/gmail-messages', async (_req, res) => {
    try {
      const { messages } = await listMessages('has:attachment', 5);
      if (!messages || messages.length === 0) {
        return res.json({ ok: true, count: 0, messages: [] });
      }

      const detailed = await Promise.all(
        messages.map(async (msg) => {
          try {
            const full = await getMessage(msg.id!);
            const attachmentDetails = await Promise.all(
              (full.attachments || []).map(async (att) => {
                try {
                  const buffer = await getAttachment(msg.id!, att.id);
                  return {
                    filename: att.filename,
                    mimeType: att.mimeType,
                    size: att.size,
                    downloadedBytes: buffer.length,
                    downloadOk: buffer.length > 0,
                  };
                } catch (err: any) {
                  return {
                    filename: att.filename,
                    mimeType: att.mimeType,
                    size: att.size,
                    downloadOk: false,
                    error: err?.message,
                  };
                }
              })
            );
            return {
              id: full.id,
              subject: full.subject,
              from: full.from,
              attachmentCount: full.attachmentCount,
              attachments: attachmentDetails,
            };
          } catch (err: any) {
            return { id: msg.id, error: err?.message };
          }
        })
      );

      return res.json({ ok: true, count: messages.length, messages: detailed });
    } catch (err: any) {
      logger.error('Gmail messages list failed', err);
      return res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
    }
  });

  logger.info('Test helper endpoints enabled (non-production mode)');
} else {
  logger.warn('Test helper endpoints disabled in production mode');
}

export default router;
