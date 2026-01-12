"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateJobCode = generateJobCode;
exports.createJobOrder = createJobOrder;
exports.getJobOrderById = getJobOrderById;
exports.listJobOrders = listJobOrders;
exports.updateJobOrder = updateJobOrder;
exports.deleteJobOrder = deleteJobOrder;
const database_1 = require("../config/database");
/**
 * Generate next job code in format JOB-2026-001
 */
async function generateJobCode() {
    const db = (0, database_1.supabaseAdminClient)();
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
async function createJobOrder(data, userId) {
    const db = (0, database_1.supabaseAdminClient)();
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
    if (error)
        throw error;
    return jobOrder;
}
/**
 * Get job order by ID with optional employer join
 */
async function getJobOrderById(id, userId, includeEmployer = false) {
    const db = (0, database_1.supabaseAdminClient)();
    if (includeEmployer) {
        const { data, error } = await db
            .from('job_orders')
            .select('*, employer:employers(id, company_name)')
            .eq('id', id)
            .single();
        if (error)
            throw error;
        return data;
    }
    else {
        const { data, error } = await db
            .from('job_orders')
            .select('*')
            .eq('id', id)
            .single();
        if (error)
            throw error;
        return data;
    }
}
/**
 * List job orders with optional filters
 */
async function listJobOrders(filters = {}, userId, includeEmployer = false) {
    const db = (0, database_1.supabaseAdminClient)();
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
    }
    else if (filters.limit) {
        query = query.limit(filters.limit);
    }
    // Order by job_code descending (most recent first)
    query = query.order('job_code', { ascending: false });
    const { data, error, count } = await query;
    if (error)
        throw error;
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
async function updateJobOrder(id, data, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const updateData = {};
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
    if (error)
        throw error;
    return jobOrder;
}
/**
 * Delete job order
 */
async function deleteJobOrder(id, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    // Check if job order has associated matches
    const { data: matches, error: matchError } = await db
        .from('job_candidate_matches')
        .select('id')
        .eq('job_order_id', id)
        .limit(1);
    if (matchError)
        throw matchError;
    if (matches && matches.length > 0) {
        throw new Error('Cannot delete job order with candidate matches. Remove matches first.');
    }
    const { error } = await db
        .from('job_orders')
        .delete()
        .eq('id', id);
    if (error)
        throw error;
}
