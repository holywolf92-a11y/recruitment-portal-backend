/**
 * Progressive Candidate Data Completion Service
 * 
 * Core Principle: Any document can enrich a candidate, only fill missing fields, never overwrite.
 * Priority: Manual > Any Document (CV/Passport/License/Medical/Certificate)
 * 
 * Excel Browser Fields are the "bible" for required fields tracking.
 */

import { supabaseAdminClient } from '../config/database';
import { normalizeCNIC, normalizePassport } from './candidateService';

// Excel Browser fields (the "bible" for missing data tracking)
export const EXCEL_BROWSER_FIELDS = {
  // Basic View
  name: 'Name',
  position: 'Position',
  age: 'Age', // Calculated from date_of_birth
  nationality: 'Nationality',
  country_of_interest: 'Country',
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
  interview_date: 'Interview',
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
export type DocumentSource = 'cv' | 'passport' | 'driving_license' | 'medical' | 'certificate' | 'manual' | 'other';

// Field source tracking structure
export interface FieldSource {
  field: string;
  source: DocumentSource;
  document_id?: string;
  document_type?: string;
  updated_at: string;
  updated_by?: string;
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
    // Skip null/undefined/empty extracted values
    if (extractedValue === null || extractedValue === undefined || extractedValue === '') {
      continue;
    }
    
    // Get current value
    const currentValue = currentCandidate[field as keyof typeof currentCandidate];
    
    // Check if field is missing (NULL, empty string, or undefined)
    const isMissing = currentValue === null || 
                     currentValue === undefined || 
                     currentValue === '' ||
                     (typeof currentValue === 'string' && currentValue.trim() === '');
    
    // Get current field source
    const currentSource = currentFieldSources[field];
    
    // Priority check: Manual updates are never overwritten
    if (currentSource?.source === 'manual') {
      skipped.push(field);
      continue;
    }
    
    // Special precedence for nationality: CNIC/Passport should override CV
    // CNIC and Passport are authoritative identity documents, CV may have incorrect nationality
    if (field === 'nationality' && currentValue && typeof currentValue === 'string') {
      const currentNationality = currentValue.trim().toLowerCase();
      const extractedNationality = typeof extractedValue === 'string' ? extractedValue.trim().toLowerCase() : '';
      
      // Check if current nationality is from CV (less authoritative)
      const isFromCV = currentSource?.source === 'cv';
      
      // Check if new source is authoritative (CNIC, Passport, Driving License)
      const isAuthoritativeSource = source === 'passport' || 
                                    source === 'driving_license' ||
                                    documentType === 'cnic' || 
                                    documentType === 'passport' ||
                                    documentType === 'driving_license';
      
      // If current nationality is from CV and new source is authoritative, override
      if (isFromCV && isAuthoritativeSource) {
        console.log(`[ProgressiveCompletion] Overriding nationality from CV (${currentNationality}) with authoritative source ${source}/${documentType} nationality (${extractedNationality})`);
        // Continue to update below (bypass the isMissing check)
      } else if (!isMissing && !isFromCV) {
        // Field exists and not from CV, don't overwrite (unless manual)
        skipped.push(field);
        continue;
      }
    }
    
    // Only update if field is missing OR nationality override case above
    const shouldUpdate = isMissing || 
                        (field === 'nationality' && 
                         currentSource?.source === 'cv' && 
                         (source === 'passport' || source === 'driving_license' || documentType === 'cnic' || documentType === 'passport' || documentType === 'driving_license'));
    
    if (shouldUpdate) {
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
  const missing: string[] = [];
  
  // Check each Excel Browser field
  for (const [field, label] of Object.entries(EXCEL_BROWSER_FIELDS)) {
    const value = candidate[field];
    
    // Special handling for calculated fields
    if (field === 'age') {
      // Age is calculated from date_of_birth
      if (!candidate.date_of_birth) {
        missing.push('date_of_birth');
      }
      continue;
    }
    
    if (field === 'languages') {
      // Languages field might be used for English/Arabic extraction
      // But it's not a required field itself
      continue;
    }
    
    // Check if field is missing
    // Also check for the string "missing" (which might be stored as a default value)
    if (value === null || value === undefined || value === '' || 
        (typeof value === 'string' && (value.trim() === '' || value.toLowerCase() === 'missing'))) {
      missing.push(field);
    }
  }
  
  return missing;
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
    // Police/law enforcement patterns
    'police', 'jhelum', 'lahore', 'islamabad', 'karachi', 'faisalabad',
    'rawalpindi', 'multan', 'peshawar', 'quetta', 'gjtpolice',
    // Government/official patterns  
    'govt', 'gov.', '@gov', 'government', 'department', 'ministry',
    // Generic organizational emails that shouldn't be personal
    'admin@', 'info@', 'contact@', 'support@', 'noinformation',
  ];
  
  return patterns.some(pattern => normalized.includes(pattern));
}

/**
 * Find existing candidate by identity matching
 * Priority: CNIC > Passport > Email/Phone > Name + Father Name + DOB
 */
export async function findExistingCandidate(
  extractedData: Record<string, any>
): Promise<string | null> {
  const db = supabaseAdminClient();
  
  // Priority 1: CNIC
  if (extractedData.cnic) {
    const normalizedCNIC = normalizeCNIC(extractedData.cnic);
    if (normalizedCNIC) {
      const { data } = await db
        .from('candidates')
        .select('id')
        .eq('cnic_normalized', normalizedCNIC)
        .maybeSingle();
      if (data) return data.id;
    }
  }
  
  // Priority 2: Passport
  if (extractedData.passport || extractedData.passport_no) {
    const passport = extractedData.passport || extractedData.passport_no;
    const normalizedPassport = normalizePassport(passport);
    if (normalizedPassport) {
      const { data } = await db
        .from('candidates')
        .select('id')
        .eq('passport_normalized', normalizedPassport)
        .maybeSingle();
      if (data) return data.id;
    }
  }
  
  // Priority 3: Email (but SKIP government emails to prevent false matches)
  if (extractedData.email && !isGovernmentEmail(extractedData.email)) {
    const { data } = await db
      .from('candidates')
      .select('id')
      .eq('email', extractedData.email)
      .maybeSingle();
    if (data) return data.id;
  }
  
  // Priority 4: Phone
  if (extractedData.phone) {
    const { data } = await db
      .from('candidates')
      .select('id')
      .eq('phone', extractedData.phone)
      .maybeSingle();
    if (data) return data.id;
  }
  
  // Priority 5: Name + Father Name + DOB (fuzzy match)
  if (extractedData.name && extractedData.father_name) {
    const { data: candidates } = await db
      .from('candidates')
      .select('id, name, father_name, date_of_birth')
      .ilike('name', `%${extractedData.name.split(' ')[0]}%`)
      .limit(10);
    
    if (candidates && candidates.length > 0) {
      const firstName = extractedData.name.split(' ')[0].toLowerCase();
      const match = candidates.find((c: any) => {
        const cFirstName = c.name?.toLowerCase().split(' ')[0];
        const nameMatch = cFirstName === firstName || 
                        c.name?.toLowerCase().includes(firstName) ||
                        firstName.includes(cFirstName);
        
        const fatherMatch = c.father_name?.toLowerCase() === extractedData.father_name.toLowerCase();
        
        const dobMatch = extractedData.date_of_birth && c.date_of_birth &&
                        c.date_of_birth === parseDate(extractedData.date_of_birth);
        
        return nameMatch && (fatherMatch || dobMatch);
      });
      
      if (match) return match.id;
    }
  }
  
  return null;
}
