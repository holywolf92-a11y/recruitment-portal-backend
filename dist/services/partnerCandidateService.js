"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPartnerCandidateSource = buildPartnerCandidateSource;
exports.upsertPartnerCandidate = upsertPartnerCandidate;
exports.ingestPartnerBulkAttachment = ingestPartnerBulkAttachment;
exports.uploadPartnerManualDocument = uploadPartnerManualDocument;
const crypto_1 = require("crypto");
const database_1 = require("../config/database");
const documentCategories_1 = require("../config/documentCategories");
const candidateService_1 = require("./candidateService");
const inboxService_1 = require("./inboxService");
const inboxAttachmentService_1 = require("./inboxAttachmentService");
const STORAGE_BUCKET = 'documents';
function sanitizePartnerToken(value) {
    return String(value || '')
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function buildPartnerCandidateSource(partner) {
    const safeName = sanitizePartnerToken(partner.partnerName) || 'Partner';
    const safeCompany = sanitizePartnerToken(partner.partnerCompany);
    void safeName;
    void safeCompany;
    return 'Manual';
}
function isMissingValue(value) {
    if (value === null || value === undefined)
        return true;
    if (typeof value !== 'string')
        return false;
    const normalized = value.trim().toLowerCase();
    return !normalized || ['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided'].includes(normalized);
}
function sanitizeText(value) {
    const trimmed = String(value || '').trim();
    return trimmed || null;
}
function sanitizeEmail(value) {
    const trimmed = String(value || '').trim().toLowerCase();
    return trimmed || null;
}
async function findSingleCandidateByField(field, value, matchedBy) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidates')
        .select('id,name,email,phone,address,nationality,position,country_of_interest,cnic_normalized,passport_normalized,source,field_sources,partner_id,partner_name,is_partner_candidate')
        .eq(field, value)
        .neq('status', 'Deleted')
        .order('created_at', { ascending: false })
        .limit(2);
    if (error)
        throw error;
    const rows = (data || []);
    if (rows.length > 1) {
        throw new Error(`Multiple candidates matched on ${matchedBy}. Resolve duplicates before continuing.`);
    }
    return { candidate: rows[0] || null, matchedBy: rows[0] ? matchedBy : null };
}
async function findMatchingCandidate(input) {
    const normalizedCnic = input.cnic ? (0, candidateService_1.normalizeCNIC)(input.cnic) : null;
    const explicitPassport = sanitizeText(input.passport);
    const inferredPassport = !explicitPassport && input.cnic && !normalizedCnic ? sanitizeText(input.cnic) : null;
    const normalizedPassport = explicitPassport
        ? (0, candidateService_1.normalizePassport)(explicitPassport)
        : inferredPassport
            ? (0, candidateService_1.normalizePassport)(inferredPassport)
            : null;
    const normalizedPhone = input.phone ? (0, candidateService_1.normalizePhoneE164)(input.phone) : null;
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
async function upsertPartnerCandidate(input, partner) {
    const db = (0, database_1.supabaseAdminClient)();
    const partnerSource = buildPartnerCandidateSource(partner);
    const match = await findMatchingCandidate(input);
    if (!match.candidate) {
        const candidate = await (0, candidateService_1.createCandidate)({
            name: input.name.trim(),
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
        }, partner.partnerId);
        return {
            candidate,
            created: true,
            matchedBy: null,
            updatedFields: [],
        };
    }
    const current = match.candidate;
    const now = new Date().toISOString();
    const updateData = {
        partner_id: partner.partnerId,
        partner_name: partner.partnerName,
        is_partner_candidate: true,
        updated_at: now,
    };
    const updatedFields = [];
    const fieldSources = { ...(current.field_sources || {}) };
    const maybeFill = (column, nextValue) => {
        if (!nextValue) {
            return;
        }
        const currentValue = current[column];
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
    maybeFill('name', sanitizeText(input.name));
    maybeFill('email', match.normalizedEmail);
    maybeFill('phone', match.normalizedPhone);
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
    if (error)
        throw error;
    return {
        candidate,
        created: false,
        matchedBy: match.matchedBy,
        updatedFields,
    };
}
function sanitizeStoragePathSegment(fileName) {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function detectMimeType(fileName) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.pdf'))
        return 'application/pdf';
    if (lower.endsWith('.doc'))
        return 'application/msword';
    if (lower.endsWith('.docx'))
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.png'))
        return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))
        return 'image/jpeg';
    return 'application/octet-stream';
}
async function ingestPartnerBulkAttachment(args) {
    const message = await (0, inboxService_1.createInboxMessage)({
        source: 'web',
        externalMessageId: `partner-bulk:${args.candidateId}:${(0, crypto_1.randomUUID)()}`,
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
    const attachment = await (0, inboxAttachmentService_1.createAttachment)({
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
    let parsingJobId = null;
    if (attachment?.attachment_kind === 'cv') {
        const queued = await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(attachment.id, { force: false, expiresInSeconds: 3600 });
        parsingJobId = queued.jobId || null;
    }
    return {
        messageId: message.id,
        attachmentId: attachment.id,
        attachmentKind: attachment.attachment_kind,
        parsingJobId,
    };
}
function resolveManualDocumentType(candidate, requestedType, fileName) {
    const requested = String(requestedType || '').trim().toLowerCase();
    const lowerFileName = String(fileName || '').trim().toLowerCase();
    if (requested === 'cv') {
        return {
            documentType: 'other',
            category: documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME,
            flagColumn: 'cv_received',
            flagAtColumn: 'cv_received_at',
        };
    }
    if (requested === 'cnic' || lowerFileName.includes('cnic') || lowerFileName.includes('idcard') || lowerFileName.includes('id_card')) {
        return {
            documentType: 'cnic',
            category: documentCategories_1.DOCUMENT_CATEGORIES.CNIC,
            flagColumn: 'cnic_received',
            flagAtColumn: 'cnic_received_at',
        };
    }
    if (requested === 'passport' ||
        (requested === 'passport_cnic' && !candidate.cnic_normalized) ||
        lowerFileName.includes('passport')) {
        return {
            documentType: 'passport',
            category: documentCategories_1.DOCUMENT_CATEGORIES.PASSPORT,
            flagColumn: 'passport_received',
            flagAtColumn: 'passport_received_at',
        };
    }
    return {
        documentType: 'other',
        category: documentCategories_1.DOCUMENT_CATEGORIES.PASSPORT,
        flagColumn: candidate.cnic_normalized ? 'cnic_received' : 'passport_received',
        flagAtColumn: candidate.cnic_normalized ? 'cnic_received_at' : 'passport_received_at',
    };
}
async function uploadPartnerManualDocument(args) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data: candidate, error: candidateError } = await db
        .from('candidates')
        .select('id,cnic_normalized,passport_normalized')
        .eq('id', args.candidateId)
        .maybeSingle();
    if (candidateError)
        throw candidateError;
    if (!candidate)
        throw new Error('Candidate not found');
    const resolved = resolveManualDocumentType(candidate, args.requestedType, args.fileName);
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
        verification_status: documentCategories_1.VERIFICATION_STATUS.VERIFIED,
        verification_source: 'partner_manual_upload',
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
