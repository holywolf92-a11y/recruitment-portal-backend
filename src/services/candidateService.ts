import { supabaseAdminClient } from '../config/database';
import { logProfileCreated, logProfileUpdated } from './timelineService';

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

  // Get the count of candidates created this year
  const { count } = await db
    .from('candidates')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${currentYear}-01-01T00:00:00.000Z`)
    .lt('created_at', `${currentYear + 1}-01-01T00:00:00.000Z`);

  // Generate the next sequential number (padded to 3 digits)
  const sequenceNumber = (count || 0) + 1;
  const paddedNumber = sequenceNumber.toString().padStart(3, '0');

  return `FL-${currentYear}-${paddedNumber}`;
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
  email?: string;
  phone?: string;
  date_of_birth?: string;
  gender?: string;
  marital_status?: string;
  address?: string;
  cnic?: string;
  passport?: string;
}

export async function createCandidate(data: CreateCandidateData, userId: string) {
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

  // Create candidate record
  const candidateData = {
    candidate_code: candidateCode,
    name: data.name,
    email: data.email,
    phone: phoneNormalized,
    date_of_birth: data.date_of_birth,
    gender: data.gender,
    marital_status: data.marital_status,
    address: data.address,
    cnic_normalized: cnicNormalized,
    passport_normalized: passportNormalized,
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
  limit?: number;
  offset?: number;
}

export async function listCandidates(filters: CandidateFilters = {}, userId: string) {
  const db = supabaseAdminClient();
  let query = db.from('candidates').select('*', { count: 'exact' });

  // Apply search filter (name, email, candidate_code)
  if (filters.search) {
    query = query.or(`name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,candidate_code.ilike.%${filters.search}%`);
  }

  // Apply pagination
  if (filters.limit && filters.offset !== undefined) {
    query = query.range(filters.offset, filters.offset + filters.limit - 1);
  } else if (filters.limit) {
    query = query.limit(filters.limit);
  }

  // Order by created_at desc
  query = query.order('created_at', { ascending: false });

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    candidates: data,
    total: count,
    limit: filters.limit,
    offset: filters.offset
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