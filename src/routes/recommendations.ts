import { Router, Request, Response } from 'express';
import { supabaseAdminClient } from '../config/database';

const router = Router();

// ─── Match Score ──────────────────────────────────────────────────────────────
// Scoring (max 100):
//   Profession specialty match:  all specialty words match → +50, any → +25, none → +0
//   Country match:               +20
//   Skills match:                +10 per matching skill, max 3 → +30
//
// "Specialty words" = profession words that are NOT generic title words.
// This prevents "engineer" alone matching every engineering profession.
// Admin can override any score after recommendation.

const GENERIC_TITLE_WORDS = new Set([
  'engineer', 'manager', 'officer', 'supervisor', 'technician', 'specialist',
  'assistant', 'coordinator', 'executive', 'director', 'analyst', 'consultant',
  'worker', 'staff', 'operator', 'inspector', 'helper', 'admin', 'administrator',
  'head', 'lead', 'senior', 'junior', 'general', 'chief', 'associate', 'deputy',
  'foreman', 'incharge', 'charge', 'controller', 'planner', 'estimator',
]);

function extractSpecialtyWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[\s,;/()&+]+/)
    .map((w: string) => w.replace(/[^a-z]/g, ''))
    .filter((w: string) => w.length > 2 && !GENERIC_TITLE_WORDS.has(w));
  return [...new Set(words)];
}

function computeMatchScore(candidate: Record<string, any>, job: Record<string, any>): number {
  let score = 0;

  const jobProfession = (job.professions || '').toLowerCase();
  const jobText = (jobProfession + ' ' + (job.comments || '')).toLowerCase();
  const candidatePosition = (candidate.position || '').toLowerCase();
  const candidateSkills = (candidate.skills || '').toLowerCase();
  const candidateCountry = (candidate.country_of_interest || '').toLowerCase();
  const jobCountry = (job.country || '').toLowerCase();

  // ── Profession match (0 / 25 / 50) ────────────────────────────────────────
  // Extract specialty words from the job's required profession.
  let specialtyWords = extractSpecialtyWords(jobProfession);
  // If profession is purely generic (e.g. "Manager"), fall back to all words.
  if (specialtyWords.length === 0) {
    specialtyWords = jobProfession
      .split(/[\s,;/]+/)
      .map((w: string) => w.trim())
      .filter((w: string) => w.length > 2);
  }

  if (specialtyWords.length > 0) {
    const allMatch = specialtyWords.every((w: string) => candidatePosition.includes(w));
    const anyMatch = specialtyWords.some((w: string) => candidatePosition.includes(w));
    if (allMatch) {
      score += 50;   // Exact profession match — e.g. "chemical" in "chemical engineer"
    } else if (anyMatch) {
      score += 25;   // Partial match — at least one specialty word overlaps
    }
    // Zero if no specialty word found in candidate position
  }

  // ── Country match (+20) ────────────────────────────────────────────────────
  if (jobCountry && candidateCountry && jobCountry === candidateCountry) score += 20;

  // ── Skills match (+10 per skill, max 3 = +30) ──────────────────────────────
  const skillList = candidateSkills
    .split(/[,;]+/)
    .map((s: string) => s.trim().toLowerCase())
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

    // Use specialty words only — avoids counting all 'engineers' for a specific discipline
    let keywords = extractSpecialtyWords(job.professions || '').slice(0, 2);
    if (keywords.length === 0) {
      keywords = (job.professions || '')
        .toLowerCase()
        .split(/[\s,;/]+/)
        .filter((w: string) => w.length > 2)
        .slice(0, 2);
    }

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

    // Prefer specialty words for filtering; fall back to all profession words only if none.
    // This ensures 'chemical engineer' jobs don't pull in all engineers.
    let keywords = extractSpecialtyWords(job.professions || '').slice(0, 3);
    const fullProfessionKeywords = (job.professions || '')
      .toLowerCase()
      .split(/[\s,;/]+/)
      .filter((w: string) => w.length > 2)
      .slice(0, 3);
    if (keywords.length === 0) keywords = fullProfessionKeywords;

    let query = db
      .from('candidates')
      .select('id, name, position, skills, experience_years, country_of_interest, profile_photo_url, candidate_code, professional_summary')
      .order('created_at', { ascending: false })
      .limit(150);

    if (search) {
      query = query.or(
        `position.ilike.%${search}%,skills.ilike.%${search}%,name.ilike.%${search}%`
      );
    } else if (keywords.length > 0) {
      // Primary: match specialty words in position (strict)
      // Also include skills matches so admins can find cross-discipline candidates if needed
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
