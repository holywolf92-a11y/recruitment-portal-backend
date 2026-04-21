import { randomUUID } from 'crypto';
import { supabaseAdminClient } from '../config/database';
import { DOCUMENT_CATEGORIES, VERIFICATION_STATUS } from '../config/documentCategories';
import { createCandidate, normalizeCNIC, normalizePassport, normalizePhoneE164 } from './candidateService';
import { createInboxMessage } from './inboxService';
import { createAttachment, enqueueCvParsingJobForAttachment } from './inboxAttachmentService';

const STORAGE_BUCKET = 'documents';

type CandidateRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address?: string | null;
  nationality?: string | null;
  position?: string | null;
  country_of_interest?: string | null;
  cnic_normalized?: string | null;
  passport_normalized?: string | null;
  source?: string | null;
  field_sources?: Record<string, any> | null;
  partner_id?: string | null;
  partner_name?: string | null;
  is_partner_candidate?: boolean | null;
};

export interface PartnerCandidateInput {
  name: string;
  father_name?: string;
  cnic?: string;
  passport?: string;
  email?: string;
  phone?: string;
  position?: string;
  country_of_interest?: string;
  nationality?: string;
  address?: string;
}

export interface PartnerContext {
  partnerId: string;
  partnerName: string;
  partnerCompany?: string | null;
}

export interface PartnerCandidateUpsertResult {
  candidate: any;
  created: boolean;
  matchedBy: 'cnic' | 'passport' | 'phone' | 'email' | null;
  updatedFields: string[];
}

function sanitizePartnerToken(value?: string | null) {
  return String(value || '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildPartnerCandidateSource(partner: PartnerContext) {
  const safeName = sanitizePartnerToken(partner.partnerName) || 'Partner';
  const safeCompany = sanitizePartnerToken(partner.partnerCompany);
  void safeName;
  void safeCompany;
  return 'Manual';
}

function isMissingValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return !normalized || ['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided'].includes(normalized);
}

function sanitizeText(value?: string | null) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function sanitizeEmail(value?: string | null) {
  const trimmed = String(value || '').trim().toLowerCase();
  return trimmed || null;
}

async function findSingleCandidateByField(
  field: 'cnic_normalized' | 'passport_normalized' | 'phone' | 'email',
  value: string,
  matchedBy: 'cnic' | 'passport' | 'phone' | 'email',
): Promise<{ candidate: CandidateRow | null; matchedBy: PartnerCandidateUpsertResult['matchedBy'] }> {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('candidates')
    .select('id,name,email,phone,address,nationality,position,country_of_interest,cnic_normalized,passport_normalized,source,field_sources,partner_id,partner_name,is_partner_candidate')
    .eq(field, value)
    .neq('status', 'Deleted')
    .order('created_at', { ascending: false })
    .limit(2);

  if (error) throw error;
  const rows = (data || []) as CandidateRow[];
  if (rows.length > 1) {
    throw new Error(`Multiple candidates matched on ${matchedBy}. Resolve duplicates before continuing.`);
  }

  return { candidate: rows[0] || null, matchedBy: rows[0] ? matchedBy : null };
}

async function findMatchingCandidate(input: PartnerCandidateInput) {
  const normalizedCnic = input.cnic ? normalizeCNIC(input.cnic) : null;
  const explicitPassport = sanitizeText(input.passport);
  const inferredPassport = !explicitPassport && input.cnic && !normalizedCnic ? sanitizeText(input.cnic) : null;
  const normalizedPassport = explicitPassport
    ? normalizePassport(explicitPassport)
    : inferredPassport
      ? normalizePassport(inferredPassport)
      : null;
  const normalizedPhone = input.phone ? normalizePhoneE164(input.phone) : null;
  const normalizedEmail = sanitizeEmail(input.email);

  if (normalizedCnic) {
    const byCnic = await findSingleCandidateByField('cnic_normalized', normalizedCnic, 'cnic');
    if (byCnic.candidate) {
      return { ...byCnic, normalizedCnic, normalizedPassport, normalizedPhone, normalizedEmail };
    }
  }

  if (normalizedPassport) {
    const byPassport = await findSingleCandidateByField('passport_normalized', normalizedPassport, 'passport');
    if (byPassport.candidate) {
      return { ...byPassport, normalizedCnic, normalizedPassport, normalizedPhone, normalizedEmail };
    }
  }

  if (normalizedPhone) {
    const byPhone = await findSingleCandidateByField('phone', normalizedPhone, 'phone');
    if (byPhone.candidate) {
      return { ...byPhone, normalizedCnic, normalizedPassport, normalizedPhone, normalizedEmail };
    }
  }

  if (normalizedEmail) {
    const byEmail = await findSingleCandidateByField('email', normalizedEmail, 'email');
    if (byEmail.candidate) {
      return { ...byEmail, normalizedCnic, normalizedPassport, normalizedPhone, normalizedEmail };
    }
  }

  return {
    candidate: null,
    matchedBy: null,
    normalizedCnic,
    normalizedPassport,
    normalizedPhone,
    normalizedEmail,
  };
}

/**
 * Partner-specific variant: only deduplicates by CNIC or passport.
 * Phone and email are skipped because partners pre-fill their own contact
 * details for every candidate — using them for matching would collapse all
 * partner candidates into a single record.
 */
async function findMatchingCandidateForPartner(input: PartnerCandidateInput) {
  const normalizedCnic = input.cnic ? normalizeCNIC(input.cnic) : null;
  const explicitPassport = sanitizeText(input.passport);
  const inferredPassport = !explicitPassport && input.cnic && !normalizedCnic ? sanitizeText(input.cnic) : null;
  const normalizedPassport = explicitPassport
    ? normalizePassport(explicitPassport)
    : inferredPassport
      ? normalizePassport(inferredPassport)
      : null;
  const normalizedPhone = input.phone ? normalizePhoneE164(input.phone) : null;
  const normalizedEmail = sanitizeEmail(input.email);

  if (normalizedCnic) {
    const byCnic = await findSingleCandidateByField('cnic_normalized', normalizedCnic, 'cnic');
    if (byCnic.candidate) {
      return { ...byCnic, normalizedCnic, normalizedPassport, normalizedPhone, normalizedEmail };
    }
  }

  if (normalizedPassport) {
    const byPassport = await findSingleCandidateByField('passport_normalized', normalizedPassport, 'passport');
    if (byPassport.candidate) {
      return { ...byPassport, normalizedCnic, normalizedPassport, normalizedPhone, normalizedEmail };
    }
  }

  // Deliberately skip phone/email matching for partner uploads
  return {
    candidate: null,
    matchedBy: null,
    normalizedCnic,
    normalizedPassport,
    normalizedPhone,
    normalizedEmail,
  };
}

export async function upsertPartnerCandidate(input: PartnerCandidateInput, partner: PartnerContext): Promise<PartnerCandidateUpsertResult> {
  const db = supabaseAdminClient();
  const partnerSource = buildPartnerCandidateSource(partner);
  // Use partner-specific matching: only CNIC/passport, never phone/email
  // (partners pre-fill their own contact info, so phone/email cannot identify unique candidates)
  const match = await findMatchingCandidateForPartner(input);

  if (!match.candidate) {
    const candidate = await createCandidate(
      {
        name: input.name.trim(),
        father_name: sanitizeText(input.father_name) || undefined,
        email: match.normalizedEmail || undefined,
        phone: match.normalizedPhone || undefined,
        cnic: match.normalizedCnic || undefined,
        passport: match.normalizedPassport || undefined,
        position: sanitizeText(input.position) || undefined,
        country_of_interest: sanitizeText(input.country_of_interest) || undefined,
        nationality: sanitizeText(input.nationality) || undefined,
        address: sanitizeText(input.address) || undefined,
        status: 'Applied',
        source: 'Manual',
        partner_id: partner.partnerId,
        partner_name: partner.partnerName,
        is_partner_candidate: true,
      },
      partner.partnerId,
    );

    return {
      candidate,
      created: true,
      matchedBy: null,
      updatedFields: [],
    };
  }

  const current = match.candidate;
  const now = new Date().toISOString();
  const updateData: Record<string, any> = {
    partner_id: partner.partnerId,
    partner_name: partner.partnerName,
    is_partner_candidate: true,
    updated_at: now,
  };
  const updatedFields: string[] = [];
  const fieldSources = { ...(current.field_sources || {}) };

  const maybeFill = (column: string, nextValue: string | null) => {
    if (!nextValue) {
      return;
    }
    const currentValue = (current as Record<string, any>)[column];
    if (!isMissingValue(currentValue)) {
      return;
    }
    updateData[column] = nextValue;
    updatedFields.push(column);
    fieldSources[column] = {
      field: column,
      source: 'partner_portal',
      updated_at: now,
      updated_by: partner.partnerId,
    };
  };

  // Always use the partner-provided candidate name (overwrite existing)
  const sanitizedName = sanitizeText(input.name);
  if (sanitizedName) {
    updateData['name'] = sanitizedName;
    updatedFields.push('name');
    fieldSources['name'] = { field: 'name', source: 'partner_portal', updated_at: now, updated_by: partner.partnerId };
  }
  maybeFill('father_name', sanitizeText(input.father_name));
  // Always overwrite phone/email with partner's contact details (partner is the point of contact)
  if (match.normalizedEmail) {
    updateData['email'] = match.normalizedEmail;
    updatedFields.push('email');
    fieldSources['email'] = { field: 'email', source: 'partner_portal', updated_at: now, updated_by: partner.partnerId };
  }
  if (match.normalizedPhone) {
    updateData['phone'] = match.normalizedPhone;
    updatedFields.push('phone');
    fieldSources['phone'] = { field: 'phone', source: 'partner_portal', updated_at: now, updated_by: partner.partnerId };
  }
  maybeFill('address', sanitizeText(input.address));
  maybeFill('nationality', sanitizeText(input.nationality));
  maybeFill('position', sanitizeText(input.position));
  maybeFill('country_of_interest', sanitizeText(input.country_of_interest));
  maybeFill('cnic_normalized', match.normalizedCnic);
  maybeFill('passport_normalized', match.normalizedPassport);

  if (isMissingValue(current.source)) {
    updateData.source = 'Manual';
    updatedFields.push('source');
  }

  if (updatedFields.length > 0) {
    updateData.field_sources = fieldSources;
  }

  const { data: candidate, error } = await db
    .from('candidates')
    .update(updateData)
    .eq('id', current.id)
    .select('*')
    .single();

  if (error) throw error;

  return {
    candidate,
    created: false,
    matchedBy: match.matchedBy,
    updatedFields,
  };
}

function sanitizeStoragePathSegment(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function detectMimeType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export async function ingestPartnerBulkAttachment(args: {
  candidateId: string;
  partner: PartnerContext;
  fileName: string;
  mimeType?: string;
  buffer: Buffer;
}) {
  const message = await createInboxMessage({
    source: 'web',
    externalMessageId: `partner-bulk:${args.candidateId}:${randomUUID()}`,
    payload: {
      origin: 'partner_bulk_upload',
      partner_id: args.partner.partnerId,
      partner_name: args.partner.partnerName,
      partner_company: args.partner.partnerCompany || null,
      candidate_id: args.candidateId,
      file_name: args.fileName,
    },
    status: 'received',
    receivedAt: new Date().toISOString(),
  });

  const attachment = await createAttachment({
    inboxMessageId: message.id,
    fileBuffer: args.buffer,
    fileName: args.fileName,
    mimeType: args.mimeType || detectMimeType(args.fileName),
    attachmentType: 'cv',
    storageBucket: STORAGE_BUCKET,
    storagePath: `partner-bulk/${args.candidateId}/${Date.now()}_${sanitizeStoragePathSegment(args.fileName)}`,
    candidateId: args.candidateId,
    messageSubject: `Partner bulk upload ${args.partner.partnerName}`,
    messageSource: 'web',
  });

  let parsingJobId: string | null = null;
  if (attachment?.attachment_kind === 'cv') {
    const queued = await enqueueCvParsingJobForAttachment(attachment.id, { force: false, expiresInSeconds: 3600 });
    parsingJobId = queued.jobId || null;
  }

  return {
    messageId: message.id,
    attachmentId: attachment.id,
    attachmentKind: attachment.attachment_kind,
    parsingJobId,
  };
}

function resolveManualDocumentType(candidate: CandidateRow, requestedType?: string | null, fileName?: string | null) {
  const requested = String(requestedType || '').trim().toLowerCase();
  const lowerFileName = String(fileName || '').trim().toLowerCase();

  if (requested === 'cv') {
    return {
      documentType: 'other',
      category: DOCUMENT_CATEGORIES.CV_RESUME,
      flagColumn: 'cv_received',
      flagAtColumn: 'cv_received_at',
    };
  }

  if (requested === 'cnic' || lowerFileName.includes('cnic') || lowerFileName.includes('idcard') || lowerFileName.includes('id_card')) {
    return {
      documentType: 'cnic',
      category: DOCUMENT_CATEGORIES.CNIC,
      flagColumn: 'cnic_received',
      flagAtColumn: 'cnic_received_at',
    };
  }

  if (
    requested === 'passport' ||
    (requested === 'passport_cnic' && !candidate.cnic_normalized) ||
    lowerFileName.includes('passport')
  ) {
    return {
      documentType: 'passport',
      category: DOCUMENT_CATEGORIES.PASSPORT,
      flagColumn: 'passport_received',
      flagAtColumn: 'passport_received_at',
    };
  }

  return {
    documentType: 'other',
    category: DOCUMENT_CATEGORIES.PASSPORT,
    flagColumn: candidate.cnic_normalized ? 'cnic_received' : 'passport_received',
    flagAtColumn: candidate.cnic_normalized ? 'cnic_received_at' : 'passport_received_at',
  };
}

export async function uploadPartnerManualDocument(args: {
  candidateId: string;
  partner: PartnerContext;
  requestedType?: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const db = supabaseAdminClient();
  const { data: candidate, error: candidateError } = await db
    .from('candidates')
    .select('id,cnic_normalized,passport_normalized')
    .eq('id', args.candidateId)
    .maybeSingle();

  if (candidateError) throw candidateError;
  if (!candidate) throw new Error('Candidate not found');

  const resolved = resolveManualDocumentType(candidate as CandidateRow, args.requestedType, args.fileName);

  // CVs go through the inbox/parsing pipeline so text is extracted and candidate
  // fields are populated automatically (phone/email remain the partner's contact
  // details since they were already set on the record).
  if (resolved.category === DOCUMENT_CATEGORIES.CV_RESUME) {
    return await ingestPartnerBulkAttachment({
      candidateId: args.candidateId,
      partner: args.partner,
      fileName: args.fileName,
      mimeType: args.mimeType,
      buffer: args.buffer,
    });
  }
  const storagePath = `candidates/${args.candidateId}/partner-manual/${Date.now()}_${sanitizeStoragePathSegment(args.fileName)}`;
  const upload = await db.storage.from(STORAGE_BUCKET).upload(storagePath, args.buffer, {
    contentType: args.mimeType || detectMimeType(args.fileName),
    upsert: false,
  });

  if (upload.error) {
    throw new Error(`Failed to upload document: ${upload.error.message}`);
  }

  const now = new Date().toISOString();
  const insertPayload = {
    candidate_id: args.candidateId,
    document_type: resolved.documentType,
    category: resolved.category,
    detected_category: resolved.category,
    storage_bucket: STORAGE_BUCKET,
    storage_path: storagePath,
    file_name: args.fileName,
    mime_type: args.mimeType || detectMimeType(args.fileName),
    source: 'manual',
    status: 'received',
    verification_status: VERIFICATION_STATUS.VERIFIED,
    verification_source: 'manual_review',
    received_at: now,
    ai_processing_completed_at: now,
    confidence: 1,
    ai_confidence: 1,
  };

  const { data: document, error: documentError } = await db
    .from('candidate_documents')
    .insert(insertPayload)
    .select('*')
    .single();

  if (documentError) {
    await db.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw documentError;
  }

  const flagUpdate = {
    [resolved.flagColumn]: true,
    [resolved.flagAtColumn]: now,
    updated_at: now,
  };
  await db.from('candidates').update(flagUpdate).eq('id', args.candidateId);

  return document;
}