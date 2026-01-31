import { supabaseAdminClient } from '../config/database';
import { logProfileCreated, logProfileUpdated } from './timelineService';
import { DocumentLinkService } from './documentLinkService';

// Normalization helper functions
export function normalizeCNIC(cnic: string): string | null {
  if (!cnic) return null;
  // Extract only digits from CNIC
  const digitsOnly = cnic.replace(/\D/g, '');
  // CNIC should be 13 digits
  return digitsOnly.length === 13 ? digitsOnly : null;
}

export function normalizePassport(passport: string): string | null {
  if (!passport) return null;
  // Trim whitespace and convert to uppercase
  return passport.trim().toUpperCase();
}

export function normalizePhoneE164(phone: string): string | null {
  if (!phone) return null;
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');
  // Add Pakistan country code if not present
  if (digitsOnly.startsWith('92') && digitsOnly.length === 12) {
    return `+${digitsOnly}`;
  } else if (digitsOnly.length === 10 && digitsOnly.startsWith('3')) {
    return `+92${digitsOnly}`;
  } else if (digitsOnly.length === 13 && digitsOnly.startsWith('923')) {
    return `+${digitsOnly}`;
  }
  return null;
}

// Generate candidate code in FL-2024-001 format
export async function generateCandidateCode(): Promise<string> {
  const db = supabaseAdminClient();

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
export async function checkForDuplicates(cnic?: string, passport?: string, excludeId?: string): Promise<any[]> {
  const db = supabaseAdminClient();
  const duplicates: any[] = [];

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

export interface CreateCandidateData {
  name: string;
  father_name?: string;
  status?: 'Applied' | 'Pending' | 'Deployed' | 'Cancelled' | string;
  source?: 'WhatsApp' | 'Email' | 'Form' | 'Manual' | string;
  ai_score?: number;
  auto_extracted?: boolean;
  needs_review?: boolean;
  email?: string;
  phone?: string;
  date_of_birth?: string;
  gender?: string;
  marital_status?: string;
  address?: string;
  cnic?: string;
  passport?: string;

  // CV extraction/profile fields (migration 011)
  nationality?: string;
  position?: string;
  experience_years?: number;
  country_of_interest?: string;
  skills?: string;
  languages?: string;
  education?: string;
  certifications?: string;
  previous_employment?: string;
  passport_expiry?: string;
  professional_summary?: string;

  // Document checklist items (Migration 010)
  passport_received?: boolean;
  cnic_received?: boolean;
  degree_received?: boolean;
  medical_received?: boolean;
  visa_received?: boolean;

  // Candidate card doc flags (migration 012)
  cv_received?: boolean;
  photo_received?: boolean;
  certificate_received?: boolean;

  // Profile photo URL from parser
  profile_photo_url?: string;
}

export async function createCandidate(data: CreateCandidateData, userId?: string) {
  const db = supabaseAdminClient();

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

  // Validate profile_photo_url (only allow image URLs)
  let validProfilePhotoUrl = null;
  if (data.profile_photo_url && typeof data.profile_photo_url === 'string') {
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
    const url = data.profile_photo_url.toLowerCase();
    const extMatch = url.match(/\.([a-z0-9]+)(?:\?|#|$)/);
    
    // Reject URLs that contain CV document UUIDs (these are extracted images from CVs, not real profile photos)
    // Pattern: documents/candidate_photos/{UUID}/profile.jpeg where UUID matches inbox_attachments IDs
    const isCVExtractedImage = url.includes('documents/candidate_photos/') && 
                               /candidate_photos\/[a-f0-9\-]{36}\//.test(url);
    
    if (extMatch && allowedExts.includes(extMatch[1]) && !isCVExtractedImage) {
      validProfilePhotoUrl = data.profile_photo_url;
    } else {
      if (isCVExtractedImage) {
        console.warn(`[ProfilePhotoValidation] Rejected CV-extracted image (not real profile photo): ${data.profile_photo_url}`);
      } else {
        console.warn(`[ProfilePhotoValidation] Rejected non-image profile_photo_url: ${data.profile_photo_url}`);
      }
    }
  }

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

    // Profile photo URL (validated)
    profile_photo_url: validProfilePhotoUrl,
  };

  const { data: candidate, error } = await db
    .from('candidates')
    .insert(candidateData)
    .select()
    .single();

  if (error) throw error;

  // Log timeline event
  try {
    await logProfileCreated(candidate.id, userId, {
      candidate_code: candidateCode,
      name: data.name,
    });
  } catch (timelineError) {
    console.error('Failed to log timeline event:', timelineError);
    // Don't fail the creation if timeline logging fails
  }

  // Trigger reconciliation for any unmatched documents with matching identifiers
  try {
    const documentLinkService = new DocumentLinkService();
    await documentLinkService.reconcileDocumentsForCandidate(candidate.id);
  } catch (reconcileError) {
    console.error('Failed to reconcile documents for new candidate:', reconcileError);
    // Don't fail candidate creation if reconciliation fails
  }

  return candidate;
}

export async function getCandidateById(id: string, userId: string) {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from('candidates')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export interface CandidateFilters {
  search?: string;
  status?: string;
  position?: string;
  country_of_interest?: string;
  documents?: 'complete' | 'missing' | string;
  /** Date Applied: from (ISO date or datetime, inclusive) */
  applied_from?: string;
  /** Date Applied: to (ISO date or datetime, inclusive) */
  applied_to?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export async function listCandidates(filters: CandidateFilters = {}, userId: string) {
  const db = supabaseAdminClient();
  let query = db.from('candidates').select('*', { count: 'exact' });

  // Global search: partial, case-insensitive, across name, passport, CNIC, email, phone (server-side)
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim();
    query = query.or(
      `name.ilike.%${q}%,email.ilike.%${q}%,candidate_code.ilike.%${q}%,phone.ilike.%${q}%,passport_normalized.ilike.%${q}%,cnic_normalized.ilike.%${q}%`
    );
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
  } else if (filters.documents === 'missing') {
    query = query.or(
      'cv_received.eq.false,passport_received.eq.false,certificate_received.eq.false,photo_received.eq.false,medical_received.eq.false'
    );
  }

  // Apply pagination
  if (filters.limit && filters.offset !== undefined) {
    query = query.range(filters.offset, filters.offset + filters.limit - 1);
  } else if (filters.limit) {
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

  if (error) throw error;

  // Map passport_normalized to passport for frontend compatibility
  // Frontend expects 'passport' but database only has 'passport_normalized'
  const mappedCandidates = (data || []).map((candidate: any) => ({
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

export interface DailyStatsFilters {
  applied_from?: string;
  applied_to?: string;
  position?: string;
  country_of_interest?: string;
  documents?: 'complete' | 'missing' | string;
  search?: string;
}

export interface DailyStats {
  total: number;
  applied: number;
  verified: number;
  pending: number;
  rejected: number;
  documents_uploaded: number;
}

/** Daily summary for Excel-style report cards. Respects same filters as list (date range, folder, search). */
export async function getDailyStats(filters: DailyStatsFilters, userId: string): Promise<DailyStats> {
  const db = supabaseAdminClient();

  function buildBaseQuery() {
    let q = db.from('candidates').select('id', { count: 'exact' });
    if (filters.search?.trim()) {
      const search = filters.search.trim();
      q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,passport_normalized.ilike.%${search}%,cnic_normalized.ilike.%${search}%`);
    }
    if (filters.position && filters.position !== 'all') q = q.eq('position', filters.position);
    if (filters.country_of_interest && filters.country_of_interest !== 'all') q = q.eq('country_of_interest', filters.country_of_interest);
    if (filters.applied_from) {
      const from = filters.applied_from.endsWith('Z') || filters.applied_from.includes('T') ? filters.applied_from : `${filters.applied_from}T00:00:00.000Z`;
      q = q.gte('created_at', from);
    }
    if (filters.applied_to) {
      const to = filters.applied_to.endsWith('Z') || filters.applied_to.includes('T') ? filters.applied_to : `${filters.applied_to}T23:59:59.999Z`;
      q = q.lte('created_at', to);
    }
    if (filters.documents === 'complete') {
      q = q.eq('cv_received', true).eq('passport_received', true).eq('certificate_received', true).eq('photo_received', true).eq('medical_received', true);
    } else if (filters.documents === 'missing') {
      q = q.or('cv_received.eq.false,passport_received.eq.false,certificate_received.eq.false,photo_received.eq.false,medical_received.eq.false');
    }
    return q.limit(0);
  }

  const [totalRes, appliedRes, verifiedRes, pendingRes, rejectedRes, docsRes] = await Promise.all([
    buildBaseQuery(),
    buildBaseQuery().eq('status', 'Applied'),
    buildBaseQuery().eq('status', 'Deployed'),
    buildBaseQuery().eq('status', 'Pending'),
    buildBaseQuery().eq('status', 'Cancelled'),
    buildBaseQuery().or('cv_received.eq.true,passport_received.eq.true'),
  ]);

  return {
    total: totalRes.count ?? 0,
    applied: appliedRes.count ?? 0,
    verified: verifiedRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    rejected: rejectedRes.count ?? 0,
    documents_uploaded: docsRes.count ?? 0,
  };
}

/** Export candidates to CSV or Excel. Returns buffer and filename. */
export async function exportCandidates(
  filters: CandidateFilters,
  format: 'csv' | 'xlsx',
  userId: string
): Promise<{ buffer: Buffer; filename: string }> {
  // Fetch all candidates matching filters (no pagination)
  const exportFilters = { ...filters, limit: undefined, offset: undefined };
  const result = await listCandidates(exportFilters, userId);
  const candidates = result.candidates || [];

  if (format === 'csv') {
    return exportToCSV(candidates);
  } else {
    return exportToExcel(candidates);
  }
}

function exportToCSV(candidates: any[]): { buffer: Buffer; filename: string } {
  if (candidates.length === 0) {
    return { buffer: Buffer.from(''), filename: `candidates_${new Date().toISOString().split('T')[0]}.csv` };
  }

  // Get frontend URL from environment
  const frontendUrl = process.env.FRONTEND_URL || 'https://exquisite-surprise-production.up.railway.app';
  // Get backend URL for CV download links
  const backendBaseUrl = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
  const apiBaseUrl = backendBaseUrl.replace(/\/$/, '').endsWith('/api')
    ? backendBaseUrl.replace(/\/$/, '')
    : `${backendBaseUrl.replace(/\/$/, '')}/api`;

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

function exportToExcel(candidates: any[]): { buffer: Buffer; filename: string } {
  const XLSX = require('xlsx');
  
  if (candidates.length === 0) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['No candidates to export']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return { buffer, filename: `candidates_${new Date().toISOString().split('T')[0]}.xlsx` };
  }

  // Get frontend URL from environment
  const frontendUrl = process.env.FRONTEND_URL || 'https://exquisite-surprise-production.up.railway.app';
  // Get backend URL for CV download links
  const backendBaseUrl = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
  const apiBaseUrl = backendBaseUrl.replace(/\/$/, '').endsWith('/api')
    ? backendBaseUrl.replace(/\/$/, '')
    : `${backendBaseUrl.replace(/\/$/, '')}/api`;

  // Build data array with headers
  const data: any[][] = [[
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
    { wch: 5 },  // Age
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
    { wch: 20 }  // Updated Date
  ];

  // Create workbook and add worksheet
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Candidates');

  // Write to buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `candidates_${new Date().toISOString().split('T')[0]}.xlsx`;
  
  return { buffer, filename };
}

function escapeCSV(value: string): string {
  if (!value) return '';
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  const str = String(value).replace(/"/g, '""');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str}"`;
  }
  return str;
}

function calculateAgeFromDOB(dateOfBirth: string): number | '' {
  if (!dateOfBirth) return '';
  try {
    const birthDate = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  } catch {
    return '';
  }
}

export async function bulkUpdateCandidateStatus(
  candidateIds: string[],
  status: 'Applied' | 'Pending' | 'Deployed' | 'Cancelled' | string,
  userId: string
) {
  const db = supabaseAdminClient();

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

  if (error) throw error;

  return {
    updated: (data || []).length,
    candidates: data || [],
  };
}

export async function updateCandidate(id: string, data: Partial<CreateCandidateData>, userId: string) {
  const db = supabaseAdminClient();

  // Normalize identifiers if provided
  const updateData: any = { ...data };
  if (data.cnic) {
    updateData.cnic_normalized = normalizeCNIC(data.cnic);
  }
  if (data.passport) {
    updateData.passport_normalized = normalizePassport(data.passport);
  }
  if (data.phone) {
    updateData.phone = normalizePhoneE164(data.phone);
  }

  // Validate profile_photo_url if provided (only allow real profile photos, not CV-extracted images)
  if (data.profile_photo_url && typeof data.profile_photo_url === 'string') {
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
    const url = data.profile_photo_url.toLowerCase();
    const extMatch = url.match(/\.([a-z0-9]+)(?:\?|#|$)/);
    
    // Reject URLs that contain CV document UUIDs (these are extracted images from CVs, not real profile photos)
    const isCVExtractedImage = url.includes('documents/candidate_photos/') && 
                               /candidate_photos\/[a-f0-9\-]{36}\//.test(url);
    
    if (!(extMatch && allowedExts.includes(extMatch[1]) && !isCVExtractedImage)) {
      if (isCVExtractedImage) {
        console.warn(`[ProfilePhotoValidation] Rejected CV-extracted image for update (not real profile photo): ${data.profile_photo_url}`);
      } else {
        console.warn(`[ProfilePhotoValidation] Rejected non-image profile_photo_url for update: ${data.profile_photo_url}`);
      }
      // Remove invalid profile_photo_url from update
      delete updateData.profile_photo_url;
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

  const { data: candidate, error } = await db
    .from('candidates')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  // Log timeline event
  try {
    await logProfileUpdated(id, userId, {
      fields_updated: Object.keys(data),
    });
  } catch (timelineError) {
    console.error('Failed to log timeline event:', timelineError);
  }

  return candidate;
}

export async function deleteCandidate(id: string, userId: string) {
  const db = supabaseAdminClient();

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

  if (error) throw error;
  return data;
}