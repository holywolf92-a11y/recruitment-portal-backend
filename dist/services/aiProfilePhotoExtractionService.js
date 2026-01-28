"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractProfilePhotoFromPdfUsingAI = extractProfilePhotoFromPdfUsingAI;
const database_1 = require("../config/database");
const candidateDocumentService_1 = require("./candidateDocumentService");
const openaiResponsesService_1 = require("./openaiResponsesService");
const puppeteerPdfRenderService_1 = require("./puppeteerPdfRenderService");
const uuid_1 = require("uuid");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('AIProfilePhotoExtraction');
function dataUrlFromJpeg(buf) {
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
function clamp01(n) {
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(1, n));
}
function bboxNormToClip(bbox, viewport) {
    const x = bbox.x ?? 0;
    const y = bbox.y ?? 0;
    const w = bbox.w ?? 0;
    const h = bbox.h ?? 0;
    const pad = 0.02;
    const x0 = clamp01(x - pad);
    const y0 = clamp01(y - pad);
    const x1 = clamp01(x + w + pad);
    const y1 = clamp01(y + h + pad);
    const px0 = Math.floor(x0 * viewport.width);
    const py0 = Math.floor(y0 * viewport.height);
    const px1 = Math.ceil(x1 * viewport.width);
    const py1 = Math.ceil(y1 * viewport.height);
    return {
        x: px0,
        y: py0,
        width: Math.max(1, px1 - px0),
        height: Math.max(1, py1 - py0),
    };
}
async function locateProfilePhotoOnPage(args) {
    const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['found', 'confidence', 'bbox', 'reason'],
        properties: {
            found: { type: 'boolean' },
            confidence: { type: 'number' },
            bbox: {
                type: 'object',
                additionalProperties: false,
                required: ['x', 'y', 'w', 'h'],
                properties: {
                    x: { type: ['number', 'null'], description: 'Left in [0,1]' },
                    y: { type: ['number', 'null'], description: 'Top in [0,1]' },
                    w: { type: ['number', 'null'], description: 'Width in [0,1]' },
                    h: { type: ['number', 'null'], description: 'Height in [0,1]' },
                },
            },
            reason: { type: 'string' },
        },
    };
    const prompt = 'Return JSON only. Task: find the candidate\'s profile photo/headshot on this document page. ' +
        'Look for a rectangular photo of a person\'s face (passport-size/headshot). ' +
        'Ignore logos, stamps, seals, signatures, QR codes, barcodes, and icons. ' +
        'If multiple photos exist, pick the clearest headshot. ' +
        'Return bbox normalized to the input image size in [0,1] as {x,y,w,h}. ' +
        'If no headshot photo exists, set found=false and bbox fields to null.';
    return (0, openaiResponsesService_1.openaiCreateJsonSchemaResponse)({
        model: args.model,
        prompt,
        imageDataUrl: dataUrlFromJpeg(args.jpeg),
        schemaName: 'profile_photo_bbox',
        schema,
        timeoutMs: 20000,
        detail: 'high',
    });
}
async function verifyCropLooksLikeHeadshot(args) {
    const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'confidence', 'reason'],
        properties: {
            ok: { type: 'boolean' },
            confidence: { type: 'number' },
            reason: { type: 'string' },
        },
    };
    const prompt = 'Return JSON only. Is this image a real human headshot/profile photo suitable for a candidate avatar? ' +
        'Answer ok=true only if it clearly contains a person\'s face photo (not a logo, not an icon, not a stamp, not a QR).';
    return (0, openaiResponsesService_1.openaiCreateJsonSchemaResponse)({
        model: args.model,
        prompt,
        imageDataUrl: dataUrlFromJpeg(args.jpeg),
        schemaName: 'profile_photo_verify',
        schema,
        timeoutMs: 15000,
        detail: 'low',
    });
}
async function uploadExtractedPhoto(args) {
    const db = (0, database_1.supabaseAdminClient)();
    const filename = `ai_extracted_${Date.now()}_${(0, uuid_1.v4)()}.jpg`;
    const storagePath = `candidates/${args.candidateId}/profile_photos/${filename}`;
    const bucket = 'documents';
    const { error: uploadError } = await db.storage
        .from(bucket)
        .upload(storagePath, args.jpeg, { contentType: 'image/jpeg', upsert: false });
    if (uploadError) {
        throw new Error(`Failed to upload extracted photo: ${uploadError.message}`);
    }
    // Signed URL for immediate UI use (longer TTL than usual).
    const { data: signed, error: signError } = await db.storage
        .from(bucket)
        .createSignedUrl(storagePath, 60 * 60);
    if (signError || !signed) {
        throw new Error(`Failed to sign extracted photo: ${signError?.message || 'unknown'}`);
    }
    return { bucket, storagePath, signedUrl: signed.signedUrl };
}
async function choosePdfSource(args) {
    if (args.documentId) {
        const doc = await (0, candidateDocumentService_1.getCandidateDocumentById)(args.documentId);
        if (!doc)
            throw new Error('Document not found');
        if (doc.candidate_id !== args.candidateId)
            throw new Error('Document does not belong to candidate');
        const url = await (0, candidateDocumentService_1.getCandidateDocumentSignedUrl)(args.documentId, 60 * 10);
        return { pdfSignedUrl: url, documentId: args.documentId };
    }
    // Fallback: pick the newest PDF for this candidate.
    const docs = await (0, candidateDocumentService_1.listCandidateDocumentsByCandidate)(args.candidateId);
    const pdf = docs.find((d) => (d.mime_type || '').toLowerCase() === 'application/pdf' || (d.file_name || '').toLowerCase().endsWith('.pdf'));
    if (!pdf) {
        throw new Error('No PDF document found for candidate (provide documentId)');
    }
    const url = await (0, candidateDocumentService_1.getCandidateDocumentSignedUrl)(pdf.id, 60 * 10);
    return { pdfSignedUrl: url, documentId: pdf.id };
}
async function extractProfilePhotoFromPdfUsingAI(args) {
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini-2024-07-18';
    const maxPages = Math.max(1, Math.min(10, args.maxPages ?? 5));
    const startedAt = Date.now();
    logger.info('Start', { candidateId: args.candidateId, documentId: args.documentId, maxPages, model });
    const { pdfSignedUrl, documentId } = await choosePdfSource({ candidateId: args.candidateId, documentId: args.documentId });
    const viewport = { width: 1000, height: 1400, deviceScaleFactor: 2 };
    let best = null;
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        const pageStartedAt = Date.now();
        const { jpeg } = await (0, puppeteerPdfRenderService_1.renderPdfPageToJpeg)({ pdfUrl: pdfSignedUrl, pageNumber, viewport, timeoutMs: 30000 });
        const locate = await locateProfilePhotoOnPage({ jpeg, model });
        logger.info('Page scanned', {
            candidateId: args.candidateId,
            documentId,
            pageNumber,
            found: locate.found,
            confidence: locate.confidence,
            ms: Date.now() - pageStartedAt,
        });
        if (!locate.found)
            continue;
        // Basic bbox sanity.
        const area = (locate.bbox.w ?? 0) * (locate.bbox.h ?? 0);
        if (!Number.isFinite(area) || area < 0.01)
            continue;
        const clip = bboxNormToClip(locate.bbox, viewport);
        const { jpeg: cropJpeg } = await (0, puppeteerPdfRenderService_1.renderPdfPageCropToJpeg)({
            pdfUrl: pdfSignedUrl,
            pageNumber,
            viewport,
            clip,
            timeoutMs: 30000,
        });
        const verify = await verifyCropLooksLikeHeadshot({ jpeg: cropJpeg, model });
        const combinedConfidence = Math.max(0, Math.min(1, (locate.confidence || 0) * 0.7 + (verify.confidence || 0) * 0.3));
        if (!verify.ok) {
            // Still keep as fallback if nothing else is found.
            if (!best || combinedConfidence > best.locate.confidence) {
                best = { page: pageNumber, locate: { ...locate, confidence: combinedConfidence }, cropJpeg };
            }
            continue;
        }
        if (!best || combinedConfidence > best.locate.confidence) {
            best = { page: pageNumber, locate: { ...locate, confidence: combinedConfidence }, cropJpeg };
        }
        // If we're very confident, stop early.
        if (combinedConfidence >= 0.85)
            break;
    }
    if (!best) {
        logger.warn('No usable headshot found', { candidateId: args.candidateId, documentId, ms: Date.now() - startedAt });
        throw new Error('AI could not find a usable headshot in the PDF pages searched');
    }
    const uploaded = await uploadExtractedPhoto({ candidateId: args.candidateId, jpeg: best.cropJpeg });
    // Update candidate to point to stable storage refs.
    const db = (0, database_1.supabaseAdminClient)();
    const { error: updateErr } = await db
        .from('candidates')
        .update({
        profile_photo_bucket: uploaded.bucket,
        profile_photo_path: uploaded.storagePath,
        // profile_photo_url intentionally left unset (signed URLs expire). The API will generate profile_photo_signed_url.
        profile_photo_url: null,
        photo_received: true,
        photo_received_at: new Date().toISOString(),
    })
        .eq('id', args.candidateId);
    if (updateErr) {
        throw new Error(`Failed to update candidate profile photo fields: ${updateErr.message}`);
    }
    logger.info('Success', {
        candidateId: args.candidateId,
        documentId,
        pageUsed: best.page,
        confidence: best.locate.confidence,
        storagePath: uploaded.storagePath,
        ms: Date.now() - startedAt,
    });
    return {
        candidateId: args.candidateId,
        documentId,
        pageUsed: best.page,
        confidence: best.locate.confidence,
        storageBucket: uploaded.bucket,
        storagePath: uploaded.storagePath,
        signedUrl: uploaded.signedUrl,
        note: best.locate.reason,
    };
}
