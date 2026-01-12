"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.advancedCandidateSearch = advancedCandidateSearch;
exports.getSearchSuggestions = getSearchSuggestions;
const database_1 = require("../config/database");
/**
 * Advanced candidate search with full-text search and complex filters
 */
async function advancedCandidateSearch(params, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    let query = db.from('candidates').select('*', { count: 'exact' });
    // Full-text search across multiple fields
    if (params.query) {
        query = query.or(`name.ilike.%${params.query}%,` +
            `email.ilike.%${params.query}%,` +
            `candidate_code.ilike.%${params.query}%,` +
            `phone.ilike.%${params.query}%`);
    }
    // Apply filters
    if (params.filters) {
        const { filters } = params;
        if (filters.status && filters.status.length > 0) {
            query = query.in('status', filters.status);
        }
        if (filters.gender && filters.gender.length > 0) {
            query = query.in('gender', filters.gender);
        }
        if (filters.marital_status && filters.marital_status.length > 0) {
            query = query.in('marital_status', filters.marital_status);
        }
        if (filters.min_age !== undefined || filters.max_age !== undefined) {
            const currentYear = new Date().getFullYear();
            if (filters.max_age !== undefined) {
                const minBirthYear = currentYear - filters.max_age;
                query = query.gte('date_of_birth', `${minBirthYear}-01-01`);
            }
            if (filters.min_age !== undefined) {
                const maxBirthYear = currentYear - filters.min_age;
                query = query.lte('date_of_birth', `${maxBirthYear}-12-31`);
            }
        }
        if (filters.has_cnic === true) {
            query = query.not('cnic_normalized', 'is', null);
        }
        else if (filters.has_cnic === false) {
            query = query.is('cnic_normalized', null);
        }
        if (filters.has_passport === true) {
            query = query.not('passport_normalized', 'is', null);
        }
        else if (filters.has_passport === false) {
            query = query.is('passport_normalized', null);
        }
    }
    // Apply sorting
    if (params.sort) {
        query = query.order(params.sort.field, { ascending: params.sort.order === 'asc' });
    }
    else {
        query = query.order('created_at', { ascending: false });
    }
    // Apply pagination
    if (params.limit && params.offset !== undefined) {
        query = query.range(params.offset, params.offset + params.limit - 1);
    }
    else if (params.limit) {
        query = query.limit(params.limit);
    }
    const { data, error, count } = await query;
    if (error)
        throw error;
    return {
        candidates: data,
        total: count,
        limit: params.limit,
        offset: params.offset,
    };
}
/**
 * Get search suggestions based on partial input
 */
async function getSearchSuggestions(query, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidates')
        .select('name, email, candidate_code')
        .or(`name.ilike.%${query}%,email.ilike.%${query}%,candidate_code.ilike.%${query}%`)
        .limit(10);
    if (error)
        throw error;
    const suggestions = [];
    (data || []).forEach(candidate => {
        if (candidate.name?.toLowerCase().includes(query.toLowerCase())) {
            suggestions.push(candidate.name);
        }
        if (candidate.email?.toLowerCase().includes(query.toLowerCase())) {
            suggestions.push(candidate.email);
        }
        if (candidate.candidate_code?.toLowerCase().includes(query.toLowerCase())) {
            suggestions.push(candidate.candidate_code);
        }
    });
    return [...new Set(suggestions)].slice(0, 10);
}
