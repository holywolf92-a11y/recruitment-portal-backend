import { Router, Request, Response } from 'express';
import multer from 'multer';
import { createLogger, asyncHandler } from '../utils/errorHandling';
import { supabaseAdminClient } from '../config/database';
// import { authenticate } from '../middleware/auth';
// Old document controllers removed - using unified candidate-documents system
import {
  uploadCandidateDocumentController,
  getCandidateDocumentController,
  listCandidateDocumentsControllerNew,
  getCandidateDocumentDownloadUrlController,
  deleteCandidateDocumentController,
  reprocessCandidateDocumentController,
  overrideCandidateDocumentController,
  splitUploadController,
} from '../controllers/documentController';
import { quickApproveCandidateDocument } from '../controllers/quickApproveController';
import { fixApprovedPhotos } from '../controllers/fixApprovedPhotosController';
import { extractPhotoFromPdfController } from '../controllers/pdfPhotoExtractionController';
import { extractPhotoFromPdfAiController } from '../controllers/aiPhotoExtractionController';
import { aiExtractionLimiter } from '../middleware/rateLimit';

const logger = createLogger('DocumentsRouter');

const router = Router();

const UNMATCHED_DOCUMENT_SELECT = [
  'id',
  'inbox_attachment_id',
  'document_type',
  'storage_bucket',
  'storage_path',
  'file_name',
  'source',
  'received_at',
  'needs_manual_review',
  'review_reasons',
  'extracted_metadata',
].join(',');

const LEGACY_UNMATCHED_DOCUMENT_SELECT = [
  'id',
  'inbox_attachment_id',
  'document_type',
  'storage_path',
  'file_name',
  'source',
].join(',');

function normalizeStorageBucket(bucket: unknown): string {
  return typeof bucket === 'string' && bucket.trim() ? bucket : 'documents';
}

function normalizeReviewReasons(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const reasons = value.map((item) => String(item).trim()).filter(Boolean);
    return reasons.length > 0 ? reasons : null;
  }

  return null;
}

function normalizeCandidateDocumentSource(source: unknown): 'gmail' | 'whatsapp' | 'web' | 'manual' {
  const normalized = String(source || '').trim().toLowerCase();

  if (normalized === 'gmail' || normalized === 'email') {
    return 'gmail';
  }

  if (normalized === 'whatsapp') {
    return 'whatsapp';
  }

  if (normalized === 'web') {
    return 'web';
  }

  return 'manual';
}

function normalizeCandidateDocumentType(documentType: unknown): string {
  const normalized = String(documentType || '').trim().toLowerCase();
  const allowed = new Set(['passport', 'cnic', 'degree', 'medical', 'visa', 'certificate']);
  return allowed.has(normalized) ? normalized : 'other';
}

// Bulk processing status (reduces per-candidate polling)
// POST /api/documents/processing-status
// Body: { candidate_ids: string[] }
//
// Root cause of previous 500 errors:
// Supabase-JS sends .select().in('candidate_id', [...N ids...]) as a GET request with URL parameters.
// With 200+ candidates, the URL exceeds the HTTP server's URL size limit (~8 KB), causing PostgREST
// to return a 414/400 error which Supabase-JS puts in `error`, then `throw error` produced a 500.
//
// Correct fix: NEVER pass candidate IDs into a .in() filter on this endpoint.
// Instead, query ALL currently-pending documents system-wide (a small transient set — processed in
// seconds) and filter to the requested candidates in JavaScript.  This keeps the DB query URL tiny.
router.post('/processing-status', async (req: Request, res: Response) => {
  try {
    const candidateIdsRaw = (req.body?.candidate_ids || req.body?.candidateIds) as unknown;
    const candidateIds = Array.isArray(candidateIdsRaw) ? (candidateIdsRaw as string[]) : [];

    if (candidateIds.length === 0) {
      return res.json({ statuses: {} });
    }

    // Build a Set for O(1) membership lookup when filtering query results.
    const candidateIdSet = new Set(candidateIds);

    const db = supabaseAdminClient();

    // KEY DESIGN: Do NOT include candidate_id in the DB filter.
    // Pending documents are transient (they exist for seconds to minutes while being processed).
    // Querying all pending docs across the whole system prevents the URL-length 500 that occurs
    // when 200+ candidate UUIDs are stuffed into a PostgREST GET query parameter.
    const { data, error } = await db
      .from('candidate_documents')
      .select('candidate_id')
      .eq('verification_status', 'pending_ai');

    if (error) {
      // Log full error details to Railway so we can diagnose if it ever happens again.
      logger.error('Processing-status DB query failed', {
        code: (error as any).code,
        message: (error as any).message,
        details: (error as any).details,
        hint: (error as any).hint,
      });
      // Return empty statuses so the UI stays stable; do NOT 500 for polling.
      return res.json({ statuses: {} });
    }

    // Aggregate pending counts per candidate, filtered to only the requested candidates.
    const pendingCounts = new Map<string, number>();
    for (const row of data || []) {
      const id = (row as any).candidate_id as string;
      if (candidateIdSet.has(id)) {
        pendingCounts.set(id, (pendingCounts.get(id) || 0) + 1);
      }
    }

    const statuses: Record<string, { isProcessing: boolean; pendingCount: number }> = {};
    for (const id of candidateIds) {
      const pendingCount = pendingCounts.get(id) || 0;
      statuses[id] = {
        isProcessing: pendingCount > 0,
        pendingCount,
      };
    }

    return res.json({ statuses });
  } catch (err: any) {
    logger.error('Unexpected error in processing-status', { message: err?.message, stack: err?.stack });
    return res.json({ statuses: {} });
  }
});

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'image/gif',
      'image/webp',
      'text/plain',
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, PNG, GIF, WEBP, and TXT files are allowed.'));
    }
  },
});

// All routes require authentication
// router.use(authenticate);

// ============================================================================
// NEW ROUTES - AI Document Verification System
// ============================================================================

// Multer error handler middleware
const handleMulterError = (err: any, req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    return next(err);
  }
  if (err) {
    return next(err);
  }
  next();
};

// Split-and-categorize upload: preserve original -> parser -> create docs (create candidate if none)
router.post('/split-upload', upload.single('file'), handleMulterError, asyncHandler(splitUploadController));

// Upload endpoint with extended timeout for large files
router.post('/candidate-documents',
  (req: Request, res: Response, next: any) => {
    req.setTimeout(300000, () => {
      if (!res.headersSent) {
        res.status(408).json({ error: 'Upload timeout. Please try again with a smaller file.' });
      }
    });
    next();
  },
  upload.single('file'),
  handleMulterError,
  asyncHandler(uploadCandidateDocumentController)
);

// Get candidate document by ID
router.get('/candidate-documents/:id', getCandidateDocumentController);

// Get signed URL for download
router.get('/candidate-documents/:id/download', getCandidateDocumentDownloadUrlController);

// Delete candidate document
router.delete('/candidate-documents/:id', deleteCandidateDocumentController);

// Reprocess document verification (re-run AI verification with updated logic)
router.post('/candidate-documents/:id/reprocess', reprocessCandidateDocumentController);

// Admin override document verification (requires admin role)
router.post('/candidate-documents/:id/override', overrideCandidateDocumentController);

// Quick approve pending document (no password required for pending_ai/needs_review)
router.post('/candidate-documents/:id/approve', quickApproveCandidateDocument);

// Fix approved photos that are missing profile_photo_url (retroactive fix)
router.post('/fix-approved-photos', fixApprovedPhotos);

// List documents for a candidate (with category filtering)
router.get('/candidates/:candidateId/documents', listCandidateDocumentsControllerNew);

// Extract photo from PDF profile photo and save as image
router.post('/candidates/:candidateId/extract-photo', asyncHandler(extractPhotoFromPdfController));

// AI-assisted: Extract profile headshot from a PDF document and save as image
router.post('/candidates/:candidateId/extract-photo-ai', aiExtractionLimiter, asyncHandler(extractPhotoFromPdfAiController));

// ============================================================================
// LEGACY ROUTES - REMOVED
// All old endpoints have been removed. Use /candidate-documents endpoints instead.
// ============================================================================
// 
// REMOVED ENDPOINTS (use new unified system instead):
// - POST /api/documents → Use POST /api/documents/candidate-documents
// - GET /api/documents/:id → Use GET /api/documents/candidate-documents/:id
// - GET /api/documents/candidate/:candidateId → Use GET /api/documents/candidates/:candidateId/documents
// - GET /api/documents/:id/download → Use GET /api/documents/candidate-documents/:id/download
// - DELETE /api/documents/:id → Use DELETE /api/documents/candidate-documents/:id
//

// Duplicate route removed - using listCandidateDocumentsControllerNew at line 102 instead

/**
 * GET /api/documents/unmatched
 * Returns unmatched documents pending manual linking
 */
router.get('/unmatched', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const filterStatus = req.query.status as string; // 'pending', 'needs_review', all if not specified

    const buildBaseQuery = (includeManualReviewFilter: boolean, selectColumns: string) => {
      let query = db
        .from('unmatched_documents')
        .select(selectColumns, { count: 'exact' })
        .order('id', { ascending: false })
        .range(offset, offset + limit - 1);

      if (includeManualReviewFilter && filterStatus === 'needs_review') {
        query = query.eq('needs_manual_review', true);
      } else if (includeManualReviewFilter && filterStatus === 'pending') {
        query = query.eq('needs_manual_review', false);
      }

      return query;
    };

    let { data: documents, error, count } = await buildBaseQuery(true, UNMATCHED_DOCUMENT_SELECT);

    const errorMessage = String(error?.message || '');

    if (errorMessage.includes('relation "unmatched_documents" does not exist')) {
      logger.warn('unmatched_documents table missing in current schema; returning empty unmatched documents list');
      return res.json({ documents: [], total: 0, limit, offset });
    }

    if (error && errorMessage.includes('column unmatched_documents.')) {
      logger.warn('Legacy unmatched_documents schema detected; retrying with compatibility query', {
        message: errorMessage,
      });
      ({ data: documents, error, count } = await buildBaseQuery(false, LEGACY_UNMATCHED_DOCUMENT_SELECT));
    }

    if (error) throw error;

    // Generate download URLs
    const unmatchedDocuments = ((documents || []) as any[]);

    const docsWithUrls = await Promise.all(
      unmatchedDocuments.map(async (doc) => {
        const storageBucket = normalizeStorageBucket((doc as any).storage_bucket);
        const reviewReasons = normalizeReviewReasons((doc as any).review_reasons);

        try {
          const { data } = await db.storage
            .from(storageBucket)
            .createSignedUrl(doc.storage_path, 3600);
          return {
            id: doc.id,
            document_type: doc.document_type,
            file_name: doc.file_name,
            storage_bucket: storageBucket,
            storage_path: doc.storage_path,
            received_at: doc.received_at || null,
            source: doc.source || null,
            extracted_metadata: doc.extracted_metadata || null,
            needs_manual_review: Boolean(doc.needs_manual_review),
            review_reasons: reviewReasons,
            downloadUrl: data?.signedUrl || null,
          };
        } catch (err) {
          logger.warn(`Failed to generate signed URL for ${storageBucket}/${doc.storage_path}`, err);
          return {
            id: doc.id,
            document_type: doc.document_type,
            file_name: doc.file_name,
            storage_bucket: storageBucket,
            storage_path: doc.storage_path,
            received_at: doc.received_at || null,
            source: doc.source || null,
            extracted_metadata: doc.extracted_metadata || null,
            needs_manual_review: Boolean(doc.needs_manual_review),
            review_reasons: reviewReasons,
            downloadUrl: null,
          };
        }
      })
    );

    res.json({
      documents: docsWithUrls,
      total: count || 0,
      limit,
      offset,
    });
  } catch (err: any) {
    logger.error('Failed to fetch unmatched documents', err);
    res.status(500).json({ error: 'Failed to fetch unmatched documents' });
  }
});

/**
 * POST /api/documents/unmatched/:documentId/link
 * Manually link an unmatched document to a candidate
 */
router.post('/unmatched/:documentId/link', async (req: Request, res: Response) => {
  try {
    const { documentId } = req.params;
    const { candidateId } = req.body;

    if (!candidateId) {
      return res.status(400).json({ error: 'candidateId is required' });
    }

    const db = supabaseAdminClient();

    // Get the unmatched document
    const { data: doc, error: docError } = await db
      .from('unmatched_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Verify candidate exists
    const { data: candidate, error: candidateError } = await db
      .from('candidates')
      .select('id')
      .eq('id', candidateId)
      .single();

    if (candidateError || !candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    // Move document to candidate folder
    const storageBucket = normalizeStorageBucket(doc.storage_bucket);
    const normalizedDocumentType = normalizeCandidateDocumentType(doc.document_type);
    const normalizedSource = normalizeCandidateDocumentSource(doc.source);
    const newPath = `candidates/${candidateId}/documents/${normalizedDocumentType}/${doc.file_name}`;

    // Prefer Storage-side move to avoid backend download -> re-upload egress.
    // If move fails, keep original storage_path to avoid broken links.
    let resolvedStoragePath = doc.storage_path as string;
    try {
      const bucket = db.storage.from(storageBucket) as any;
      if (typeof bucket.move === 'function') {
        const { error: moveError } = await bucket.move(doc.storage_path, newPath);
        if (moveError) throw moveError;
        resolvedStoragePath = newPath;
      } else {
        logger.warn('Supabase Storage move() not available; keeping original storage_path to avoid egress');
      }
    } catch (moveErr) {
      logger.warn(`Could not move file, keeping original storage_path`, moveErr);
    }

    // Create candidate_documents entry
    const { error: linkError } = await db
      .from('candidate_documents')
      .insert({
        candidate_id: candidateId,
        document_type: normalizedDocumentType,
        storage_bucket: storageBucket,
        file_name: doc.file_name,
        storage_path: resolvedStoragePath,
        source: normalizedSource,
        ...(doc.received_at ? { received_at: doc.received_at } : {}),
      });

    if (linkError) throw linkError;

    // Delete from unmatched
    const { error: deleteError } = await db
      .from('unmatched_documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) throw deleteError;

    res.json({ success: true, message: 'Document linked to candidate' });
  } catch (err: any) {
    logger.error('Failed to link document', err);
    res.status(500).json({ error: 'Failed to link document' });
  }
});

/**
 * GET /api/documents/checklist/:candidateId
 * Returns document checklist status for a candidate
 */
router.get('/checklist/:candidateId', async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const db = supabaseAdminClient();

    const { data: candidate, error } = await db
      .from('candidates')
      .select(`
        id,
        passport_received,
        passport_received_at,
        cnic_received,
        cnic_received_at,
        degree_received,
        degree_received_at,
        medical_received,
        medical_received_at,
        visa_received,
        visa_received_at
      `)
      .eq('id', candidateId)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    res.json({
      checklist: {
        passport: {
          received: candidate?.passport_received || false,
          receivedAt: candidate?.passport_received_at,
        },
        cnic: {
          received: candidate?.cnic_received || false,
          receivedAt: candidate?.cnic_received_at,
        },
        degree: {
          received: candidate?.degree_received || false,
          receivedAt: candidate?.degree_received_at,
        },
        medical: {
          received: candidate?.medical_received || false,
          receivedAt: candidate?.medical_received_at,
        },
        visa: {
          received: candidate?.visa_received || false,
          receivedAt: candidate?.visa_received_at,
        },
      },
    });
  } catch (err: any) {
    logger.error('Failed to fetch document checklist', err);
    res.status(500).json({ error: 'Failed to fetch checklist' });
  }
});

// ─── Jaro-Winkler similarity (pure TypeScript, no dependencies) ────────────────
function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(s1: string, s2: string): number {
  const jaro = jaroSimilarity(s1, s2);
  let prefix = 0;
  const limit = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < limit; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function normalizeNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DOC_KEYWORDS = ['passport', 'cnic', 'visa', 'degree', 'certificate', 'diploma', 'medical', 'copy',
  'photo', 'cv', 'resume', 'scan', 'img', 'image', 'document', 'attested', 'rig', 'electrician',
  'floorman', 'roustabout', 'driller', 'engineer', 'nursing', 'driver', 'license'];

function extractNameFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[-_.]+/g, ' ').trim();
  const lower = base.toLowerCase();
  if (DOC_KEYWORDS.some(kw => lower.includes(kw))) return null;
  // Skip if too many digits
  const digitRatio = (base.match(/\d/g) || []).length / base.length;
  if (digitRatio > 0.15) return null;
  if (base.length < 4 || base.length > 60) return null;
  return base;
}

function parseFromHeader(header: string): { name: string | null; email: string | null } {
  if (!header) return { name: null, email: null };
  const emailMatch = header.match(/<([^>]+)>/);
  const nameMatch = header.match(/^"?([^"<\n\r]+?)"?\s*(?:<|$)/);
  return {
    email: emailMatch ? emailMatch[1].toLowerCase().trim() : null,
    name: nameMatch ? nameMatch[1].trim() : null,
  };
}

/**
 * POST /api/documents/unmatched/auto-link
 * Automatically link unmatched documents to candidates using fuzzy matching.
 * Signals: sender email (exact, 97%), sender name / extracted_name / filename (Jaro-Winkler).
 * Body: { dryRun?: boolean (default true), minConfidence?: number 0-1 (default 0.92), limit?: number (default 500) }
 */
router.post('/unmatched/auto-link', async (req: Request, res: Response) => {
  try {
    const dryRun: boolean = req.body?.dryRun !== false;
    const minConfidence: number = Math.max(0.85, Math.min(1.0, Number(req.body?.minConfidence) || 0.92));
    const processLimit: number = Math.min(2000, Math.max(1, parseInt(String(req.body?.limit || 500), 10)));

    const db = supabaseAdminClient();

    // ── Load all candidates (name + email for matching) ────────────────────
    const { data: candidates, error: candError } = await db
      .from('candidates')
      .select('id, name, email')
      .limit(5000);

    if (candError) throw candError;
    if (!candidates || candidates.length === 0) {
      return res.json({ dryRun, total: 0, matched: 0, linked: 0, minConfidence: Math.round(minConfidence * 100), results: [] });
    }

    // Build maps
    const emailToCandidateId = new Map<string, string>();
    const candidateNameIndex: Array<{ id: string; normalized: string; original: string }> = [];
    for (const c of candidates as any[]) {
      if (c.email) emailToCandidateId.set(c.email.toLowerCase().trim(), c.id);
      if (c.name) {
        candidateNameIndex.push({ id: c.id, normalized: normalizeNameForMatch(c.name), original: c.name });
      }
    }

    // ── Load unmatched documents ───────────────────────────────────────────
    const { data: docs, error: docsError } = await db
      .from('unmatched_documents')
      .select('id, file_name, extracted_phone, extracted_name, extracted_email, storage_bucket, storage_path, document_type, source, received_at')
      .limit(processLimit);

    if (docsError) throw docsError;

    const results: Array<{
      docId: string;
      fileName: string;
      candidateId: string;
      candidateName: string;
      confidence: number;
      signal: string;
    }> = [];
    let linkedCount = 0;
    let errorCount = 0;

    for (const doc of (docs as any[] || [])) {
      const fromParsed = parseFromHeader(doc.extracted_phone || '');

      let bestCandidateId: string | null = null;
      let bestConfidence = 0;
      let bestSignal = '';
      let bestCandidateName = '';

      // ── Signal 1: email exact match (97%) ────────────────────────────────
      const emailsToTry: string[] = [];
      if (fromParsed.email) emailsToTry.push(fromParsed.email);
      if (doc.extracted_email) emailsToTry.push(String(doc.extracted_email).toLowerCase().trim());

      for (const em of emailsToTry) {
        if (emailToCandidateId.has(em) && 0.97 > bestConfidence) {
          const cId = emailToCandidateId.get(em)!;
          bestCandidateId = cId;
          bestConfidence = 0.97;
          bestSignal = 'email';
          bestCandidateName = (candidates as any[]).find(c => c.id === cId)?.name || '';
        }
      }

      // ── Signal 2: name fuzzy match (Jaro-Winkler) ───────────────────────
      if (bestConfidence < minConfidence) {
        const namesToTry: string[] = [];
        if (fromParsed.name) namesToTry.push(fromParsed.name);
        if (doc.extracted_name) namesToTry.push(String(doc.extracted_name));
        const filenameName = extractNameFromFilename(doc.file_name || '');
        if (filenameName) namesToTry.push(filenameName);

        for (const rawName of namesToTry) {
          const normalized = normalizeNameForMatch(rawName);
          if (normalized.length < 3) continue;
          for (const cand of candidateNameIndex) {
            if (cand.normalized.length < 3) continue;
            const score = jaroWinkler(normalized, cand.normalized);
            if (score > bestConfidence) {
              bestConfidence = score;
              bestCandidateId = cand.id;
              bestSignal = 'name';
              bestCandidateName = cand.original;
            }
          }
        }
      }

      if (bestConfidence >= minConfidence && bestCandidateId) {
        results.push({
          docId: doc.id,
          fileName: doc.file_name,
          candidateId: bestCandidateId,
          candidateName: bestCandidateName,
          confidence: Math.round(bestConfidence * 100),
          signal: bestSignal,
        });

        if (!dryRun) {
          try {
            // Re-use the same link logic as POST /unmatched/:documentId/link
            const storageBucket = normalizeStorageBucket(doc.storage_bucket);
            const normalizedDocumentType = normalizeCandidateDocumentType(doc.document_type);
            const normalizedSource = normalizeCandidateDocumentSource(doc.source);
            const newPath = `candidates/${bestCandidateId}/documents/${normalizedDocumentType}/${doc.file_name}`;

            let resolvedStoragePath = doc.storage_path as string;
            try {
              const bucket = db.storage.from(storageBucket) as any;
              if (typeof bucket.move === 'function') {
                const { error: moveError } = await bucket.move(doc.storage_path, newPath);
                if (!moveError) resolvedStoragePath = newPath;
              }
            } catch (_) { /* keep original path */ }

            const { error: linkError } = await db.from('candidate_documents').insert({
              candidate_id: bestCandidateId,
              document_type: normalizedDocumentType,
              storage_bucket: storageBucket,
              file_name: doc.file_name,
              storage_path: resolvedStoragePath,
              source: normalizedSource,
              ...(doc.received_at ? { received_at: doc.received_at } : {}),
            });

            if (linkError) throw linkError;

            await db.from('unmatched_documents').delete().eq('id', doc.id);

            linkedCount++;
          } catch (linkErr: any) {
            logger.error(`Auto-link failed for doc ${doc.id}`, { message: linkErr?.message });
            errorCount++;
          }
        }
      }
    }

    logger.info('Auto-link run complete', {
      dryRun,
      total: docs?.length || 0,
      matched: results.length,
      linked: linkedCount,
      errors: errorCount,
      minConfidence,
    });

    return res.json({
      dryRun,
      total: docs?.length || 0,
      matched: results.length,
      linked: linkedCount,
      errors: errorCount,
      minConfidence: Math.round(minConfidence * 100),
      results,
    });
  } catch (err: any) {
    logger.error('Auto-link endpoint error', { message: err?.message, stack: err?.stack });
    return res.status(500).json({ error: 'Auto-link failed: ' + (err?.message || 'Unknown error') });
  }
});

export default router;
