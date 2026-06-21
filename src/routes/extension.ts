// Chrome-extension ingest endpoint. The extension POSTs a single CV as
// multipart/form-data; we validate it's a real PDF (magic-byte check),
// create an inbox_messages row (source='rozeegpt'), upload the file as an
// attachment (Supabase Storage), and enqueue it for the cv-parsing worker
// — same pipeline used by Gmail / Hostinger imports.

import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { extensionRateLimiter } from '../middleware/extensionRateLimit';
import { supabaseAdminClient } from '../config/database';
import { createInboxMessage } from '../services/inboxService';
import { createAttachment, enqueueCvParsingJobForAttachment } from '../services/inboxAttachmentService';
import { AppError, ErrorType } from '../utils/errorHandling';

const router = Router();
router.use(authenticate);
router.use(extensionRateLimiter);

// 25 MB hard cap, single file. Memory storage — we only buffer briefly while
// validating + uploading to Supabase.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

// Wrapper that converts multer errors into our shaped JSON responses BEFORE
// they escape to the global error handler. Without this the 413 path is
// dead code (multer middleware errors skip the route's try/catch entirely).
function uploadWithErrorHandling(fieldName: string) {
  const mw = upload.single(fieldName);
  return (req: Request, res: Response, next: NextFunction) => {
    mw(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ ok: false, error: 'FILE_TOO_LARGE', message: 'CV exceeds 25 MB limit' });
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ ok: false, error: 'INVALID_UPLOAD', message: err.message });
        }
        return res.status(400).json({ ok: false, error: 'UPLOAD_ERROR', message: err.message });
      }
      return next(err);
    });
  };
}

// Defensive: the standard PDF magic bytes are "%PDF-" (25 50 44 46 2D).
// createAttachment doesn't magic-byte-gate so we do it here before touching
// Supabase Storage. Rozeegpt occasionally serves an HTML error page when the
// session is expired — without this check we'd silently store garbage.
function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

function safeFileNamePart(name: string, max = 80): string {
  const cleaned = (name || 'cv.pdf').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, max);
  return cleaned.length ? cleaned : 'cv.pdf';
}

// ── POST /api/extension/ingest-cv ───────────────────────────────────────────
router.post('/ingest-cv', uploadWithErrorHandling('cv'), async (req: AuthRequest, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: 'MISSING_FILE', message: 'multipart field "cv" is required' });
    if (!looksLikePdf(file.buffer)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_PDF',
        message: 'File must be a PDF (magic bytes %PDF- required). Did rozeegpt return HTML — has your session expired?',
      });
    }

    const rozeeCvIdRaw   = String(req.body?.rozeeCvId      ?? '').trim().slice(0, 120);
    const rozeeUserId    = String(req.body?.rozeeUserId    ?? '').trim().slice(0, 120) || null;
    const rozeeTopJobJid = String(req.body?.rozeeTopJobJid ?? '').trim().slice(0, 120) || null;
    const sourceUrl      = String(req.body?.sourceUrl      ?? '').trim().slice(0, 500) || null;
    const candidateName  = String(req.body?.candidateName  ?? '').trim().slice(0, 200) || null;
    // rozeeCvId is OPTIONAL — many rozeegpt pages don't expose a stable id in the DOM
    // (CV viewer modals especially). Content-addressed sha256 below covers dedup.
    const rozeeCvId      = rozeeCvIdRaw || null;

    const ingestedByUserId = req.user.id;
    // Defer externalMessageId composition until after we've computed sha256 so
    // we can use it as the fallback identity when rozeeCvId is absent.

    // Content-addressed dedup — same file bytes = same sha256, regardless of
    // which user submitted them or what rozeeCvId rozeegpt assigned. Prevents
    // wasted uploads + the "different rozeeCvId for the same content" bug
    // where createAttachment's sha256 check would throw mid-pipeline.
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    // External message id: prefer rozeeCvId for stable cross-tab/cross-session
    // dedup, fall back to content sha256 so the same file ingested twice is a
    // dedup-hit regardless of where it came from.
    const externalMessageId = rozeeCvId
      ? `rozee-${rozeeCvId}-${ingestedByUserId}`
      : `rozee-sha256-${sha256}-${ingestedByUserId}`;
    const db = supabaseAdminClient();
    const { data: existingAtt } = await db
      .from('inbox_attachments')
      .select('id, inbox_message_id, parsing_status')
      .eq('sha256', sha256)
      .eq('attachment_type', 'cv')
      .limit(1)
      .maybeSingle();
    if (existingAtt) {
      return res.json({
        ok: true,
        duplicate: true,
        attachmentId:   existingAtt.id,
        inboxMessageId: existingAtt.inbox_message_id,
        parseStatus:    existingAtt.parsing_status ?? null,
        message: 'Already in Falisha — same file already imported',
      });
    }

    // ── inbox_messages row ──
    // If a prior request created the message but crashed before creating the
    // attachment, we still want to recover — look up the existing message
    // and reuse its id rather than erroring.
    let inboxMessage: { id: string };
    try {
      inboxMessage = await createInboxMessage({
        source: 'rozeegpt',
        externalMessageId,
        payload: {
          rozeeCvId, rozeeUserId, rozeeTopJobJid, sourceUrl, candidateName,
          ingestedByUserId,
          ingestedAt: new Date().toISOString(),
          fileName: file.originalname, fileBytes: file.size, sha256,
        },
      });
    } catch (err) {
      if (err instanceof AppError && err.type === ErrorType.DUPLICATE) {
        const { data: existing } = await db
          .from('inbox_messages')
          .select('id')
          .eq('source', 'rozeegpt')
          .eq('external_message_id', externalMessageId)
          .limit(1)
          .maybeSingle();
        if (!existing) throw err; // shouldn't happen — re-surface if it does
        inboxMessage = existing as { id: string };
      } else {
        throw err;
      }
    }

    // ── Supabase Storage + attachment row ──
    // Deterministic sha256 path: retries upsert to the same key instead of
    // leaking new copies. Bucket is 'documents' to match every other ingestion
    // path (Gmail / Hostinger / Drive / WhatsApp), so the cv-parsing worker
    // finds the file at the canonical location.
    const safeName = safeFileNamePart(file.originalname);
    let attachment;
    try {
      attachment = await createAttachment({
        inboxMessageId: inboxMessage.id,
        fileBuffer:     file.buffer,
        fileName:       safeName,
        mimeType:       file.mimetype || 'application/pdf',
        attachmentType: 'cv',
        storageBucket:  'documents',
        storagePath:    `rozeegpt/${sha256}.pdf`,
        messageSubject: candidateName ? `RozeeGPT CV: ${candidateName}` : `RozeeGPT CV: ${safeName}`,
        messageSource:  'rozeegpt',
      });
    } catch (err) {
      // Belt-and-suspenders: if the sha256 pre-check above somehow missed (race
      // between two concurrent requests for the same file), createAttachment's
      // own sha256 dedup will throw DUPLICATE — convert that into a friendly
      // success too.
      if (err instanceof AppError && err.type === ErrorType.DUPLICATE) {
        const { data: a2 } = await db.from('inbox_attachments')
          .select('id, inbox_message_id, parsing_status')
          .eq('sha256', sha256).eq('attachment_type', 'cv')
          .limit(1).maybeSingle();
        return res.json({
          ok: true, duplicate: true,
          attachmentId: a2?.id ?? null,
          inboxMessageId: a2?.inbox_message_id ?? inboxMessage.id,
          parseStatus: a2?.parsing_status ?? null,
          message: 'Already in Falisha — same file already imported',
        });
      }
      throw err;
    }

    // ── Enqueue parsing — same queue as Gmail/Hostinger ──
    const parsingResult = await enqueueCvParsingJobForAttachment(attachment.id);

    return res.json({
      ok: true,
      duplicate: false,
      attachmentId:    attachment.id,
      inboxMessageId:  inboxMessage.id,
      jobId:           parsingResult.jobId,
      parseStatus:     parsingResult.status,
    });
  } catch (err) {
    console.error('[extension] ingest-cv error:', err);
    return res.status(500).json({
      ok: false,
      error: 'INGEST_FAILED',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ── GET /api/extension/me ───────────────────────────────────────────────────
// Test-connection ping used by the popup's "Test connection" button. Returns
// the resolved user so the popup can show the email + role next to a green dot.
router.get('/me', (req: AuthRequest, res) => {
  return res.json({
    ok: true,
    user: req.user ? { id: req.user.id, email: req.user.email, role: req.user.role } : null,
  });
});

export default router;
