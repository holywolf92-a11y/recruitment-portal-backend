"use strict";
/**
 * Hybrid Photo Extraction Service
 *
 * Handles profile photo extraction with fallback strategy:
 * 1. Try Python parser's face-recognition method (fast, proven)
 * 2. Fallback to Backend OpenAI Vision (intelligent, handles complex cases)
 * 3. If both fail, return null for manual review
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadExtractedPhotoToCandidatePhotos = uploadExtractedPhotoToCandidatePhotos;
exports.extractProfilePhotoHybrid = extractProfilePhotoHybrid;
const database_1 = require("../config/database");
const crypto_1 = __importDefault(require("crypto"));
const errorHandling_1 = require("../utils/errorHandling");
const aiProfilePhotoExtractionService_1 = require("./aiProfilePhotoExtractionService");
const logger = (0, errorHandling_1.createLogger)('HybridPhotoExtraction');
// Deployment test marker - 2026-02-05
const PARSER_URL = process.env.PYTHON_CV_PARSER_URL || process.env.PARSER_URL || 'http://127.0.0.1:8000';
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET || '';
const STORAGE_BUCKET = 'documents';
/**
 * Attempt to extract profile photo using Python parser's face-recognition method
 * This is the primary method - fast, local, proven to work well
 *
 * Calls the parser's /parse endpoint which internally extracts the photo
 */
async function extractPhotoPythonParser(pdfBuffer, attachmentId) {
    try {
        if (!PARSER_URL) {
            logger.warn('PARSER_URL not configured, skipping Python parser extraction');
            return null;
        }
        const fileContentBase64 = pdfBuffer.toString('base64');
        const payload = {
            file_content: fileContentBase64,
            file_name: 'photo_section.pdf',
            mime_type: 'application/pdf',
            attachment_id: attachmentId,
        };
        const body = Buffer.from(JSON.stringify(payload), 'utf8');
        const sig = crypto_1.default.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
        const baseUrl = PARSER_URL.replace(/\/$/, '');
        const res = await fetch(`${baseUrl}/extract-photo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-hmac-signature': sig,
            },
            body,
        });
        if (!res.ok) {
            const text = await res.text();
            logger.warn('Python parser extraction failed', {
                status: res.status,
                message: text.substring(0, 200),
            });
            return null;
        }
        const json = (await res.json());
        // /extract-photo returns { success, profile_photo_url, error }
        const profilePhotoUrl = json?.profile_photo_url;
        if (!profilePhotoUrl) {
            logger.warn('Python parser returned no profile_photo_url', { json });
            return null;
        }
        // Fetch the actual image from the URL
        try {
            const imgRes = await fetch(profilePhotoUrl);
            if (!imgRes.ok) {
                logger.warn('Failed to fetch photo from parser-provided URL', { status: imgRes.status });
                return null;
            }
            const photoBuffer = Buffer.from(await imgRes.arrayBuffer());
            logger.info('Python parser successfully extracted photo', {
                sizeBytes: photoBuffer.length,
            });
            return photoBuffer;
        }
        catch (fetchErr) {
            logger.warn('Failed to fetch photo from parser URL', {
                error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
            });
            return null;
        }
    }
    catch (error) {
        logger.warn('Python parser extraction error', {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
/**
 * Attempt to extract profile photo using Backend OpenAI Vision service
 * This is the fallback method - intelligent but slower
 *
 * Note: For split document photos (no documentId yet), this method is not applicable
 * as it requires a pre-existing document record. Would need refactoring to accept raw PDF bytes.
 * For now, returning null as fallback.
 */
async function extractPhotoBackendAI(candidateId, pdfBuffer) {
    try {
        const result = await (0, aiProfilePhotoExtractionService_1.extractProfilePhotoFromPdfBufferUsingAI)({ pdfBuffer, maxPages: 5 });
        logger.info('Backend AI successfully extracted photo from PDF buffer', {
            candidateId,
            pageUsed: result.pageUsed,
            confidence: result.confidence,
            sizeBytes: result.jpeg.length,
        });
        return result.jpeg;
    }
    catch (error) {
        logger.warn('Backend AI extraction error', {
            candidateId,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
/**
 * Upload extracted photo to candidate_photos/{attachmentId}/profile.jpg
 * This matches the Python parser's storage convention
 */
async function uploadExtractedPhotoToCandidatePhotos(candidateId, attachmentId, photoBuffer) {
    const db = (0, database_1.supabaseAdminClient)();
    const storagePath = `candidate_photos/${attachmentId}/profile.jpg`;
    const { error: uploadError } = await db.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, photoBuffer, {
        contentType: 'image/jpeg',
        upsert: true, // Overwrite if exists
    });
    if (uploadError) {
        throw new Error(`Failed to upload extracted photo: ${uploadError.message}`);
    }
    // Generate signed URL
    const { data: signed, error: signError } = await db.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(storagePath, 60 * 60); // 1 hour TTL
    if (signError || !signed) {
        throw new Error(`Failed to sign extracted photo: ${signError?.message || 'unknown'}`);
    }
    logger.info('Uploaded extracted profile photo', {
        candidateId,
        attachmentId,
        bucket: STORAGE_BUCKET,
        storagePath,
        sizeBytes: photoBuffer.length,
    });
    // Update candidate's profile_photo_url to point to this photo
    const { error: updateError } = await db
        .from('candidates')
        .update({
        profile_photo_url: signed.signedUrl,
        profile_photo_path: storagePath,
        profile_photo_bucket: STORAGE_BUCKET,
        photo_received: true,
        photo_received_at: new Date().toISOString(),
    })
        .eq('id', candidateId);
    if (updateError) {
        logger.warn('Failed to update candidate photo fields', {
            candidateId,
            error: updateError.message,
        });
        // Don't throw - photo is stored, just metadata didn't update
    }
    return {
        bucket: STORAGE_BUCKET,
        storagePath,
        signedUrl: signed.signedUrl,
    };
}
/**
 * Hybrid extraction: try Python parser first, fallback to Backend AI, then manual review
 *
 * Returns:
 * - { success: true, photoBuffer, method: 'python' | 'ai' } if extraction succeeded
 * - { success: false, method: 'none' } if both methods failed (needs manual review)
 */
async function extractProfilePhotoHybrid(candidateId, attachmentId, pdfBuffer) {
    const extractionStartedAt = Date.now();
    // Method 1: Python parser (primary)
    logger.info('Starting hybrid extraction', {
        candidateId,
        method: 'trying python parser first',
    });
    const pythonPhoto = await extractPhotoPythonParser(pdfBuffer, attachmentId);
    if (pythonPhoto) {
        logger.info('Hybrid extraction succeeded using Python parser', {
            candidateId,
            ms: Date.now() - extractionStartedAt,
        });
        return {
            success: true,
            photoBuffer: pythonPhoto,
            method: 'python',
        };
    }
    // Method 2: Backend AI (fallback)
    logger.info('Python parser failed, trying Backend AI', { candidateId });
    const aiPhoto = await extractPhotoBackendAI(candidateId, pdfBuffer);
    if (aiPhoto) {
        logger.info('Hybrid extraction succeeded using Backend AI', {
            candidateId,
            ms: Date.now() - extractionStartedAt,
        });
        return {
            success: true,
            photoBuffer: aiPhoto,
            method: 'ai',
        };
    }
    // Both failed
    logger.warn('Hybrid extraction failed - both methods returned no photo', {
        candidateId,
        ms: Date.now() - extractionStartedAt,
    });
    return {
        success: false,
        method: 'none',
        reason: 'Neither Python parser nor Backend AI could extract a photo',
    };
}
