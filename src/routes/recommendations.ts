import { Router, Request, Response } from 'express';
import { supabaseAdminClient } from '../config/database';

const router = Router();

// ─── Match Score ──────────────────────────────────────────────────────────────
// Base 55, position match +35, country match +20, skills match +10 each (max 3).
// Admin can override any score after recommendation.

function computeMatchScore(candidate: Record<string, any>, job: Record<string, any>): number {
  let score = 55;

  const jobText = ((job.professions || '') + ' ' + (job.comments || '')).toLowerCase();
  const candidatePosition = (candidate.position || '').toLowerCase();
  const candidateSkills = (candidate.skills || '').toLowerCase();
  const candidateCountry = (candidate.country_of_interest || '').toLowerCase();
  const jobCountry = (job.country || '').toLowerCase();

  // Position match: +35
  const jobWords = jobText.split(/[\s,;/]+/).filter((w: string) => w.length > 3);
  const positionWords = candidatePosition.split(/[\s,;/]+/).filter((w: string) => w.length > 3);
  const positionMatch =
    positionWords.some((w: string) => jobText.includes(w)) ||
    jobWords.some((w: string) => candidatePosition.includes(w));
  if (positionMatch) score += 35;

  // Country match: +20
  if (jobCountry && candidateCountry && jobCountry === candidateCountry) score += 20;

  // Skills match: +10 per skill, max 3
  const skillList = candidateSkills
    .split(/[,;]+/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 3);
  let skillMatches = 0;
  for (const skill of skillList) {
    if (jobText.includes(skill)) {
      skillMatches++;
      if (skillMatches >= 3) break;
    }
  }
  score += skillMatches * 10;

  return Math.min(score, 100);
}

// ─── GET /recommendations/pool-count/:jobId ───────────────────────────────────
// Loose count of candidates matching a job's profession — used for locked state.
// Never returns less than 15.
router.get('/pool-count/:jobId', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const { jobId } = req.params;

    const { data: job } = await db
      .from('employer_leads')
      .select('professions, country')
      .eq('id', jobId)
      .single();

    if (!job) return res.json({ count: 15 });

    const professions = (job.professions || '').toLowerCase();
    const keywords = professions
      .split(/[\s,;/]+/)
      .filter((w: string) => w.length > 2)
      .slice(0, 2);

    if (keywords.length === 0) return res.json({ count: 15 });

    const orParts = keywords.flatMap((kw: string) => [
      `position.ilike.%${kw}%`,
      `skills.ilike.%${kw}%`,
    ]);

    const { count } = await db
      .from('candidates')
      .select('id', { count: 'exact', head: true })
      .or(orParts.join(','));

    return res.json({ count: Math.max(count || 0, 15) });
  } catch (err: any) {
    console.error('Error getting pool count:', err);
    res.status(500).json({ error: 'Failed to get pool count' });
  }
});

// ─── GET /recommendations/job/:jobId/candidates ───────────────────────────────
// Admin: search candidates matching a job for the "Find Candidates" panel.
router.get('/job/:jobId/candidates', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const { jobId } = req.params;
    const { search } = req.query as { search?: string };

    const { data: job, error: jobErr } = await db
      .from('employer_leads')
      .select('id, professions, country, comments')
      .eq('id', jobId)
      .single();

    if (jobErr || !job) return res.status(404).json({ error: 'Job not found' });

    const professions = (job.professions || '').toLowerCase();
    const keywords = professions
      .split(/[\s,;/]+/)
      .filter((w: string) => w.length > 2)
      .slice(0, 3);

    let query = db
      .from('candidates')
      .select('id, name, position, skills, experience_years, country_of_interest, profile_photo_url, candidate_code, professional_summary')
      .order('created_at', { ascending: false })
      .limit(100);

    if (search) {
      query = query.or(
        `position.ilike.%${search}%,skills.ilike.%${search}%,name.ilike.%${search}%`
      );
    } else if (keywords.length > 0) {
      const orParts = keywords.flatMap((kw: string) => [
        `position.ilike.%${kw}%`,
        `skills.ilike.%${kw}%`,
      ]);
      query = query.or(orParts.join(','));
    }

    const { data: candidates, error } = await query;
    if (error) throw error;

    // Mark already-recommended candidates
    const { data: existing } = await db
      .from('job_candidate_recommendations')
      .select('candidate_id')
      .eq('job_id', jobId);

    const alreadyRecommended = new Set(
      (existing || []).map((r: any) => r.candidate_id)
    );

    const scored = (candidates || [])
      .map((c: any) => ({
        ...c,
        match_score: computeMatchScore(c, job),
        already_recommended: alreadyRecommended.has(c.id),
      }))
      .sort((a: any, b: any) => b.match_score - a.match_score);

    return res.json({ candidates: scored, job });
  } catch (err: any) {
    console.error('Error fetching candidate pool:', err);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

// ─── POST /recommendations/job/:jobId/recommend ───────────────────────────────
// Admin: push selected candidates as recommendations for a specific job.
router.post('/job/:jobId/recommend', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const { jobId } = req.params;
    const { candidates } = req.body as {
      candidates: Array<{ candidate_id: string; match_score: number; admin_notes?: string }>;
    };

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'No candidates provided' });
    }

    // Verify job exists
    const { data: job, error: jobErr } = await db
      .from('employer_leads')
      .select('id')
      .eq('id', jobId)
      .single();

    if (jobErr || !job) return res.status(404).json({ error: 'Job not found' });

    const rows = candidates.map((c) => ({
      job_id: jobId,
      candidate_id: c.candidate_id,
      match_score: Math.min(Math.max(Math.round(c.match_score), 0), 100),
      employer_status: 'unreviewed',
      admin_notes: c.admin_notes || null,
      recommended_at: new Date().toISOString(),
    }));

    const { data, error } = await db
      .from('job_candidate_recommendations')
      .upsert(rows, { onConflict: 'job_id,candidate_id', ignoreDuplicates: false })
      .select();

    if (error) throw error;

    return res.json({ recommended: data?.length || 0, recommendations: data });
  } catch (err: any) {
    console.error('Error saving recommendations:', err);
    res.status(500).json({ error: 'Failed to save recommendations' });
  }
});

// ─── GET /recommendations/job/:jobId ─────────────────────────────────────────
// Get all recommendations for a job (with candidate details).
// Used by both admin and employer portal.
router.get('/job/:jobId', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const { jobId } = req.params;

    const { data, error } = await db
      .from('job_candidate_recommendations')
      .select(`
        id,
        match_score,
        employer_status,
        admin_notes,
        recommended_at,
        candidates (
          id, name, position, skills, experience_years,
          country_of_interest, profile_photo_url, candidate_code,
          professional_summary
        )
      `)
      .eq('job_id', jobId)
      .order('match_score', { ascending: false });

    if (error) throw error;

    return res.json({ recommendations: data || [] });
  } catch (err: any) {
    console.error('Error fetching recommendations:', err);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// ─── PATCH /recommendations/:recId/score ─────────────────────────────────────
// Admin: edit the match score for a recommendation.
router.patch('/:recId/score', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const { recId } = req.params;
    const { match_score } = req.body as { match_score: number };

    if (typeof match_score !== 'number' || match_score < 0 || match_score > 100) {
      return res.status(400).json({ error: 'match_score must be an integer 0–100' });
    }

    const { data, error } = await db
      .from('job_candidate_recommendations')
      .update({ match_score: Math.round(match_score) })
      .eq('id', recId)
      .select()
      .single();

    if (error) throw error;
    return res.json({ recommendation: data });
  } catch (err: any) {
    console.error('Error updating score:', err);
    res.status(500).json({ error: 'Failed to update score' });
  }
});

// ─── PATCH /recommendations/:recId/employer-status ───────────────────────────
// Employer: update their review status for a recommended candidate.
router.patch('/:recId/employer-status', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const { recId } = req.params;
    const { employer_status } = req.body as { employer_status: string };

    const valid = ['unreviewed', 'shortlisted', 'selected', 'rejected'];
    if (!valid.includes(employer_status)) {
      return res.status(400).json({ error: `employer_status must be one of: ${valid.join(', ')}` });
    }

    const { data, error } = await db
      .from('job_candidate_recommendations')
      .update({ employer_status })
      .eq('id', recId)
      .select()
      .single();

    if (error) throw error;
    return res.json({ recommendation: data });
  } catch (err: any) {
    console.error('Error updating employer status:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ─── DELETE /recommendations/:recId ──────────────────────────────────────────
// Admin: remove a recommendation.
router.delete('/:recId', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const { recId } = req.params;

    const { error } = await db
      .from('job_candidate_recommendations')
      .delete()
      .eq('id', recId);

    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting recommendation:', err);
    res.status(500).json({ error: 'Failed to delete recommendation' });
  }
});

export default router;
