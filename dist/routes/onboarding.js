"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const candidateDocumentService_1 = require("../services/candidateDocumentService");
const progressiveDataCompletionService_1 = require("../services/progressiveDataCompletionService");
const timelineService_1 = require("../services/timelineService");
const router = (0, express_1.Router)();
const documentUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
});
const photoUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 2 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
            return;
        }
        cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    },
});
const ONBOARDING_DOCUMENTS = [
    { key: 'passport', label: 'Passport', documentType: 'passport', receivedFlag: 'passport_received' },
    { key: 'cnic', label: 'CNIC', documentType: 'cnic', receivedFlag: 'cnic_received' },
    { key: 'driving_license', label: 'Driving License', documentType: 'driving_license', receivedFlag: 'driving_license_received' },
    { key: 'police_character_certificate', label: 'Police Character Certificate', documentType: 'police_character_certificate', receivedFlag: 'police_character_received' },
    { key: 'certificate', label: 'Certificates', documentType: 'certificate', receivedFlag: 'certificate_received' },
    { key: 'medical', label: 'Medical Report', documentType: 'medical', receivedFlag: 'medical_received' },
    { key: 'visa', label: 'Visa', documentType: 'visa', receivedFlag: 'visa_received' },
];
function getToken(req) {
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    const bodyToken = typeof req.body?.token === 'string' ? req.body.token : '';
    return (queryToken || bodyToken).trim().toUpperCase();
}
async function getCandidateByToken(token) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidates')
        .select('*')
        .eq('email_tracking_token', token)
        .neq('status', 'Deleted')
        .maybeSingle();
    if (error) {
        throw error;
    }
    return data ?? null;
}
async function withSignedProfilePhoto(candidate) {
    if (!candidate) {
        return candidate;
    }
    const enrichedCandidate = { ...candidate };
    const db = (0, database_1.supabaseAdminClient)();
    let bucket = enrichedCandidate.profile_photo_bucket || 'documents';
    let storagePath = enrichedCandidate.profile_photo_path || null;
    if (!storagePath && enrichedCandidate.profile_photo_url) {
        const url = String(enrichedCandidate.profile_photo_url);
        const publicMarker = '/storage/v1/object/public/';
        const signedMarker = '/storage/v1/object/sign/';
        if (url.includes(publicMarker)) {
            const rest = url.substring(url.indexOf(publicMarker) + publicMarker.length);
            const parts = rest.split('/');
            bucket = parts.shift() || bucket;
            storagePath = parts.join('/');
        }
        else if (url.includes(signedMarker)) {
            const rest = url.substring(url.indexOf(signedMarker) + signedMarker.length).split('?')[0];
            const parts = rest.split('/');
            bucket = parts.shift() || bucket;
            storagePath = parts.join('/');
        }
    }
    if (storagePath) {
        const { data } = await db.storage.from(bucket).createSignedUrl(storagePath, 31536000);
        if (data?.signedUrl) {
            enrichedCandidate.profile_photo_signed_url = data.signedUrl;
        }
    }
    enrichedCandidate.passport = enrichedCandidate.passport_normalized || enrichedCandidate.passport || null;
    return enrichedCandidate;
}
function buildMissingDocuments(candidate) {
    return ONBOARDING_DOCUMENTS.map((doc) => ({
        key: doc.key,
        label: doc.label,
        document_type: doc.documentType,
        received: Boolean(candidate?.[doc.receivedFlag]),
    })).filter((doc) => !doc.received);
}
function computeCompletion(candidate) {
    const profileChecks = [
        Boolean(candidate?.name),
        Boolean(candidate?.email),
        Boolean(candidate?.phone),
        Boolean(candidate?.date_of_birth),
        Boolean(candidate?.address),
        Boolean(candidate?.profile_photo_path || candidate?.profile_photo_url),
    ];
    const documentChecks = ONBOARDING_DOCUMENTS.map((doc) => Boolean(candidate?.[doc.receivedFlag]));
    const profile = Math.round((profileChecks.filter(Boolean).length / profileChecks.length) * 100);
    const documents = Math.round((documentChecks.filter(Boolean).length / documentChecks.length) * 100);
    return {
        profile,
        documents,
        overall: Math.round((profile + documents) / 2),
    };
}
async function buildOnboardingPayload(candidate) {
    const signedCandidate = await withSignedProfilePhoto(candidate);
    const documents = await (0, candidateDocumentService_1.listCandidateDocumentsByCandidate)(candidate.id);
    const formattedDocuments = await Promise.all(documents.map((doc) => (0, candidateDocumentService_1.formatDocumentResponse)(doc)));
    return {
        candidate: signedCandidate,
        documents: formattedDocuments,
        missing_documents: buildMissingDocuments(signedCandidate),
        completion: computeCompletion(signedCandidate),
    };
}
async function ensureAuthenticatedCandidateAccess(req, candidate, confirmEmailMismatch) {
    const userId = req.user?.id;
    const userEmail = String(req.user?.email || '').trim().toLowerCase();
    const candidateEmail = String(candidate?.email || '').trim().toLowerCase();
    const db = (0, database_1.supabaseAdminClient)();
    if (!userId) {
        throw new Error('Authenticated user is required');
    }
    if (candidate.user_id && candidate.user_id !== userId) {
        return {
            ok: false,
            status: 403,
            body: { error: 'This onboarding profile is already linked to another Google account.' },
        };
    }
    if (!candidate.user_id) {
        const emailMatches = !candidateEmail || !userEmail || candidateEmail === userEmail;
        if (!emailMatches && !confirmEmailMismatch) {
            return {
                ok: false,
                status: 409,
                body: {
                    error: 'Google account email does not match candidate email.',
                    code: 'GOOGLE_EMAIL_MISMATCH',
                    candidate_email: candidate.email || null,
                    google_email: req.user?.email || null,
                },
            };
        }
        const { error } = await db
            .from('candidates')
            .update({
            user_id: userId,
            updated_at: new Date().toISOString(),
        })
            .eq('id', candidate.id)
            .is('user_id', null);
        if (error) {
            throw error;
        }
    }
    return { ok: true };
}
router.get('/', async (req, res) => {
    try {
        const token = getToken(req);
        if (!token) {
            return res.status(400).json({ error: 'token is required' });
        }
        const candidate = await getCandidateByToken(token);
        if (!candidate) {
            return res.status(404).json({ error: 'Onboarding profile not found' });
        }
        return res.json(await buildOnboardingPayload(candidate));
    }
    catch (error) {
        console.error('Failed to load onboarding profile:', error);
        return res.status(500).json({ error: error.message || 'Failed to load onboarding profile' });
    }
});
router.post('/documents', documentUpload.single('file'), async (req, res) => {
    try {
        const token = getToken(req);
        const documentType = String(req.body?.document_type || '').trim();
        if (!token) {
            return res.status(400).json({ error: 'token is required' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'file is required' });
        }
        const candidate = await getCandidateByToken(token);
        if (!candidate) {
            return res.status(404).json({ error: 'Onboarding profile not found' });
        }
        const uploadResult = await (0, candidateDocumentService_1.uploadCandidateDocument)({
            candidate_id: candidate.id,
            file_name: req.file.originalname,
            mime_type: req.file.mimetype,
            buffer: req.file.buffer,
            source: 'web',
            uploaded_by_user_id: 'onboarding-token',
            document_type: documentType || undefined,
        });
        return res.status(201).json({
            success: true,
            document: await (0, candidateDocumentService_1.formatDocumentResponse)(uploadResult.document),
            request_id: uploadResult.request_id,
            onboarding: await buildOnboardingPayload(await getCandidateByToken(token)),
        });
    }
    catch (error) {
        console.error('Failed to upload onboarding document:', error);
        return res.status(400).json({ error: error.message || 'Failed to upload document' });
    }
});
router.put('/profile', auth_1.authenticate, async (req, res) => {
    try {
        const token = getToken(req);
        const confirmEmailMismatch = req.body?.confirm_email_mismatch === true;
        if (!token) {
            return res.status(400).json({ error: 'token is required' });
        }
        const candidate = await getCandidateByToken(token);
        if (!candidate) {
            return res.status(404).json({ error: 'Onboarding profile not found' });
        }
        const access = await ensureAuthenticatedCandidateAccess(req, candidate, confirmEmailMismatch);
        if (!access.ok) {
            return res.status(access.status ?? 403).json(access.body);
        }
        const editableFields = [
            ['name', req.body?.name],
            ['phone', req.body?.phone],
            ['email', req.body?.email],
            ['date_of_birth', req.body?.date_of_birth || req.body?.dob],
            ['address', req.body?.address],
        ];
        const changedFields = [];
        for (const [field, nextValue] of editableFields) {
            if (nextValue === undefined) {
                continue;
            }
            await (0, progressiveDataCompletionService_1.updateFieldManually)(candidate.id, field, nextValue, req.user?.id);
            changedFields.push(field);
        }
        if (changedFields.length > 0) {
            await (0, timelineService_1.logProfileUpdated)(candidate.id, req.user?.id, {
                fields_updated: changedFields,
                source: 'candidate_onboarding',
            });
        }
        const refreshedCandidate = await getCandidateByToken(token);
        return res.json({
            success: true,
            ...await buildOnboardingPayload(refreshedCandidate),
        });
    }
    catch (error) {
        console.error('Failed to update onboarding profile:', error);
        return res.status(400).json({ error: error.message || 'Failed to update profile' });
    }
});
router.post('/profile-photo', auth_1.authenticate, photoUpload.single('photo'), async (req, res) => {
    try {
        const token = getToken(req);
        const confirmEmailMismatch = req.body?.confirm_email_mismatch === 'true' || req.body?.confirm_email_mismatch === true;
        if (!token) {
            return res.status(400).json({ error: 'token is required' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'photo is required' });
        }
        const candidate = await getCandidateByToken(token);
        if (!candidate) {
            return res.status(404).json({ error: 'Onboarding profile not found' });
        }
        const access = await ensureAuthenticatedCandidateAccess(req, candidate, confirmEmailMismatch);
        if (!access.ok) {
            return res.status(access.status ?? 403).json(access.body);
        }
        const db = (0, database_1.supabaseAdminClient)();
        const extension = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
        const fileName = `profile.${extension}`;
        const storagePath = `candidates/${candidate.id}/profile/${fileName}`;
        const bucket = 'documents';
        const { error: uploadError } = await db.storage
            .from(bucket)
            .upload(storagePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: true,
        });
        if (uploadError) {
            throw uploadError;
        }
        const { error: updateError } = await db
            .from('candidates')
            .update({
            profile_photo_bucket: bucket,
            profile_photo_path: storagePath,
            photo_received: true,
            photo_received_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
            .eq('id', candidate.id);
        if (updateError) {
            throw updateError;
        }
        await (0, timelineService_1.logProfileUpdated)(candidate.id, req.user?.id, {
            fields_updated: ['profile_photo'],
            source: 'candidate_onboarding',
        });
        const refreshedCandidate = await getCandidateByToken(token);
        return res.json({
            success: true,
            ...await buildOnboardingPayload(refreshedCandidate),
        });
    }
    catch (error) {
        console.error('Failed to upload onboarding profile photo:', error);
        return res.status(400).json({ error: error.message || 'Failed to upload profile photo' });
    }
});
exports.default = router;
