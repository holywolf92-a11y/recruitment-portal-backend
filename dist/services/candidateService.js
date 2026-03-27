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
exports.getCandidateBrowseMetadata = getCandidateBrowseMetadata;
exports.getDailyStats = getDailyStats;
exports.getCandidateDashboardStats = getCandidateDashboardStats;
exports.exportCandidates = exportCandidates;
exports.bulkUpdateCandidateStatus = bulkUpdateCandidateStatus;
exports.updateCandidate = updateCandidate;
exports.deleteCandidate = deleteCandidate;
const database_1 = require("../config/database");
const timelineService_1 = require("./timelineService");
const documentLinkService_1 = require("./documentLinkService");
const publicUrl_1 = require("../utils/publicUrl");
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
// Generate candidate code in FL-03-26-1 format.
// The candidate_code field is the shared reference used across inbox ingestion,
// candidate management, Excel browser, and employer-safe CV output.
async function generateCandidateCode() {
    const db = (0, database_1.supabaseAdminClient)();
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const prefix = `FL-${month}-${year}-`;
    for (let attempt = 0; attempt < 10; attempt++) {
        const { data: existingCandidates } = await db
            .from('candidates')
            .select('candidate_code')
            .like('candidate_code', `${prefix}%`)
            .limit(5000);
        let maxSequence = 0;
        for (const row of existingCandidates || []) {
            const code = row?.candidate_code;
            const match = typeof code === 'string' ? code.match(/^FL-\d{2}-\d{2}-(\d+)$/) : null;
            if (!match)
                continue;
            const parsed = Number.parseInt(match[1], 10);
            if (Number.isFinite(parsed) && parsed > maxSequence) {
                maxSequence = parsed;
            }
        }
        const candidateCode = `${prefix}${maxSequence + 1 + attempt}`;
        const { data: existing } = await db
            .from('candidates')
            .select('id')
            .eq('candidate_code', candidateCode)
            .maybeSingle();
        if (!existing) {
            return candidateCode;
        }
    }
    return `${prefix}${Date.now()}`;
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
    // Validate profile_photo_url (only allow image URLs or Supabase signed URLs)
    let validProfilePhotoUrl = null;
    if (data.profile_photo_url && typeof data.profile_photo_url === 'string') {
        const url = data.profile_photo_url.toLowerCase();
        const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
        const extMatch = url.match(/\.([a-z0-9]+)(?:\?|#|$)/);
        // Check for Supabase signed URLs which might not match extension regex easily
        const isSupabaseUrl = url.includes('supabase.co') && url.includes('/storage/v1/object/sign/');
        // Accept all valid image URLs including CV-extracted photos
        if (isSupabaseUrl || (extMatch && allowedExts.includes(extMatch[1]))) {
            validProfilePhotoUrl = data.profile_photo_url;
            console.log(`[ProfilePhotoValidation] Accepted profile photo URL: ${data.profile_photo_url}`);
        }
        else {
            console.warn(`[ProfilePhotoValidation] Rejected non-image profile_photo_url: ${data.profile_photo_url}`);
        }
    }
    // Truncate VARCHAR-limited fields to prevent 22001 overflow errors (safety net for all callers)
    const VARCHAR_LIMITS_CREATE = {
        name: 255, email: 255, phone: 50, position: 255, education: 255,
        nationality: 100, country_of_interest: 100, marital_status: 20, gender: 20,
    };
    const truncCreate = (val, maxLen) => typeof val === 'string' && val.length > maxLen ? val.slice(0, maxLen) : val;
    // Create candidate record
    const candidateData = {
        candidate_code: candidateCode,
        name: truncCreate(data.name, VARCHAR_LIMITS_CREATE.name),
        father_name: data.father_name,
        status: data.status,
        source: data.source,
        ai_score: data.ai_score,
        auto_extracted: data.auto_extracted,
        needs_review: data.needs_review,
        email: truncCreate(data.email, VARCHAR_LIMITS_CREATE.email),
        phone: truncCreate(phoneNormalized, VARCHAR_LIMITS_CREATE.phone),
        date_of_birth: data.date_of_birth,
        gender: truncCreate(data.gender, VARCHAR_LIMITS_CREATE.gender),
        marital_status: truncCreate(data.marital_status, VARCHAR_LIMITS_CREATE.marital_status),
        address: data.address,
        cnic_normalized: cnicNormalized,
        passport_normalized: passportNormalized,
        nationality: truncCreate(data.nationality, VARCHAR_LIMITS_CREATE.nationality),
        position: truncCreate(data.position, VARCHAR_LIMITS_CREATE.position),
        experience_years: data.experience_years,
        country_of_interest: truncCreate(data.country_of_interest, VARCHAR_LIMITS_CREATE.country_of_interest),
        skills: data.skills,
        languages: data.languages,
        education: truncCreate(data.education, VARCHAR_LIMITS_CREATE.education),
        certifications: data.certifications,
        internships: data.internships,
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
        // Profile photo URL (validated)
        profile_photo_url: validProfilePhotoUrl,
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
        .neq('status', 'Deleted') // Exclude soft-deleted candidates
        .maybeSingle();
    if (error)
        throw error;
    return data ?? null;
}
// Fields returned in list responses — excludes large text columns (skills, previous_employment,
// professional_summary, education, certifications) that are only needed in the detail view.
// Narrowing the select cuts list response payload by ~60-80% and reduces Railway egress.
const LIST_FIELDS = [
    'id', 'candidate_code', 'name', 'status', 'source', 'ai_score',
    'position', 'nationality', 'country_of_interest', 'experience_years',
    'phone', 'email', 'date_of_birth', 'gender', 'marital_status', 'address',
    'passport_normalized', 'cnic_normalized', 'passport_expiry',
    'languages',
    'passport_received', 'cnic_received', 'degree_received', 'medical_received',
    'visa_received', 'cv_received', 'photo_received', 'certificate_received',
    'driving_license_received',
    'profile_photo_url', 'profile_photo_bucket', 'profile_photo_path',
    'needs_review', 'auto_extracted', 'created_at', 'updated_at',
].join(',');
async function listCandidates(filters = {}, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    let query = db.from('candidates').select(LIST_FIELDS, { count: 'exact' });
    // By default, exclude deleted candidates (unless explicitly filtering for them)
    if (!filters.status || filters.status !== 'Deleted') {
        query = query.neq('status', 'Deleted');
    }
    // Global search: partial, case-insensitive, across name, passport, CNIC, email, phone, position (server-side)
    if (filters.search && filters.search.trim()) {
        const q = filters.search.trim();
        query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,candidate_code.ilike.%${q}%,phone.ilike.%${q}%,passport_normalized.ilike.%${q}%,cnic_normalized.ilike.%${q}%,position.ilike.%${q}%`);
    }
    // Apply status filter
    if (filters.status && filters.status !== 'all' && filters.status !== 'Deleted') {
        query = query.eq('status', filters.status);
    }
    else if (filters.status === 'Deleted') {
        // Only show deleted if explicitly requested
        query = query.eq('status', 'Deleted');
    }
    // Apply profession (position) filter
    if (filters.position && filters.position !== 'all') {
        query = query.eq('position', filters.position);
    }
    // Apply country-of-interest filter
    if (filters.country_of_interest && filters.country_of_interest !== 'all') {
        query = query.eq('country_of_interest', filters.country_of_interest);
    }
    // Date Applied filter (created_at = when candidate applied)
    if (filters.applied_from) {
        const from = filters.applied_from.endsWith('Z') || filters.applied_from.includes('T')
            ? filters.applied_from
            : `${filters.applied_from}T00:00:00.000Z`;
        query = query.gte('created_at', from);
    }
    if (filters.applied_to) {
        const to = filters.applied_to.endsWith('Z') || filters.applied_to.includes('T')
            ? filters.applied_to
            : `${filters.applied_to}T23:59:59.999Z`;
        query = query.lte('created_at', to);
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
    // Multi-column sort (server-side). Default: created_at desc
    const orderCol = filters.sort_by || 'created_at';
    const ascending = filters.sort_order === 'asc';
    query = query.order(orderCol, { ascending });
    if (orderCol !== 'created_at') {
        query = query.order('created_at', { ascending: false }); // secondary tie-break
    }
    const { data, error, count } = await query;
    if (error)
        throw error;
    // Map passport_normalized to passport for frontend compatibility
    // Frontend expects 'passport' but database only has 'passport_normalized'
    const mappedCandidates = (data || []).map((candidate) => ({
        ...candidate,
        passport: candidate.passport_normalized || candidate.passport || null,
    }));
    return {
        candidates: mappedCandidates,
        total: count,
        limit: filters.limit,
        offset: filters.offset
    };
}
async function getCandidateBrowseMetadata(userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidates')
        .select([
        'position',
        'country_of_interest',
        'status',
        'cv_received',
        'passport_received',
        'certificate_received',
        'photo_received',
        'medical_received',
    ].join(','))
        .neq('status', 'Deleted')
        .limit(100000);
    if (error)
        throw error;
    const rows = (data || []);
    const professionMap = new Map();
    const countryMap = new Map();
    const statusMap = new Map();
    for (const candidate of rows) {
        const position = (candidate.position || '').trim();
        const country = (candidate.country_of_interest || '').trim();
        const status = (candidate.status || 'Applied').trim() || 'Applied';
        const hasCompleteDocuments = Boolean(candidate.cv_received &&
            candidate.passport_received &&
            candidate.certificate_received &&
            candidate.photo_received &&
            candidate.medical_received);
        if (position) {
            let entry = professionMap.get(position);
            if (!entry) {
                entry = {
                    count: 0,
                    countries: new Map(),
                    statuses: new Map(),
                    documents: { complete: 0, missing: 0 },
                };
                professionMap.set(position, entry);
            }
            entry.count += 1;
            entry.statuses.set(status, (entry.statuses.get(status) || 0) + 1);
            if (country) {
                entry.countries.set(country, (entry.countries.get(country) || 0) + 1);
            }
            if (hasCompleteDocuments) {
                entry.documents.complete += 1;
            }
            else {
                entry.documents.missing += 1;
            }
        }
        if (country) {
            countryMap.set(country, (countryMap.get(country) || 0) + 1);
        }
        statusMap.set(status, (statusMap.get(status) || 0) + 1);
    }
    const toSortedCountItems = (map) => Array.from(map.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => left.name.localeCompare(right.name));
    return {
        totalCandidates: rows.length,
        professions: Array.from(professionMap.entries())
            .map(([name, entry]) => ({
            name,
            count: entry.count,
            countries: toSortedCountItems(entry.countries),
            statuses: toSortedCountItems(entry.statuses),
            documents: entry.documents,
        }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        countries: toSortedCountItems(countryMap),
        statuses: toSortedCountItems(statusMap),
    };
}
/** Daily summary for Excel-style report cards. Respects same filters as list (date range, folder, search). */
async function getDailyStats(filters, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    function buildBaseQuery(options) {
        let q = db.from('candidates').select('id', { count: 'exact' });
        q = q.neq('status', 'Deleted');
        if (filters.search?.trim()) {
            const search = filters.search.trim();
            q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,passport_normalized.ilike.%${search}%,cnic_normalized.ilike.%${search}%`);
        }
        if (filters.position && filters.position !== 'all')
            q = q.eq('position', filters.position);
        if (filters.country_of_interest && filters.country_of_interest !== 'all')
            q = q.eq('country_of_interest', filters.country_of_interest);
        if (options?.includeDateFilters !== false && filters.applied_from) {
            const from = filters.applied_from.endsWith('Z') || filters.applied_from.includes('T') ? filters.applied_from : `${filters.applied_from}T00:00:00.000Z`;
            q = q.gte('created_at', from);
        }
        if (options?.includeDateFilters !== false && filters.applied_to) {
            const to = filters.applied_to.endsWith('Z') || filters.applied_to.includes('T') ? filters.applied_to : `${filters.applied_to}T23:59:59.999Z`;
            q = q.lte('created_at', to);
        }
        if (filters.documents === 'complete') {
            q = q.eq('cv_received', true).eq('passport_received', true).eq('certificate_received', true).eq('photo_received', true).eq('medical_received', true);
        }
        else if (filters.documents === 'missing') {
            q = q.or('cv_received.eq.false,passport_received.eq.false,certificate_received.eq.false,photo_received.eq.false,medical_received.eq.false');
        }
        return q.limit(0);
    }
    const [totalCandidatesRes, totalRes, appliedRes, verifiedRes, pendingRes, rejectedRes, docsRes] = await Promise.all([
        db.from('candidates').select('id', { count: 'exact' }).neq('status', 'Deleted').limit(0),
        buildBaseQuery(),
        buildBaseQuery().eq('status', 'Applied'),
        buildBaseQuery().eq('status', 'Deployed'),
        buildBaseQuery().eq('status', 'Pending'),
        buildBaseQuery().eq('status', 'Cancelled'),
        buildBaseQuery().or('cv_received.eq.true,passport_received.eq.true'),
    ]);
    return {
        total_candidates: totalCandidatesRes.count ?? 0,
        total: totalRes.count ?? 0,
        applied: appliedRes.count ?? 0,
        verified: verifiedRes.count ?? 0,
        pending: pendingRes.count ?? 0,
        rejected: rejectedRes.count ?? 0,
        documents_uploaded: docsRes.count ?? 0,
    };
}
async function getCandidateDashboardStats(userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [totalCandidatesRes, pendingReviewRes, deployedRes, newThisWeekRes, professionsRes,] = await Promise.all([
        db.from('candidates').select('id', { count: 'exact' }).neq('status', 'Deleted').limit(0),
        db.from('candidates').select('id', { count: 'exact' }).neq('status', 'Deleted').eq('needs_review', true).limit(0),
        db.from('candidates').select('id', { count: 'exact' }).neq('status', 'Deleted').eq('status', 'Deployed').limit(0),
        db.from('candidates').select('id', { count: 'exact' }).neq('status', 'Deleted').gte('created_at', weekAgoIso).limit(0),
        db.from('candidates').select('position').neq('status', 'Deleted').not('position', 'is', null).limit(100000),
    ]);
    const distinctProfessions = new Set((professionsRes.data || [])
        .map((row) => String(row.position || '').trim())
        .filter((value) => value.length > 0));
    return {
        totalCandidates: totalCandidatesRes.count ?? 0,
        totalProfessions: distinctProfessions.size,
        pendingReview: pendingReviewRes.count ?? 0,
        deployed: deployedRes.count ?? 0,
        newThisWeek: newThisWeekRes.count ?? 0,
    };
}
/** Export candidates to CSV or Excel. Returns buffer and filename. */
async function exportCandidates(filters, format, userId) {
    // Fetch all candidates matching filters (no pagination)
    const exportFilters = { ...filters, limit: undefined, offset: undefined };
    const result = await listCandidates(exportFilters, userId);
    const candidates = result.candidates || [];
    if (format === 'csv') {
        return exportToCSV(candidates);
    }
    else {
        return exportToExcel(candidates);
    }
}
function exportToCSV(candidates) {
    if (candidates.length === 0) {
        return { buffer: Buffer.from(''), filename: `candidates_${new Date().toISOString().split('T')[0]}.csv` };
    }
    // Get frontend URL from environment
    const frontendUrl = (0, publicUrl_1.resolveFrontendUrl)(process.env.FRONTEND_URL);
    const apiBaseUrl = (0, publicUrl_1.resolveBackendApiBaseUrl)(process.env.BACKEND_URL);
    // CSV headers - now includes Profile Link and Employer CV
    const headers = [
        'ID', 'Code', 'Name', 'Email', 'Phone', 'Position', 'Nationality', 'Country of Interest',
        'Status', 'Age', 'Experience (Years)', 'Date of Birth', 'Gender', 'Marital Status',
        'Passport', 'CNIC', 'Passport Expiry', 'Address', 'Profile Link', 'Employer CV', 'Applied Date', 'Updated Date'
    ];
    // Build CSV rows
    const rows = [headers.join(',')];
    for (const c of candidates) {
        const age = c.date_of_birth ? calculateAgeFromDOB(c.date_of_birth) : '';
        const slug = (c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const profileLink = `${frontendUrl}/profile/${c.id}/${slug}`;
        const cvLink = `${apiBaseUrl}/cv-generator/${c.id}/download?format=employer-safe&force=true`;
        const row = [
            c.id || '',
            c.candidate_code || '',
            escapeCSV(c.name || ''),
            escapeCSV(c.email || ''),
            escapeCSV(c.phone || ''),
            escapeCSV(c.position || ''),
            escapeCSV(c.nationality || ''),
            escapeCSV(c.country_of_interest || ''),
            escapeCSV(c.status || ''),
            age,
            c.experience_years || '',
            c.date_of_birth || '',
            escapeCSV(c.gender || ''),
            escapeCSV(c.marital_status || ''),
            escapeCSV(c.passport || ''),
            escapeCSV(c.cnic || ''),
            c.passport_expiry || '',
            escapeCSV(c.address || ''),
            profileLink,
            cvLink,
            c.created_at || '',
            c.updated_at || ''
        ];
        rows.push(row.join(','));
    }
    const csv = rows.join('\n');
    const buffer = Buffer.from(csv, 'utf-8');
    const filename = `candidates_${new Date().toISOString().split('T')[0]}.csv`;
    return { buffer, filename };
}
function exportToExcel(candidates) {
    const XLSX = require('xlsx');
    if (candidates.length === 0) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([['No candidates to export']]);
        XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        return { buffer, filename: `candidates_${new Date().toISOString().split('T')[0]}.xlsx` };
    }
    // Get frontend URL from environment
    const frontendUrl = (0, publicUrl_1.resolveFrontendUrl)(process.env.FRONTEND_URL);
    const apiBaseUrl = (0, publicUrl_1.resolveBackendApiBaseUrl)(process.env.BACKEND_URL);
    // Build data array with headers
    const data = [[
            'ID', 'Code', 'Name', 'Email', 'Phone', 'Position', 'Nationality', 'Country of Interest',
            'Status', 'Age', 'Experience (Years)', 'Date of Birth', 'Gender', 'Marital Status',
            'Passport', 'CNIC', 'Passport Expiry', 'Address', 'Profile Link', 'Employer CV', 'Applied Date', 'Updated Date'
        ]];
    // Add candidate rows
    for (const c of candidates) {
        const age = c.date_of_birth ? calculateAgeFromDOB(c.date_of_birth) : '';
        const slug = (c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const profileLink = `${frontendUrl}/profile/${c.id}/${slug}`;
        const cvLink = `${apiBaseUrl}/cv-generator/${c.id}/download?format=employer-safe&force=true`;
        data.push([
            c.id || '',
            c.candidate_code || '',
            c.name || '',
            c.email || '',
            c.phone || '',
            c.position || '',
            c.nationality || '',
            c.country_of_interest || '',
            c.status || '',
            age,
            c.experience_years || '',
            c.date_of_birth || '',
            c.gender || '',
            c.marital_status || '',
            c.passport || '',
            c.cnic || '',
            c.passport_expiry || '',
            c.address || '',
            profileLink, // Profile Link column (will be converted to hyperlink)
            cvLink, // Employer CV column (will be converted to hyperlink)
            c.created_at || '',
            c.updated_at || ''
        ]);
    }
    // Create worksheet from data
    const ws = XLSX.utils.aoa_to_sheet(data);
    // Add hyperlinks to Profile Link (column S, index 18) and Employer CV (column T, index 19)
    // Excel uses A1 notation (A=0, B=1, ..., S=18, T=19)
    for (let row = 2; row <= candidates.length + 1; row++) { // Start from row 2 (skip header)
        const profileCell = XLSX.utils.encode_cell({ r: row - 1, c: 18 }); // Column S (Profile Link)
        const cvCell = XLSX.utils.encode_cell({ r: row - 1, c: 19 }); // Column T (Employer CV)
        if (ws[profileCell]) {
            ws[profileCell].l = { Target: ws[profileCell].v, Tooltip: 'Click to open profile' };
            ws[profileCell].s = { font: { color: { rgb: '0563C1' }, underline: true } };
        }
        if (ws[cvCell]) {
            ws[cvCell].l = { Target: ws[cvCell].v, Tooltip: 'Click to open employer CV' };
            ws[cvCell].s = { font: { color: { rgb: '7030A0' }, underline: true } };
        }
    }
    // Set column widths
    ws['!cols'] = [
        { wch: 36 }, // ID
        { wch: 12 }, // Code
        { wch: 20 }, // Name
        { wch: 25 }, // Email
        { wch: 15 }, // Phone
        { wch: 20 }, // Position
        { wch: 15 }, // Nationality
        { wch: 15 }, // Country of Interest
        { wch: 12 }, // Status
        { wch: 5 }, // Age
        { wch: 12 }, // Experience
        { wch: 12 }, // DOB
        { wch: 10 }, // Gender
        { wch: 12 }, // Marital Status
        { wch: 15 }, // Passport
        { wch: 15 }, // CNIC
        { wch: 12 }, // Passport Expiry
        { wch: 30 }, // Address
        { wch: 60 }, // Profile Link
        { wch: 60 }, // Employer CV
        { wch: 20 }, // Applied Date
        { wch: 20 } // Updated Date
    ];
    // Create workbook and add worksheet
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
    // Write to buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `candidates_${new Date().toISOString().split('T')[0]}.xlsx`;
    return { buffer, filename };
}
function escapeCSV(value) {
    if (!value)
        return '';
    // Escape quotes and wrap in quotes if contains comma, quote, or newline
    const str = String(value).replace(/"/g, '""');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str}"`;
    }
    return str;
}
function calculateAgeFromDOB(dateOfBirth) {
    if (!dateOfBirth)
        return '';
    try {
        const birthDate = new Date(dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    }
    catch {
        return '';
    }
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
    // Validate profile_photo_url if provided (accept all valid image URLs including CV-extracted photos)
    if (data.profile_photo_url && typeof data.profile_photo_url === 'string') {
        const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
        const url = data.profile_photo_url.toLowerCase();
        const extMatch = url.match(/\.([a-z0-9]+)(?:\?|#|$)/);
        // Accept all valid image URLs including CV-extracted photos
        if (!(extMatch && allowedExts.includes(extMatch[1]))) {
            console.warn(`[ProfilePhotoValidation] Rejected non-image profile_photo_url for update: ${data.profile_photo_url}`);
            // Remove invalid profile_photo_url from update
            delete updateData.profile_photo_url;
        }
        else {
            console.log(`[ProfilePhotoValidation] Accepted profile photo URL for update: ${data.profile_photo_url}`);
        }
    }
    // Check for duplicates (excluding current candidate)
    if (data.cnic || data.passport) {
        const duplicates = await checkForDuplicates(data.cnic, data.passport, id);
        if (duplicates.length > 0) {
            throw new Error(`Duplicate candidate found: ${duplicates[0].name} (${duplicates[0].matchReason})`);
        }
    }
    updateData.updated_at = new Date().toISOString();
    // Truncate VARCHAR-limited fields to prevent 22001 overflow errors
    const VARCHAR_LIMITS = {
        name: 255, email: 255, phone: 50, position: 255, education: 255,
        nationality: 100, country_of_interest: 100, marital_status: 20, gender: 20,
    };
    for (const [col, maxLen] of Object.entries(VARCHAR_LIMITS)) {
        if (typeof updateData[col] === 'string' && updateData[col].length > maxLen) {
            updateData[col] = updateData[col].slice(0, maxLen);
        }
    }
    // Strip unknown columns to prevent PGRST204 schema errors
    const KNOWN_CANDIDATE_COLUMNS_UPDATE = new Set([
        'name', 'father_name', 'email', 'phone', 'date_of_birth', 'gender',
        'marital_status', 'address', 'cnic_normalized', 'passport_normalized',
        'nationality', 'position', 'experience_years', 'country_of_interest',
        'skills', 'languages', 'education', 'certifications', 'internships',
        'previous_employment', 'passport_expiry', 'professional_summary',
        'status', 'source', 'ai_score', 'auto_extracted', 'needs_review',
        'updated_at', 'field_sources', 'extraction_confidence', 'extraction_source',
        'extracted_at', 'passport_received', 'cnic_received', 'degree_received',
        'medical_received', 'visa_received', 'cv_received', 'photo_received',
        'certificate_received', 'profile_photo_url',
        'driving_license_received',
    ]);
    for (const col of Object.keys(updateData)) {
        if (!KNOWN_CANDIDATE_COLUMNS_UPDATE.has(col)) {
            console.warn(`[CandidateService] Stripping unknown column '${col}' from updateCandidate`);
            delete updateData[col];
        }
    }
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
