import { supabaseAdminClient } from '../config/database';
import { getCandidateDocumentById, getCandidateDocumentSignedUrl, listCandidateDocumentsByCandidate } from './candidateDocumentService';
import { openaiCreateJsonSchemaResponse } from './openaiResponsesService';
import { renderPdfPageCropToJpeg, renderPdfPageToJpeg } from './puppeteerPdfRenderService';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/errorHandling';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const logger = createLogger('AIProfilePhotoExtraction');

function isPdfDoc(d: any): boolean {
  return (d?.mime_type || '').toLowerCase() === 'application/pdf' || (d?.file_name || '').toLowerCase().endsWith('.pdf');
}

function isSplitPdfDoc(d: any): boolean {
  const name = String(d?.file_name || '').toLowerCase();
  return name.startsWith('split_') || name.includes('_pages_');
}

function parseUploadIdFromSplitStoragePath(storagePath: string | undefined): string | null {
  if (!storagePath) return null;
  // Example: candidates/<candidateId>/<folder>/<ts>_<uploadId>_pages_1-2.pdf
  const m = storagePath.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_pages_/i);
  return m?.[1] ?? null;
}

async function signStoragePath(bucket: string, storagePath: string, expiresSec: number): Promise<string> {
  const db = supabaseAdminClient();
  const { data, error } = await db.storage.from(bucket).createSignedUrl(storagePath, expiresSec);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate signed URL for ${bucket}/${storagePath}: ${error?.message || 'unknown'}`);
  }
  return data.signedUrl;
}

type BBoxNorm = {
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
};

type LocateResult = {
  found: boolean;
  confidence: number;
  bbox: BBoxNorm;
  reason: string;
};

type VerifyCropResult = {
  ok: boolean;
  confidence: number;
  reason: string;
};

function dataUrlFromJpeg(buf: Buffer): string {
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function bboxNormToClip(bbox: BBoxNorm, viewport: { width: number; height: number }) {
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

async function locateProfilePhotoOnPage(args: {
  jpeg: Buffer;
  model: string;
}): Promise<LocateResult> {
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

  const prompt =
    'Return JSON only. Task: find the candidate\'s profile photo/headshot on this document page. ' +
    'Look for a rectangular photo of a person\'s face (passport-size/headshot). ' +
    'Ignore logos, stamps, seals, signatures, QR codes, barcodes, and icons. ' +
    'If multiple photos exist, pick the clearest headshot. ' +
    'Return bbox normalized to the input image size in [0,1] as {x,y,w,h}. ' +
    'If no headshot photo exists, set found=false and bbox fields to null.';

  return openaiCreateJsonSchemaResponse<LocateResult>({
    model: args.model,
    prompt,
    imageDataUrl: dataUrlFromJpeg(args.jpeg),
    schemaName: 'profile_photo_bbox',
    schema,
    timeoutMs: 20000,
    detail: 'high',
  });
}

async function verifyCropLooksLikeHeadshot(args: {
  jpeg: Buffer;
  model: string;
}): Promise<VerifyCropResult> {
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

  const prompt =
    'Return JSON only. Is this image a real human headshot/profile photo suitable for a candidate avatar? ' +
    'Answer ok=true only if it clearly contains a person\'s face photo (not a logo, not an icon, not a stamp, not a QR).';

  return openaiCreateJsonSchemaResponse<VerifyCropResult>({
    model: args.model,
    prompt,
    imageDataUrl: dataUrlFromJpeg(args.jpeg),
    schemaName: 'profile_photo_verify',
    schema,
    timeoutMs: 15000,
    detail: 'low',
  });
}

async function uploadExtractedPhoto(args: { candidateId: string; jpeg: Buffer }) {
  const db = supabaseAdminClient();
  const filename = `ai_extracted_${Date.now()}_${uuidv4()}.jpg`;
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

async function choosePdfSource(args: {
  candidateId: string;
  documentId?: string;
}): Promise<{ pdfSignedUrl: string; documentId?: string }> {
  if (args.documentId) {
    const doc = await getCandidateDocumentById(args.documentId);
    if (!doc) throw new Error('Document not found');
    if (doc.candidate_id !== args.candidateId) throw new Error('Document does not belong to candidate');

    // If user clicked a split PDF (e.g., split_passport_*.pdf), prefer the preserved original upload
    // (original_uploads/upload_<uploadId>.pdf) because the profile photo may be on any page.
    if (isPdfDoc(doc) && isSplitPdfDoc(doc)) {
      const uploadId = parseUploadIdFromSplitStoragePath(doc.storage_path);
      if (uploadId) {
        const originalPath = `original_uploads/upload_${uploadId}.pdf`;
        try {
          const url = await signStoragePath('documents', originalPath, 60 * 10);
          logger.info('Using preserved original PDF for extraction', {
            candidateId: args.candidateId,
            clickedDocumentId: args.documentId,
            originalPath,
          });
          // Keep documentId as the clicked doc id for traceability.
          return { pdfSignedUrl: url, documentId: args.documentId };
        } catch (e: any) {
          logger.warn('Preserved original PDF not found/signed, falling back to clicked document', {
            candidateId: args.candidateId,
            clickedDocumentId: args.documentId,
            error: e?.message || String(e),
          });
        }
      }
    }

    const url = await getCandidateDocumentSignedUrl(args.documentId, 60 * 10);
    return { pdfSignedUrl: url, documentId: args.documentId };
  }

  // Fallback: prefer a preserved original upload (if present as a candidate_document),
  // otherwise pick a non-split PDF, otherwise newest PDF.
  const docs = await listCandidateDocumentsByCandidate(args.candidateId);
  const preferredOriginal = docs.find((d: any) => isPdfDoc(d) && String(d.storage_path || '').startsWith('original_uploads/'));
  const nonSplitPdf = docs.find((d: any) => isPdfDoc(d) && !isSplitPdfDoc(d));
  const anyPdf = docs.find((d: any) => isPdfDoc(d));
  const pdf = preferredOriginal || nonSplitPdf || anyPdf;
  if (!pdf) {
    throw new Error('No PDF document found for candidate (provide documentId)');
  }

  const url = await getCandidateDocumentSignedUrl((pdf as any).id, 60 * 10);
  return { pdfSignedUrl: url, documentId: (pdf as any).id };
}

export async function extractProfilePhotoFromPdfUsingAI(args: {
  candidateId: string;
  documentId?: string;
  maxPages?: number;
}): Promise<{
  candidateId: string;
  documentId?: string;
  pageUsed: number;
  confidence: number;
  storageBucket: string;
  storagePath: string;
  signedUrl: string;
  note: string;
}> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini-2024-07-18';
  const maxPages = Math.max(1, Math.min(10, args.maxPages ?? 10));

  const startedAt = Date.now();
  logger.info('Start', { candidateId: args.candidateId, documentId: args.documentId, maxPages, model });

  const { pdfSignedUrl, documentId } = await choosePdfSource({ candidateId: args.candidateId, documentId: args.documentId });

  const viewport = { width: 1000, height: 1400, deviceScaleFactor: 2 };

  let best: { page: number; locate: LocateResult; cropJpeg: Buffer } | null = null;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    const pageStartedAt = Date.now();
    const { jpeg } = await renderPdfPageToJpeg({ pdfUrl: pdfSignedUrl, pageNumber, viewport, timeoutMs: 30000 });
    const locate = await locateProfilePhotoOnPage({ jpeg, model });

    logger.info('Page scanned', {
      candidateId: args.candidateId,
      documentId,
      pageNumber,
      found: locate.found,
      confidence: locate.confidence,
      ms: Date.now() - pageStartedAt,
    });

    if (!locate.found) continue;

    // BBox quality gates: avoid tiny false positives and full-page boxes.
    const boxW = locate.bbox.w ?? 0;
    const boxH = locate.bbox.h ?? 0;
    const area = boxW * boxH;
    if (!Number.isFinite(area) || area < 0.01 || area > 0.45) continue;

    const aspect = boxH > 0 ? boxW / boxH : 0;
    if (!Number.isFinite(aspect) || aspect < 0.45 || aspect > 1.25) continue;

    const clip = bboxNormToClip(locate.bbox, viewport);
    const { jpeg: cropJpeg } = await renderPdfPageCropToJpeg({
      pdfUrl: pdfSignedUrl,
      pageNumber,
      viewport,
      clip,
      timeoutMs: 30000,
    });

    const verify = await verifyCropLooksLikeHeadshot({ jpeg: cropJpeg, model });
    const combinedConfidence = Math.max(0, Math.min(1, (locate.confidence || 0) * 0.7 + (verify.confidence || 0) * 0.3));

    if (!verify.ok) {
      // Reject non-headshot crops to avoid saving full CV pages or wrong images.
      logger.warn('Rejected non-headshot crop', {
        candidateId: args.candidateId,
        documentId,
        pageNumber,
        locateConfidence: locate.confidence,
        verifyConfidence: verify.confidence,
        reason: verify.reason,
      });
      continue;
    }

    if (!best || combinedConfidence > best.locate.confidence) {
      best = { page: pageNumber, locate: { ...locate, confidence: combinedConfidence }, cropJpeg };
    }

    // Early exit: confidence ≥ 0.85 is high enough — skip remaining pages to save cost.
    if (combinedConfidence >= 0.85) {
      logger.info('Early exit: high-confidence headshot found', {
        candidateId: args.candidateId,
        documentId,
        pageNumber,
        confidence: combinedConfidence,
      });
      break;
    }
  }

  if (!best) {
    logger.warn('No usable headshot found', { candidateId: args.candidateId, documentId, ms: Date.now() - startedAt });
    throw new Error('AI could not find a usable headshot in the PDF pages searched');
  }

  const uploaded = await uploadExtractedPhoto({ candidateId: args.candidateId, jpeg: best.cropJpeg });

  // Update candidate to point to stable storage refs.
  const db = supabaseAdminClient();
  const { error: updateErr } = await db
    .from('candidates')
    .update({
      profile_photo_bucket: uploaded.bucket,
      profile_photo_path: uploaded.storagePath,
      // Save signed URL for immediate display (API can regenerate if expired)
      profile_photo_url: uploaded.signedUrl,
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

export async function extractProfilePhotoFromPdfBufferUsingAI(args: {
  pdfBuffer: Buffer;
  maxPages?: number;
  model?: string;
}): Promise<{
  pageUsed: number;
  confidence: number;
  jpeg: Buffer;
  note: string;
}> {
  const model = args.model || process.env.OPENAI_MODEL || 'gpt-4o-mini-2024-07-18';
  const maxPages = Math.max(1, Math.min(10, args.maxPages ?? 10));
  const startedAt = Date.now();

  const viewport = { width: 1000, height: 1400, deviceScaleFactor: 2 };

  const tmpPath = path.join(os.tmpdir(), `ai_extract_${Date.now()}_${uuidv4()}.pdf`);
  try {
    await fs.writeFile(tmpPath, args.pdfBuffer);
    const pdfUrl = pathToFileURL(tmpPath).toString();

    let best: { page: number; locate: LocateResult; cropJpeg: Buffer } | null = null;

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
      const pageStartedAt = Date.now();
      const { jpeg } = await renderPdfPageToJpeg({ pdfUrl, pageNumber, viewport, timeoutMs: 30000 });
      const locate = await locateProfilePhotoOnPage({ jpeg, model });

      logger.info('Page scanned (buffer)', {
        pageNumber,
        found: locate.found,
        confidence: locate.confidence,
        ms: Date.now() - pageStartedAt,
      });

      if (!locate.found) continue;

      const boxW = locate.bbox.w ?? 0;
      const boxH = locate.bbox.h ?? 0;
      const area = boxW * boxH;
      if (!Number.isFinite(area) || area < 0.01 || area > 0.45) continue;

      const aspect = boxH > 0 ? boxW / boxH : 0;
      if (!Number.isFinite(aspect) || aspect < 0.45 || aspect > 1.25) continue;

      const clip = bboxNormToClip(locate.bbox, viewport);
      const { jpeg: cropJpeg } = await renderPdfPageCropToJpeg({
        pdfUrl,
        pageNumber,
        viewport,
        clip,
        timeoutMs: 30000,
      });

      const verify = await verifyCropLooksLikeHeadshot({ jpeg: cropJpeg, model });
      const combinedConfidence = Math.max(0, Math.min(1, (locate.confidence || 0) * 0.7 + (verify.confidence || 0) * 0.3));

      if (!verify.ok) {
        logger.warn('Rejected non-headshot crop (buffer)', {
          pageNumber,
          locateConfidence: locate.confidence,
          verifyConfidence: verify.confidence,
          reason: verify.reason,
        });
        continue;
      }

      if (!best || combinedConfidence > best.locate.confidence) {
        best = { page: pageNumber, locate: { ...locate, confidence: combinedConfidence }, cropJpeg };
      }
    }

    if (!best) {
      logger.warn('No usable headshot found (buffer)', { ms: Date.now() - startedAt });
      throw new Error('AI could not find a usable headshot in the provided PDF');
    }

    logger.info('Success (buffer)', {
      pageUsed: best.page,
      confidence: best.locate.confidence,
      ms: Date.now() - startedAt,
    });

    return {
      pageUsed: best.page,
      confidence: best.locate.confidence,
      jpeg: best.cropJpeg,
      note: best.locate.reason,
    };
  } finally {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // ignore
    }
  }
}
