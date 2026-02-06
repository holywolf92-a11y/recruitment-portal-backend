import { supabaseAdminClient } from '../config/database';

export interface Employer {
  id: string;
  company_name: string;
  email?: string | null;
  created_at: string;
}

export interface CreateEmployerData {
  company_name: string;
  email?: string;
}

export interface EmployerFilters {
  search?: string;
  limit?: number;
  offset?: number;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Create a new employer
 */
export async function createEmployer(data: CreateEmployerData, userId: string): Promise<Employer> {
  const db = supabaseAdminClient();

  // Validate company name
  if (!data.company_name || data.company_name.trim().length === 0) {
    throw new Error('Company name is required');
  }

  // Check for duplicate company name
  const { data: existing } = await db
    .from('employers')
    .select('id, company_name')
    .ilike('company_name', data.company_name.trim())
    .single();

  if (existing) {
    throw new Error(`Employer with company name "${existing.company_name}" already exists`);
  }

  if (data.email && !isValidEmail(data.email.trim())) {
    throw new Error('Invalid employer email address');
  }

  const employerData = {
    company_name: data.company_name.trim(),
    email: data.email ? data.email.trim().toLowerCase() : null,
  };

  const { data: employer, error } = await db
    .from('employers')
    .insert(employerData)
    .select()
    .single();

  if (error) throw error;
  return employer;
}

/**
 * Get employer by ID
 */
export async function getEmployerById(id: string, userId: string): Promise<Employer> {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from('employers')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * List employers with optional filters
 */
export async function listEmployers(filters: EmployerFilters = {}, userId: string) {
  const db = supabaseAdminClient();
  let query = db.from('employers').select('*', { count: 'exact' });

  // Apply search filter
  if (filters.search) {
    query = query.ilike('company_name', `%${filters.search}%`);
  }

  // Apply pagination
  if (filters.limit && filters.offset !== undefined) {
    query = query.range(filters.offset, filters.offset + filters.limit - 1);
  } else if (filters.limit) {
    query = query.limit(filters.limit);
  }

  // Order by company name
  query = query.order('company_name', { ascending: true });

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    employers: data,
    total: count,
    limit: filters.limit,
    offset: filters.offset,
  };
}

/**
 * Update employer
 */
export async function updateEmployer(
  id: string,
  data: Partial<CreateEmployerData>,
  userId: string
): Promise<Employer> {
  const db = supabaseAdminClient();

  // Validate if updating company name
  if (data.company_name !== undefined) {
    if (!data.company_name || data.company_name.trim().length === 0) {
      throw new Error('Company name cannot be empty');
    }

    // Check for duplicate company name (excluding current employer)
    const { data: existing } = await db
      .from('employers')
      .select('id, company_name')
      .ilike('company_name', data.company_name.trim())
      .neq('id', id)
      .single();

    if (existing) {
      throw new Error(`Employer with company name "${existing.company_name}" already exists`);
    }
  }

  if (data.email !== undefined) {
    if (data.email && !isValidEmail(data.email.trim())) {
      throw new Error('Invalid employer email address');
    }
  }

  const updateData: any = {};
  if (data.company_name !== undefined) {
    updateData.company_name = data.company_name.trim();
  }
  if (data.email !== undefined) {
    updateData.email = data.email ? data.email.trim().toLowerCase() : null;
  }

  const { data: employer, error } = await db
    .from('employers')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return employer;
}

/**
 * Delete employer
 */
export async function deleteEmployer(id: string, userId: string): Promise<void> {
  const db = supabaseAdminClient();

  // Check if employer has associated job orders
  const { data: jobOrders, error: jobOrderError } = await db
    .from('job_orders')
    .select('id')
    .eq('employer_id', id)
    .limit(1);

  if (jobOrderError) throw jobOrderError;

  if (jobOrders && jobOrders.length > 0) {
    throw new Error('Cannot delete employer with associated job orders. Delete job orders first.');
  }

  const { error } = await db
    .from('employers')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
