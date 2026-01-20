"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCNIC = normalizeCNIC;
exports.normalizePassport = normalizePassport;
exports.normalizePhoneE164 = normalizePhoneE164;
exports.generateCandidateCode = generateCandidateCode;
exports.checkForDuplicates = checkForDuplicates;
exports.createCandidate = createCandidate;
exports.getCandidateById = getCandidateById;
exports.listCandidates = listCandidates;
exports.bulkUpdateCandidateStatus = bulkUpdateCandidateStatus;
exports.updateCandidate = updateCandidate;
exports.deleteCandidate = deleteCandidate;
const database_1 = require("../config/database");
const timelineService_1 = require("./timelineService");
const documentLinkService_1 = require("./documentLinkService");
// Normalization helper functions
function normalizeCNIC(cnic) {
    if (!cnic)
        return null;
    // Extract only digits from CNIC
    const digitsOnly = cnic.replace(/\D/g, '');
    // CNIC should be 13 digits
    return digitsOnly.length === 13 ? digitsOnly : null;
}
function normalizePassport(passport) {
    if (!passport)
        return null;
    // Trim whitespace and convert to uppercase
    return passport.trim().toUpperCase();
}
function normalizePhoneE164(phone) {
    if (!phone)
        return null;
    // Remove all non-digit characters
    const digitsOnly = phone.replace(/\D/g, '');
    // Add Pakistan country code if not present
    if (digitsOnly.startsWith('92') && digitsOnly.length === 12) {
        return `+${digitsOnly}`;
    }
    else if (digitsOnly.length === 10 && digitsOnly.startsWith('3')) {
        return `+92${digitsOnly}`;
    }
    else if (digitsOnly.length === 13 && digitsOnly.startsWith('923')) {
        return `+${digitsOnly}`;
    }
    return null;
}
// Generate candidate code in FL-2024-001 format
async function generateCandidateCode() {
    const db = (0, database_1.supabaseAdminClient)();
    // Get the current year
    const currentYear = new Date().getFullYear();
    // Retry logic to handle race conditions
    for (let attempt = 0; attempt < 10; attempt++) {
        // Get the highest existing candidate code for this year
        const { data: existingCandidates } = await db
            .from('candidates')
            .select('candidate_code')
            .like('candidate_code', `FL-${currentYear}-%`)
            .order('candidate_code', { ascending: false })
            .limit(1);
        let sequenceNumber = 1;
        if (existingCandidates && existingCandidates.length > 0) {
            const lastCode = existingCandidates[0].candidate_code;
            const match = lastCode.match(/FL-\d{4}-(\d{3})/);
            if (match) {
                sequenceNumber = parseInt(match[1], 10) + 1;
            }
        }
        // Add random offset on retry to avoid collision
        if (attempt > 0) {
            sequenceNumber += attempt;
        }
        const paddedNumber = sequenceNumber.toString().padStart(3, '0');
        const candidateCode = `FL-${currentYear}-${paddedNumber}`;
        // Check if this code already exists
        const { data: existing } = await db
            .from('candidates')
            .select('id')
            .eq('candidate_code', candidateCode)
            .maybeSingle();
        if (!existing) {
            return candidateCode;
        }
    }
    // Fallback: use timestamp-based unique code
    const timestamp = Date.now().toString().slice(-6);
    return `FL-${currentYear}-${timestamp}`;
}
// Check for duplicates based on CNIC or passport
async function checkForDuplicates(cnic, passport, excludeId) {
    const db = (0, database_1.supabaseAdminClient)();
    const duplicates = [];
    // Priority 1: Check CNIC
    if (cnic) {
        const normalizedCnic = normalizeCNIC(cnic);
        if (normalizedCnic) {
            let query = db
                .from('candidates')
                .select('*')
                .eq('cnic_normalized', normalizedCnic);
            if (excludeId) {
                query = query.neq('id', excludeId);
            }
            const { data: cnicDuplicates } = await query;
            if (cnicDuplicates && cnicDuplicates.length > 0) {
                duplicates.push(...cnicDuplicates.map(d => ({ ...d, matchReason: 'CNIC', priority: 1 })));
            }
        }
    }
    // Priority 2: Check passport
    if (passport && duplicates.length === 0) {
        const normalizedPassport = normalizePassport(passport);
        if (normalizedPassport) {
            let query = db
                .from('candidates')
                .select('*')
                .eq('passport_normalized', normalizedPassport);
            if (excludeId) {
                query = query.neq('id', excludeId);
            }
            const { data: passportDuplicates } = await query;
            if (passportDuplicates && passportDuplicates.length > 0) {
                duplicates.push(...passportDuplicates.map(d => ({ ...d, matchReason: 'Passport', priority: 2 })));
            }
        }
    }
    return duplicates;
}
async function createCandidate(data, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    // Normalize identifiers
    const cnicNormalized = data.cnic ? normalizeCNIC(data.cnic) : null;
    const passportNormalized = data.passport ? normalizePassport(data.passport) : null;
    const phoneNormalized = data.phone ? normalizePhoneE164(data.phone) : null;
    // Check for duplicates
    const duplicates = await checkForDuplicates(data.cnic, data.passport);
    if (duplicates.length > 0) {
        throw new Error(`Duplicate candidate found: ${duplicates[0].name} (${duplicates[0].matchReason})`);
    }
    // Generate candidate code
    const candidateCode = await generateCandidateCode();
    // Create candidate record
    const candidateData = {
        candidate_code: candidateCode,
        name: data.name,
        father_name: data.father_name,
        status: data.status,
        source: data.source,
        ai_score: data.ai_score,
        auto_extracted: data.auto_extracted,
        needs_review: data.needs_review,
        email: data.email,
        phone: phoneNormalized,
        date_of_birth: data.date_of_birth,
        gender: data.gender,
        marital_status: data.marital_status,
        address: data.address,
        cnic_normalized: cnicNormalized,
        passport_normalized: passportNormalized,
        nationality: data.nationality,
        position: data.position,
        experience_years: data.experience_years,
        country_of_interest: data.country_of_interest,
        skills: data.skills,
        languages: data.languages,
        education: data.education,
        certifications: data.certifications,
        previous_employment: data.previous_employment,
        passport_expiry: data.passport_expiry,
        professional_summary: data.professional_summary,
        // Include checklist items if provided (defaults handled by DB)
        passport_received: data.passport_received,
        cnic_received: data.cnic_received,
        degree_received: data.degree_received,
        medical_received: data.medical_received,
        visa_received: data.visa_received,
        // Candidate card doc flags (optional)
        cv_received: data.cv_received,
        photo_received: data.photo_received,
        certificate_received: data.certificate_received,
    };
    const { data: candidate, error } = await db
        .from('candidates')
        .insert(candidateData)
        .select()
        .single();
    if (error)
        throw error;
    // Log timeline event
    try {
        await (0, timelineService_1.logProfileCreated)(candidate.id, userId, {
            candidate_code: candidateCode,
            name: data.name,
        });
    }
    catch (timelineError) {
        console.error('Failed to log timeline event:', timelineError);
        // Don't fail the creation if timeline logging fails
    }
    // Trigger reconciliation for any unmatched documents with matching identifiers
    try {
        const documentLinkService = new documentLinkService_1.DocumentLinkService();
        await documentLinkService.reconcileDocumentsForCandidate(candidate.id);
    }
    catch (reconcileError) {
        console.error('Failed to reconcile documents for new candidate:', reconcileError);
        // Don't fail candidate creation if reconciliation fails
    }
    return candidate;
}
async function getCandidateById(id, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidates')
        .select('*')
        .eq('id', id)
        .single();
    if (error)
        throw error;
    return data;
}
async function listCandidates(filters = {}, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    let query = db.from('candidates').select('*', { count: 'exact' });
    // Apply search filter (name, email, candidate_code)
    if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,candidate_code.ilike.%${filters.search}%`);
    }
    // Apply status filter
    if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
    }
    // Apply profession (position) filter
    if (filters.position && filters.position !== 'all') {
        query = query.eq('position', filters.position);
    }
    // Apply country-of-interest filter
    if (filters.country_of_interest && filters.country_of_interest !== 'all') {
        query = query.eq('country_of_interest', filters.country_of_interest);
    }
    // Apply document completeness filter (card-required docs)
    // Complete means: CV + Passport + Certificate + Photo + Medical are present.
    if (filters.documents === 'complete') {
        query = query
            .eq('cv_received', true)
            .eq('passport_received', true)
            .eq('certificate_received', true)
            .eq('photo_received', true)
            .eq('medical_received', true);
    }
    else if (filters.documents === 'missing') {
        query = query.or('cv_received.eq.false,passport_received.eq.false,certificate_received.eq.false,photo_received.eq.false,medical_received.eq.false');
    }
    // Apply pagination
    if (filters.limit && filters.offset !== undefined) {
        query = query.range(filters.offset, filters.offset + filters.limit - 1);
    }
    else if (filters.limit) {
        query = query.limit(filters.limit);
    }
    // Order by created_at desc
    query = query.order('created_at', { ascending: false });
    const { data, error, count } = await query;
    if (error)
        throw error;
    return {
        candidates: data,
        total: count,
        limit: filters.limit,
        offset: filters.offset
    };
}
async function bulkUpdateCandidateStatus(candidateIds, status, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
        throw new Error('candidateIds must be a non-empty array');
    }
    const allowed = new Set(['Applied', 'Pending', 'Deployed', 'Cancelled']);
    if (!allowed.has(status)) {
        throw new Error(`Invalid status: ${status}`);
    }
    const { data, error } = await db
        .from('candidates')
        .update({ status, updated_at: new Date().toISOString() })
        .in('id', candidateIds)
        .select('id,status');
    if (error)
        throw error;
    return {
        updated: (data || []).length,
        candidates: data || [],
    };
}
async function updateCandidate(id, data, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    // Normalize identifiers if provided
    const updateData = { ...data };
    if (data.cnic) {
        updateData.cnic_normalized = normalizeCNIC(data.cnic);
    }
    if (data.passport) {
        updateData.passport_normalized = normalizePassport(data.passport);
    }
    if (data.phone) {
        updateData.phone = normalizePhoneE164(data.phone);
    }
    // Check for duplicates (excluding current candidate)
    if (data.cnic || data.passport) {
        const duplicates = await checkForDuplicates(data.cnic, data.passport, id);
        if (duplicates.length > 0) {
            throw new Error(`Duplicate candidate found: ${duplicates[0].name} (${duplicates[0].matchReason})`);
        }
    }
    updateData.updated_at = new Date().toISOString();
    const { data: candidate, error } = await db
        .from('candidates')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
    if (error)
        throw error;
    // Log timeline event
    try {
        await (0, timelineService_1.logProfileUpdated)(id, userId, {
            fields_updated: Object.keys(data),
        });
    }
    catch (timelineError) {
        console.error('Failed to log timeline event:', timelineError);
    }
    return candidate;
}
async function deleteCandidate(id, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    // Soft delete by setting status to 'Deleted'
    const { data, error } = await db
        .from('candidates')
        .update({
        status: 'Deleted',
        updated_at: new Date().toISOString()
    })
        .eq('id', id)
        .select()
        .single();
    if (error)
        throw error;
    return data;
}
