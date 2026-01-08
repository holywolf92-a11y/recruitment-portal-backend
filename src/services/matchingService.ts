import { supabaseAdminClient } from '../config/database';

export interface CandidateMatch {
  id: string;
  job_order_id: string;
  candidate_id: string;
  score: number;
}

export interface MatchingParams {
  job_order_id: string;
  min_score?: number;
  limit?: number;
}

export interface MatchResult {
  candidate_id: string;
  candidate_name: string;
  score: number;
  match_reasons: string[];
}

/**
 * Find candidate matches for a job order
 */
export async function matchCandidatesForJob(params: MatchingParams, userId: string): Promise<MatchResult[]> {
  const db = supabaseAdminClient();

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

  if (candidatesError) throw candidatesError;

  // In a real implementation, this would use sophisticated matching algorithms:
  // - Skills matching
  // - Experience matching
  // - Location proximity
  // - Salary expectations
  // - Availability
  // - Previous placements
  // - ML-based scoring

  // Mock implementation with random scores
  const matches: MatchResult[] = (candidates || []).map(candidate => ({
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
export async function saveCandidateMatches(
  jobOrderId: string,
  candidateIds: string[],
  scores: number[],
  userId: string
): Promise<CandidateMatch[]> {
  const db = supabaseAdminClient();

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

  if (error) throw error;
  return data || [];
}

/**
 * Get saved matches for a job order
 */
export async function getJobMatches(jobOrderId: string, userId: string): Promise<CandidateMatch[]> {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from('job_candidate_matches')
    .select('*')
    .eq('job_order_id', jobOrderId)
    .order('score', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Delete a candidate match
 */
export async function deleteCandidateMatch(matchId: string, userId: string): Promise<void> {
  const db = supabaseAdminClient();

  const { error } = await db
    .from('job_candidate_matches')
    .delete()
    .eq('id', matchId);

  if (error) throw error;
}
