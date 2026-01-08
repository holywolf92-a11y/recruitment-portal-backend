import { supabaseAdminClient } from '../config/database';

export interface JobOrder {
  id: string;
  job_code: string;
  employer_id: string;
}

export interface JobOrderWithEmployer extends JobOrder {
  employer?: {
    id: string;
    company_name: string;
  };
}

export interface CreateJobOrderData {
  job_code: string;
  employer_id: string;
}

export interface JobOrderFilters {
  search?: string;
  employer_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Generate next job code in format JOB-2026-001
 */
export async function generateJobCode(): Promise<string> {
  const db = supabaseAdminClient();
  const currentYear = new Date().getFullYear();

  // Get count of job orders created this year
  const { count } = await db
    .from('job_orders')
    .select('*', { count: 'exact', head: true })
    .ilike('job_code', `JOB-${currentYear}-%`);

  const sequenceNumber = (count || 0) + 1;
  const paddedNumber = sequenceNumber.toString().padStart(3, '0');

  return `JOB-${currentYear}-${paddedNumber}`;
}

/**
 * Create a new job order
 */
export async function createJobOrder(data: CreateJobOrderData, userId: string): Promise<JobOrder> {
  const db = supabaseAdminClient();

  // Validate employer exists
  const { data: employer, error: employerError } = await db
    .from('employers')
    .select('id')
    .eq('id', data.employer_id)
    .single();

  if (employerError || !employer) {
    throw new Error('Employer not found');
  }

  // Check for duplicate job code
  const { data: existing } = await db
    .from('job_orders')
    .select('id, job_code')
    .eq('job_code', data.job_code)
    .single();

  if (existing) {
    throw new Error(`Job order with code "${existing.job_code}" already exists`);
  }

  const jobOrderData = {
    job_code: data.job_code,
    employer_id: data.employer_id,
  };

  const { data: jobOrder, error } = await db
    .from('job_orders')
    .insert(jobOrderData)
    .select()
    .single();

  if (error) throw error;
  return jobOrder;
}

/**
 * Get job order by ID with optional employer join
 */
export async function getJobOrderById(id: string, userId: string, includeEmployer: boolean = false): Promise<JobOrderWithEmployer> {
  const db = supabaseAdminClient();

  if (includeEmployer) {
    const { data, error } = await db
      .from('job_orders')
      .select('*, employer:employers(id, company_name)')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  } else {
    const { data, error } = await db
      .from('job_orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }
}

/**
 * List job orders with optional filters
 */
export async function listJobOrders(filters: JobOrderFilters = {}, userId: string, includeEmployer: boolean = false) {
  const db = supabaseAdminClient();
  
  let selectQuery = includeEmployer 
    ? '*, employer:employers(id, company_name)' 
    : '*';

  let query = db.from('job_orders').select(selectQuery, { count: 'exact' });

  // Apply search filter (job_code)
  if (filters.search) {
    query = query.ilike('job_code', `%${filters.search}%`);
  }

  // Filter by employer
  if (filters.employer_id) {
    query = query.eq('employer_id', filters.employer_id);
  }

  // Apply pagination
  if (filters.limit && filters.offset !== undefined) {
    query = query.range(filters.offset, filters.offset + filters.limit - 1);
  } else if (filters.limit) {
    query = query.limit(filters.limit);
  }

  // Order by job_code descending (most recent first)
  query = query.order('job_code', { ascending: false });

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    jobOrders: data,
    total: count,
    limit: filters.limit,
    offset: filters.offset,
  };
}

/**
 * Update job order
 */
export async function updateJobOrder(
  id: string,
  data: Partial<CreateJobOrderData>,
  userId: string
): Promise<JobOrder> {
  const db = supabaseAdminClient();

  const updateData: any = {};

  // Validate job_code if provided
  if (data.job_code !== undefined) {
    if (!data.job_code || data.job_code.trim().length === 0) {
      throw new Error('Job code cannot be empty');
    }

    // Check for duplicate job code (excluding current job order)
    const { data: existing } = await db
      .from('job_orders')
      .select('id, job_code')
      .eq('job_code', data.job_code)
      .neq('id', id)
      .single();

    if (existing) {
      throw new Error(`Job order with code "${existing.job_code}" already exists`);
    }

    updateData.job_code = data.job_code;
  }

  // Validate employer_id if provided
  if (data.employer_id !== undefined) {
    const { data: employer, error: employerError } = await db
      .from('employers')
      .select('id')
      .eq('id', data.employer_id)
      .single();

    if (employerError || !employer) {
      throw new Error('Employer not found');
    }

    updateData.employer_id = data.employer_id;
  }

  const { data: jobOrder, error } = await db
    .from('job_orders')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return jobOrder;
}

/**
 * Delete job order
 */
export async function deleteJobOrder(id: string, userId: string): Promise<void> {
  const db = supabaseAdminClient();

  // Check if job order has associated matches
  const { data: matches, error: matchError } = await db
    .from('job_candidate_matches')
    .select('id')
    .eq('job_order_id', id)
    .limit(1);

  if (matchError) throw matchError;

  if (matches && matches.length > 0) {
    throw new Error('Cannot delete job order with candidate matches. Remove matches first.');
  }

  const { error } = await db
    .from('job_orders')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
