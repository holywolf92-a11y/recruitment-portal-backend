"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const rateLimit_1 = require("../middleware/rateLimit");
const errorHandling_1 = require("../utils/errorHandling");
const gmailService_1 = require("../services/gmailService");
const router = (0, express_1.Router)();
const logger = (0, errorHandling_1.createLogger)('TestHelpers');
// Only enable test endpoints in non-production environments
const isTestMode = process.env.NODE_ENV !== 'production';
if (isTestMode) {
    router.post('/reset-rate-limits', (req, res) => {
        try {
            // Reset rate limit stores by calling resetKey on all IPs
            // express-rate-limit stores are typically in-memory Maps
            // We can access the store's reset method if available
            const resetStore = (limiter) => {
                if (limiter && limiter.resetKey) {
                    // Reset for the requesting IP
                    const ip = req.ip || 'unknown';
                    limiter.resetKey(ip);
                }
            };
            resetStore(rateLimit_1.whatsappLimiter);
            resetStore(rateLimit_1.gmailLimiter);
            logger.info('Rate limits reset', { ip: req.ip });
            res.json({ message: 'Rate limits reset successfully' });
        }
        catch (err) {
            logger.error('Failed to reset rate limits', err);
            res.status(500).json({ error: 'Failed to reset rate limits' });
        }
    });
    router.get('/gmail-connection', async (_req, res) => {
        try {
            const result = await (0, gmailService_1.testConnection)();
            if (result.ok)
                return res.json({ ok: true, email: result.email });
            return res.status(500).json({ ok: false, error: result.error });
        }
        catch (err) {
            logger.error('Gmail connection check failed', err);
            return res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
        }
    });
    router.get('/openai-ping', async (_req, res) => {
        const key = process.env.OPENAI_API_KEY;
        if (!key)
            return res.status(400).json({ ok: false, error: 'OPENAI_API_KEY missing' });
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
        }
        catch (err) {
            logger.error('OpenAI ping failed', err);
            return res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
        }
    });
    router.get('/gmail-messages', async (_req, res) => {
        try {
            const { messages } = await (0, gmailService_1.listMessages)('has:attachment', 5);
            if (!messages || messages.length === 0) {
                return res.json({ ok: true, count: 0, messages: [] });
            }
            const detailed = await Promise.all(messages.map(async (msg) => {
                try {
                    const full = await (0, gmailService_1.getMessage)(msg.id);
                    const attachmentDetails = await Promise.all((full.attachments || []).map(async (att) => {
                        try {
                            const buffer = await (0, gmailService_1.getAttachment)(msg.id, att.id);
                            return {
                                filename: att.filename,
                                mimeType: att.mimeType,
                                size: att.size,
                                downloadedBytes: buffer.length,
                                downloadOk: buffer.length > 0,
                            };
                        }
                        catch (err) {
                            return {
                                filename: att.filename,
                                mimeType: att.mimeType,
                                size: att.size,
                                downloadOk: false,
                                error: err?.message,
                            };
                        }
                    }));
                    return {
                        id: full.id,
                        subject: full.subject,
                        from: full.from,
                        attachmentCount: full.attachmentCount,
                        attachments: attachmentDetails,
                    };
                }
                catch (err) {
                    return { id: msg.id, error: err?.message };
                }
            }));
            return res.json({ ok: true, count: messages.length, messages: detailed });
        }
        catch (err) {
            logger.error('Gmail messages list failed', err);
            return res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
        }
    });
    logger.info('Test helper endpoints enabled (non-production mode)');
}
else {
    logger.warn('Test helper endpoints disabled in production mode');
}
exports.default = router;
