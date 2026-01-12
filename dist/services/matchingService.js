"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchCandidatesForJob = matchCandidatesForJob;
exports.saveCandidateMatches = saveCandidateMatches;
exports.getJobMatches = getJobMatches;
exports.deleteCandidateMatch = deleteCandidateMatch;
const database_1 = require("../config/database");
/**
 * Find candidate matches for a job order
 */
async function matchCandidatesForJob(params, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    // Verify job order exists
    const { data: jobOrder, error: jobError } = await db
        .from('job_orders')
        .select('*')
        .eq('id', params.job_order_id)
        .single();
    if (jobError || !jobOrder) {
        throw new Error('Job order not found');
    }
    // Get all active candidates
    const { data: candidates, error: candidatesError } = await db
        .from('candidates')
        .select('*')
        .neq('status', 'Deleted');
    if (candidatesError)
        throw candidatesError;
    // In a real implementation, this would use sophisticated matching algorithms:
    // - Skills matching
    // - Experience matching
    // - Location proximity
    // - Salary expectations
    // - Availability
    // - Previous placements
    // - ML-based scoring
    // Mock implementation with random scores
    const matches = (candidates || []).map(candidate => ({
        candidate_id: candidate.id,
        candidate_name: candidate.name,
        score: Math.random() * 100,
        match_reasons: ['Skills match', 'Experience match', 'Location match'],
    }));
    // Filter by minimum score
    const minScore = params.min_score || 0;
    const filtered = matches.filter(m => m.score >= minScore);
    // Sort by score descending
    filtered.sort((a, b) => b.score - a.score);
    // Apply limit
    const limit = params.limit || filtered.length;
    return filtered.slice(0, limit);
}
/**
 * Save candidate matches to database
 */
async function saveCandidateMatches(jobOrderId, candidateIds, scores, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    // Prepare match records
    const matches = candidateIds.map((candidateId, index) => ({
        job_order_id: jobOrderId,
        candidate_id: candidateId,
        score: scores[index],
    }));
    // Insert matches
    const { data, error } = await db
        .from('job_candidate_matches')
        .insert(matches)
        .select();
    if (error)
        throw error;
    return data || [];
}
/**
 * Get saved matches for a job order
 */
async function getJobMatches(jobOrderId, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('job_candidate_matches')
        .select('*')
        .eq('job_order_id', jobOrderId)
        .order('score', { ascending: false });
    if (error)
        throw error;
    return data || [];
}
/**
 * Delete a candidate match
 */
async function deleteCandidateMatch(matchId, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { error } = await db
        .from('job_candidate_matches')
        .delete()
        .eq('id', matchId);
    if (error)
        throw error;
}
