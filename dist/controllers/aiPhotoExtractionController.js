"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPhotoFromPdfAiController = extractPhotoFromPdfAiController;
const aiProfilePhotoExtractionService_1 = require("../services/aiProfilePhotoExtractionService");
function requireTokenIfConfigured(req) {
    const expected = process.env.EXTRACT_PHOTO_TOKEN;
    if (!expected)
        return;
    const got = req.headers['x-extract-photo-token'] || '';
    if (!got || got !== expected) {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
    }
}
/**
 * POST /api/documents/candidates/:candidateId/extract-photo-ai
 * Body: { documentId?: string, maxPages?: number }
 */
async function extractPhotoFromPdfAiController(req, res) {
    try {
        requireTokenIfConfigured(req);
        const { candidateId } = req.params;
        const { documentId, maxPages } = req.body || {};
        if (!candidateId) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const result = await (0, aiProfilePhotoExtractionService_1.extractProfilePhotoFromPdfUsingAI)({
            candidateId,
            documentId,
            maxPages: typeof maxPages === 'number' ? maxPages : undefined,
        });
        return res.json({ success: true, ...result });
    }
    catch (err) {
        const status = err?.status || 500;
        return res.status(status).json({
            success: false,
            error: err?.message || 'Failed to extract photo',
        });
    }
}
