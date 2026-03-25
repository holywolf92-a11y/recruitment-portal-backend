/**
 * Progressive Candidate Data Completion Service
 * 1. Only fill missing fields (NULL, empty string, undefined, or "Unknown")
 * 2. Never overwrite existing values - simple fallback chain
 *    - Nationality extraction order: CV → CNIC → Passport → Driving License → Education docs
 *    - First source that has the field wins, no overrides
 * Core Principle: Any document can enrich a candidate, only fill missing fields, never overwrite.
 * Priority: Manual > Any Document (CV/Passport/License/Medical/Certificate)
 * 
 * Excel Browser Fields are the "bible" for required fields tracking.
 */

import { supabaseAdminClient } from '../config/database';
import { normalizeCNIC, normalizePassport } from './candidateService';
import { CandidateMatcher } from './candidateMatcher';

// Excel Browser fields (the "bible" for missing data tracking)
export const EXCEL_BROWSER_FIELDS = {
  // Basic View
  name: 'Name',
  position: 'Position',
  age: 'Age', // Calculated from date_of_birth
  nationality: 'Nationality',
  country_of_interest: 'Country of Interest',
  phone: 'Phone',
  email: 'Email',
  experience_years: 'Experience',
  status: 'Status',
  ai_score: 'AI Score',

  // Detailed View
  religion: 'Religion',
  marital_status: 'Marital',
  salary_expectation: 'Salary Exp.',
  available_from: 'Available',
  interview_date: 'Interview Date',
  passport: 'Passport #',
  passport_expiry: 'Pass. Expiry',
  medical_expiry: 'Medical Exp.',
  driving_license: 'License',
  gcc_years: 'GCC Years',
  languages: 'Languages', // English/Arabic extracted from this
  address: 'Location',
  created_at: 'Applied',

  // Additional identity fields
  father_name: 'Father Name',
  cnic: 'CNIC',
  date_of_birth: 'Date of Birth', // Required for Age calculation

  // CV Extraction fields
  education: 'Education',
  certifications: 'Certifications',
  internships: 'Internships',
  previous_employment: 'Previous Employment',
  skills: 'Skills',
  professional_summary: 'Professional Summary',
} as const;

// Required fields for candidate creation (minimum identity)
export const REQUIRED_FIELDS_FOR_CREATION = [
  'name', // At minimum, we need a name
] as const;

// Document types that can provide data
export type DocumentSource = 'cv' | 'passport' | 'driving_license' | 'medical' | 'certificate' | 'manual' | 'other' | 'email_reply';

// Field source tracking structure
export interface FieldSource {
  field: string;
  source: DocumentSource;
  document_id?: string;
  document_type?: string;
  updated_at: string;
  updated_by?: string;
}

const FIELD_TO_DB_COLUMN: Record<string, string> = {
  cnic: 'cnic_normalized',
  passport: 'passport_normalized',
  passport_no: 'passport_normalized',
  dob: 'date_of_birth',
  expiry_date: 'passport_expiry',
};

function resolveCandidateColumn(field: string): string {
  return FIELD_TO_DB_COLUMN[field] || field;
}

function candidateHasColumn(candidate: any, field: string): boolean {
  const column = resolveCandidateColumn(field);
  return Object.prototype.hasOwnProperty.call(candidate || {}, column);
}

/**
 * Progressive Data Completion Logic
 * 
 * Rules:
 * 1. Only fill missing fields (NULL, empty string, or undefined)
 * 2. Never overwrite existing values automatically
 * 3. Manual updates have highest priority (never overwritten)
 * 4. Track source of each field
 */
export async function enrichCandidateData(
  candidateId: string,
  extractedData: Record<string, any>,
  source: DocumentSource,
  documentId?: string,
  documentType?: string
): Promise<{
  updated: string[];
  skipped: string[];
  sourceTracking: FieldSource[];
}> {
  const db = supabaseAdminClient();

  // Get current candidate record
  const { data: currentCandidate, error: fetchError } = await db
    .from('candidates')
    .select('*')
    .eq('id', candidateId)
    .maybeSingle();

  if (fetchError || !currentCandidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }

  // Get current field sources (if tracking exists)
  const currentFieldSources: Record<string, FieldSource> =
    (currentCandidate.field_sources as any) || {};

  const updates: Record<string, any> = {};
  const updated: string[] = [];
  const skipped: string[] = [];
  const sourceTracking: FieldSource[] = [];

  // Process each extracted field
  for (const [field, extractedValue] of Object.entries(extractedData)) {
    if (!candidateHasColumn(currentCandidate, field)) {
      skipped.push(field);
      continue;
    }

    // Skip null/undefined/empty extracted values
    if (extractedValue === null || extractedValue === undefined || extractedValue === '') {
      continue;
    }

    // Skip placeholder strings that commonly appear from OCR/LLM parsing
    if (typeof extractedValue === 'string') {
      const normalized = extractedValue.trim().toLowerCase();
      if (normalized === '' || ['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided'].includes(normalized)) {
        continue;
      }
    }

    // Log nationality processing for debugging
    if (field === 'nationality') {
      console.log(`[ProgressiveCompletion] Processing nationality field:`, {
        extractedValue,
        currentValue: currentCandidate.nationality,
        source,
        documentType,
        currentSource: currentFieldSources[field],
      });
    }

    // Get current value
    const currentValue = currentCandidate[field as keyof typeof currentCandidate];

    // Check if field is missing (NULL, empty string, or undefined)
    const placeholderCurrent =
      typeof currentValue === 'string' &&
      ['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided'].includes(currentValue.trim().toLowerCase());
    const isMissing = currentValue === null ||
      currentValue === undefined ||
      currentValue === '' ||
      (typeof currentValue === 'string' && currentValue.trim() === '') ||
      placeholderCurrent;

    // Get current field source
    const currentSource = currentFieldSources[field];

    // Priority check: Manual updates are never overwritten
    if (currentSource?.source === 'manual') {
      skipped.push(field);
      continue;
    }

    // Simple fallback chain: only fill missing fields, never override
    // Priority order: CV → CNIC → Passport → Driving License → Education documents
    // This respects user's preference: check CV first, only fallback if not found
    const isMissingOrUnknown = isMissing || 
      (field === 'nationality' && currentValue === 'Unknown');

    if (isMissingOrUnknown) {
      // Normalize special fields
      let normalizedValue = extractedValue;

      if (field === 'cnic' && typeof extractedValue === 'string') {
        // Map cnic to cnic_normalized (database column name)
        normalizedValue = normalizeCNIC(extractedValue);
        updates.cnic_normalized = normalizedValue;
        updated.push('cnic_normalized');

        // Track source
        sourceTracking.push({
          field: 'cnic_normalized',
          source,
          document_id: documentId,
          document_type: documentType,
          updated_at: new Date().toISOString(),
        });
        continue; // Skip cnic field itself
      } else if (field === 'passport' && typeof extractedValue === 'string') {
        // Map passport to passport_normalized (database column name)
        normalizedValue = normalizePassport(extractedValue);
        updates.passport_normalized = normalizedValue;
        updated.push('passport_normalized');

        // Track source
        sourceTracking.push({
          field: 'passport_normalized',
          source,
          document_id: documentId,
          document_type: documentType,
          updated_at: new Date().toISOString(),
        });
        continue; // Skip passport field itself
      } else if (field === 'passport_no' && typeof extractedValue === 'string') {
        // Map passport_no to passport_normalized
        normalizedValue = normalizePassport(extractedValue);
        updates.passport_normalized = normalizedValue;
        updated.push('passport_normalized');

        // Track source
        sourceTracking.push({
          field: 'passport_normalized',
          source,
          document_id: documentId,
          document_type: documentType,
          updated_at: new Date().toISOString(),
        });
        continue; // Skip passport_no field itself
      } else if (field === 'date_of_birth' || field === 'dob') {
        // Parse date from various formats
        normalizedValue = parseDate(extractedValue);
      } else if (field === 'passport_expiry' || field === 'expiry_date') {
        // Parse expiry date
        normalizedValue = parseDate(extractedValue);
      }

      // Apply update
      updates[field] = normalizedValue;
      updated.push(field);

      // Track source
      sourceTracking.push({
        field,
        source,
        document_id: documentId,
        document_type: documentType,
        updated_at: new Date().toISOString(),
      });
    } else {
      skipped.push(field);
    }
  }

  // Merge with existing field sources
  const mergedFieldSources: Record<string, FieldSource> = {
    ...currentFieldSources,
  };

  sourceTracking.forEach(tracking => {
    mergedFieldSources[tracking.field] = tracking;
  });

  // Update candidate if there are changes
  if (Object.keys(updates).length > 0) {
    // Get old values before update for audit logging
    const oldValues: Record<string, any> = {};
    for (const field of updated) {
      oldValues[field] = currentCandidate[field] || null;
    }

    updates.field_sources = mergedFieldSources;
    updates.updated_at = new Date().toISOString();

    // Truncate VARCHAR-limited fields to prevent 22001 overflow errors.
    // Production schema (migration 011): position VARCHAR(255), education VARCHAR(255)
    // Migration 001: name VARCHAR(255), email VARCHAR(255), phone VARCHAR(50)
    const VARCHAR_LIMITS: Record<string, number> = {
      name: 255, email: 255, phone: 50, position: 255, education: 255,
      nationality: 100, country_of_interest: 100, marital_status: 20,
      gender: 20,
    };
    for (const [col, maxLen] of Object.entries(VARCHAR_LIMITS)) {
      if (typeof updates[col] === 'string' && updates[col].length > maxLen) {
        updates[col] = updates[col].slice(0, maxLen);
      }
    }

    // Strip columns that do not exist in the production candidates table
    // to prevent PGRST204 "could not find column" errors.
    const KNOWN_CANDIDATE_COLUMNS = new Set([
      // Core identity
      'name', 'father_name', 'email', 'phone', 'date_of_birth', 'gender',
      'marital_status', 'address', 'cnic_normalized', 'passport_normalized',
      // Profile
      'nationality', 'position', 'experience_years', 'country_of_interest',
      'skills', 'languages', 'education', 'certifications', 'internships',
      'previous_employment', 'passport_expiry', 'professional_summary',
      // Status & meta
      'status', 'source', 'ai_score', 'auto_extracted', 'needs_review',
      'updated_at', 'field_sources', 'extraction_confidence', 'extraction_source',
      'extracted_at',
      // Checklist flags
      'passport_received', 'cnic_received', 'degree_received', 'medical_received',
      'visa_received', 'cv_received', 'photo_received', 'certificate_received',
      // Other known columns
      'profile_photo_url', 'gcc_years', 'salary_expectation', 'available_from',
      'religion', 'driving_license', 'medical_expiry', 'interview_date',
    ]);
    for (const col of Object.keys(updates)) {
      if (!KNOWN_CANDIDATE_COLUMNS.has(col)) {
        console.warn(`[ProgressiveCompletion] Stripping unknown column '${col}' from update to prevent schema error`);
        delete updates[col];
      }
    }

    const { error: updateError } = await db
      .from('candidates')
      .update(updates)
      .eq('id', candidateId);

    if (updateError) {
      throw new Error(`Failed to update candidate: ${updateError.message}`);
    }

    // Log enrichment event with old and new values
    for (const field of updated) {
      await logEnrichmentEvent(
        candidateId,
        [field],
        [],
        source,
        documentId,
        oldValues[field],
        updates[field]
      );
    }
  }

  return {
    updated,
    skipped,
    sourceTracking,
  };
}

/**
 * Calculate missing fields for a candidate
 * Based on Excel Browser fields (the "bible")
 */
export function calculateMissingFields(candidate: any): string[] {
  const missingSet = new Set<string>();
  const placeholderValues = new Set(['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided']);
  const internalOrComputedFields = new Set<string>([
    // Computed internally (should not be requested from the candidate)
    'ai_score',
  ]);

  // Check each Excel Browser field
  for (const [field, label] of Object.entries(EXCEL_BROWSER_FIELDS)) {
    if (internalOrComputedFields.has(field)) {
      continue;
    }

    const value = candidate[field];

    // Special handling for calculated fields
    if (field === 'age') {
      // Age is calculated from date_of_birth
      if (!candidate.date_of_birth) {
        missingSet.add('date_of_birth');
      }
      continue;
    }

    if (field === 'languages') {
      // Languages field might be used for English/Arabic extraction
      // But it's not a required field itself
      continue;
    }

    if (!candidateHasColumn(candidate, field)) {
      continue;
    }

    // Check if field is missing
    // Also check for placeholder strings (which might be stored as defaults or bad extraction values)
    if (value === null || value === undefined || value === '' ||
      (typeof value === 'string' && (value.trim() === '' || placeholderValues.has(value.trim().toLowerCase())))) {
      missingSet.add(field);
    }
  }

  return Array.from(missingSet);
}

/**
 * Update missing_fields JSON column
 */
export async function updateMissingFields(candidateId: string): Promise<string[]> {
  const db = supabaseAdminClient();

  const { data: candidate, error } = await db
    .from('candidates')
    .select('*')
    .eq('id', candidateId)
    .maybeSingle();

  if (error || !candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }

  const missingFields = calculateMissingFields(candidate);

  // Update missing_fields column
  await db
    .from('candidates')
    .update({
      missing_fields: missingFields,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId);

  return missingFields;
}

/**
 * Manual field update (highest priority)
 */
export async function updateFieldManually(
  candidateId: string,
  field: string,
  value: any,
  userId?: string
): Promise<void> {
  const db = supabaseAdminClient();

  // Get current candidate data (including field_sources and the field we're updating)
  const { data: candidate } = await db
    .from('candidates')
    .select('*')
    .eq('id', candidateId)
    .maybeSingle();

  if (!candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }

  const currentFieldSources: Record<string, FieldSource> =
    (candidate.field_sources as Record<string, FieldSource>) || {};

  // Determine database field name for CNIC/passport
  let dbFieldName = field;
  if (field === 'cnic') {
    dbFieldName = 'cnic_normalized';
  } else if (field === 'passport') {
    dbFieldName = 'passport_normalized';
  }

  // Get old value for audit logging (before update) - use dbFieldName
  const oldValue = (candidate as any)[dbFieldName] || null;

  // Normalize special fields
  let normalizedValue = value;

  if (field === 'cnic' && typeof value === 'string') {
    // Map cnic to cnic_normalized (database column name)
    normalizedValue = normalizeCNIC(value);
    dbFieldName = 'cnic_normalized';
  } else if (field === 'passport' && typeof value === 'string') {
    normalizedValue = normalizePassport(value);
    dbFieldName = 'passport_normalized';
  } else if (field === 'date_of_birth' && typeof value === 'string') {
    normalizedValue = parseDate(value);
  }

  // Update field with manual source (use dbFieldName for database update)
  const newFieldSources: Record<string, FieldSource> = {
    ...currentFieldSources,
    [dbFieldName]: {
      field: dbFieldName,
      source: 'manual',
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
  };

  const updates: any = {
    [dbFieldName]: normalizedValue,
    field_sources: newFieldSources,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from('candidates')
    .update(updates)
    .eq('id', candidateId);

  if (error) {
    throw new Error(`Failed to update field: ${error.message}`);
  }

  // Recalculate missing fields
  await updateMissingFields(candidateId);

  // Log enrichment event (use dbFieldName for logging)
  await logEnrichmentEvent(candidateId, [dbFieldName], [], 'manual', undefined, oldValue, normalizedValue);
}

/**
 * Parse date from various formats
 */
function parseDate(dateStr: any): string | null {
  if (!dateStr) return null;

  try {
    const str = String(dateStr);

    // Format: "13 October 1983"
    if (str.includes(' ')) {
      const date = new Date(str);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }

    // Format: DD-MM-YYYY or YYYY-MM-DD
    if (str.includes('-')) {
      const parts = str.split('-');
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        return str;
      } else {
        // DD-MM-YYYY
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }

    // Try direct parse
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {
    console.warn(`Failed to parse date: ${dateStr}`, e);
  }

  return null;
}

/**
 * Log enrichment event for audit trail
 */
async function logEnrichmentEvent(
  candidateId: string,
  updatedFields: string[],
  skippedFields: string[],
  source: DocumentSource,
  documentId?: string,
  oldValue?: any,
  newValue?: any
): Promise<void> {
  const db = supabaseAdminClient();

  try {
    // Get current candidate values for old_value tracking
    const { data: candidate } = await db
      .from('candidates')
      .select('*')
      .eq('id', candidateId)
      .maybeSingle();

    // Get document type if documentId is provided
    let documentType: string | undefined;
    if (documentId) {
      const { data: document } = await db
        .from('candidate_documents')
        .select('document_type, category')
        .eq('id', documentId)
        .maybeSingle();
      documentType = document?.document_type || document?.category || undefined;
    }

    // Log each updated field individually
    for (const field of updatedFields) {
      // Use provided old/new values if available, otherwise get from candidate
      const fieldOldValue = oldValue !== undefined ? oldValue : (candidate?.[field] || null);
      const fieldNewValue = newValue !== undefined ? newValue : (candidate?.[field] || null);

      const { error } = await db
        .from('enrichment_logs')
        .insert({
          candidate_id: candidateId,
          field_name: field,
          old_value: fieldOldValue ? String(fieldOldValue) : null,
          new_value: fieldNewValue ? String(fieldNewValue) : null,
          source: source,
          document_id: documentId || null,
          document_type: documentType || null,
          updated_by: null, // TODO: Get from auth context
        });

      if (error) {
        console.error(`[Enrichment] Failed to log field ${field}:`, error);
      }
    }

    // Also log skipped fields for audit (with reason)
    for (const field of skippedFields) {
      const { error } = await db
        .from('enrichment_logs')
        .insert({
          candidate_id: candidateId,
          field_name: field,
          old_value: candidate?.[field] ? String(candidate[field]) : null,
          new_value: null, // Skipped - no change
          source: source,
          document_id: documentId || null,
          document_type: documentType || null,
          updated_by: null,
        });

      if (error) {
        console.error(`[Enrichment] Failed to log skipped field ${field}:`, error);
      }
    }

    // Also log to console for debugging
    console.log(`[Enrichment] Candidate ${candidateId}:`, {
      updated: updatedFields,
      skipped: skippedFields,
      source,
      documentId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Don't fail if logging fails
    console.error('[Enrichment] Failed to log event:', error);
  }
}

/**
 * Check if email is a government/organizational email that should not be used for matching
 */
export function isGovernmentEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;

  const normalized = email.toLowerCase().trim();
  const patterns = [
    // Police/law enforcement patterns (Pakistan specific)
    'police', 'jhelum', 'lahore', 'islamabad', 'karachi', 'faisalabad',
    'rawalpindi', 'multan', 'peshawar', 'quetta', 'gjtpolice',
    'sindhpolice', 'punjabpolice', 'kppolice', 'balochistanpolice',
    'dpo', 'cpo', 'igp', 'dig', 'ssp', 'sho',

    // Government/official patterns  
    'govt', 'gov.', '@gov', 'government', 'department', 'ministry',
    'official', 'contact', 'info', 'admin', 'support', 'help', 'career',

    // Generic organizational emails that shouldn't be personal
    'admin@', 'info@', 'contact@', 'support@', 'noinformation',
    'noreply', 'do-not-reply', 'automail',

    // Agency / recruiter / company-managed inboxes commonly embedded in forwarded CVs
    'hr@', 'jobs@', 'careers@', 'recruit', 'recruitment', 'agency',
    'manpower', 'international', 'limited', 'ltd', 'enterprises', 'company',
  ];

  return patterns.some(pattern => normalized.includes(pattern));
}

/**
 * Find an existing candidate for an incoming document/CV.
 *
 * Single source of truth: delegates entirely to CandidateMatcher so every
 * ingestion path (Gmail, WhatsApp, web upload) uses identical logic.
 *
 * Auto-link threshold: confidence >= 0.84
 *   CNIC (0.99), Passport (0.98), Email (0.95), Phone (0.90),
 *   Name+DOB (0.86), Name+Father (0.85) → auto-link
 *   Name-only (0.80) → manual review, no auto-link
 *
 * Returns the candidate ID to link, or null to create a new record.
 */
export async function findExistingCandidate(
  extractedData: Record<string, any>,
  options?: {
    requireCorroborationForContactSignals?: boolean;
  }
): Promise<string | null> {
  const AUTO_LINK_CONFIDENCE_THRESHOLD = 0.84;

  const result = await CandidateMatcher.findCandidate({
    cnic:        extractedData.cnic,
    passport:    extractedData.passport || extractedData.passport_no,
    email:       extractedData.email,
    phone:       extractedData.phone,
    name:        extractedData.name,
    fatherName:  extractedData.father_name,
    dateOfBirth: extractedData.date_of_birth,
  });

  const requireCorroborationForContactSignals =
    options?.requireCorroborationForContactSignals === true;
  const isSingleContactSignalMatch =
    (result.matchedBy === 'email' || result.matchedBy === 'phone') &&
    result.matchCount === 1;

  if (requireCorroborationForContactSignals && isSingleContactSignalMatch) {
    console.warn(
      `[ProgressiveCompletion] Suppressing auto-link on single ${result.matchedBy} signal ` +
      `(confidence=${result.confidence}). Stronger corroboration required for this source.`
    );
    return null;
  }

  // Needs manual review → do not auto-link, but log for visibility
  if (result.needsManualReview) {
    console.warn(
      `[ProgressiveCompletion] Candidate match needs manual review ` +
      `(matchedBy=${result.matchedBy}, confidence=${result.confidence}):`,
      result.reviewReasons
    );
    return null;
  }

  // Below threshold → do not auto-link (name-only matches land here)
  if (!result.candidateId || result.confidence < AUTO_LINK_CONFIDENCE_THRESHOLD) {
    if (result.candidateId) {
      console.warn(
        `[ProgressiveCompletion] Match confidence ${result.confidence} below ` +
        `threshold ${AUTO_LINK_CONFIDENCE_THRESHOLD} — not auto-linking ` +
        `(matchedBy=${result.matchedBy})`
      );
    }
    return null;
  }

  console.log(
    `[ProgressiveCompletion] Auto-linking to existing candidate ${result.candidateId} ` +
    `(matchedBy=${result.matchedBy}, confidence=${result.confidence})`
  );
  return result.candidateId;
}
