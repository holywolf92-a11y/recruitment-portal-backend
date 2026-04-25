"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// ─── Industry-Standard ATS Match Scoring ─────────────────────────────────────
//
// Based on Jobscan recruiter survey data (99.7% recruiter response rate):
//   76.4% filter by Skills        → skills carry most weight
//   55.3% filter by Job Title     → exact title is critical
//   44.3% filter by Experience    → years matter
//   43.4% filter by Location      → country/destination
//
// Score breakdown (max 100):
//   Job Title match:   0–30 pts   (exact/specialty/partial/none)
//   Skills match:      0–35 pts   (7 pts per skill match, up to 5 skills)
//   Experience match:  0–20 pts   (meets requirement = 20, unknown = 10, below = 5)
//   Location match:    0–15 pts   (exact country = 15)
//
// Admin can always override a candidate's score after recommendation.
// ── Title-level generic words ─────────────────────────────────────────────────
// Words that appear in many profession titles and carry NO discriminating value.
// "engineer" alone cannot distinguish chemical from civil from electrical.
const GENERIC_TITLE_WORDS = new Set([
    'engineer', 'manager', 'officer', 'supervisor', 'technician', 'specialist',
    'assistant', 'coordinator', 'executive', 'director', 'analyst', 'consultant',
    'worker', 'staff', 'operator', 'inspector', 'helper', 'admin', 'administrator',
    'head', 'lead', 'senior', 'junior', 'general', 'chief', 'associate', 'deputy',
    'foreman', 'incharge', 'incharg', 'charge', 'controller', 'planner', 'estimator',
    'the', 'and', 'for', 'with', 'of', 'in', 'at', 'to',
]);
// Normalize a title string: lowercase, strip punctuation, dedupe words
function normalizeTitle(text) {
    return [...new Set(text.toLowerCase()
            .split(/[\s,;/()&+\-]+/)
            .map((w) => w.replace(/[^a-z0-9]/g, ''))
            .filter((w) => w.length > 1))];
}
// Extract only the words that actually distinguish a profession (non-generic)
function specialtyWords(text) {
    return normalizeTitle(text).filter((w) => !GENERIC_TITLE_WORDS.has(w));
}
// ── 1. Job Title Match (max 30 pts) ──────────────────────────────────────────
// Compares the required profession against candidate's current position.
// Uses specialty-word extraction to prevent false positives like:
//   "Chemical Engineer" ≠ "Civil Engineer" (only "engineer" is common → 0 pts)
function titleMatchScore(jobProfession, candidatePosition) {
    const jobNorm = normalizeTitle(jobProfession);
    const candNorm = normalizeTitle(candidatePosition);
    // Exact full normalized title match
    if (jobNorm.length > 0 && jobNorm.every((w) => candNorm.includes(w))
        && candNorm.every((w) => jobNorm.includes(w)))
        return 30;
    // All job title words present in candidate title (e.g. "Senior Chemical Engineer" contains all of "Chemical Engineer")
    if (jobNorm.length > 0 && jobNorm.every((w) => candNorm.includes(w)))
        return 27;
    // Specialty words — the discriminating part of the title
    const jobSpecialty = specialtyWords(jobProfession);
    if (jobSpecialty.length === 0) {
        // Purely generic title like "Manager" — fall back to any normalized word match
        const anyGenericMatch = normalizeTitle(jobProfession).some((w) => candNorm.includes(w));
        return anyGenericMatch ? 15 : 0;
    }
    const matchedSpecialty = jobSpecialty.filter((w) => candidatePosition.toLowerCase().includes(w));
    const matchRatio = matchedSpecialty.length / jobSpecialty.length;
    if (matchRatio >= 1.0)
        return 25; // All specialty words match (e.g. "chemical" in "chemical process engineer")
    if (matchRatio >= 0.5)
        return 15; // Half+ specialty words match (multi-word specialty, partial)
    if (matchRatio > 0.0)
        return 8; // At least one specialty word (weak signal)
    return 0; // No specialty word match at all
}
// ── 2. Skills Match (max 35 pts) ─────────────────────────────────────────────
// Checks how many candidate skills appear in the job description.
// Up to 5 skills × 7 pts = 35 pts.
function skillsMatchScore(candidateSkills, jobText) {
    const skills = candidateSkills
        .toLowerCase()
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 3);
    let matched = 0;
    for (const skill of skills) {
        if (jobText.includes(skill)) {
            matched++;
            if (matched >= 5)
                break;
        }
    }
    return matched * 7;
}
// ── 3. Experience Match (max 20 pts) ─────────────────────────────────────────
// Tries to parse a minimum years requirement from job comments/description.
// Pattern: "3+ years", "minimum 5 years", "3-5 years", "3 years experience"
function experienceMatchScore(candidateYears, jobComments) {
    const text = (jobComments || '').toLowerCase();
    const match = text.match(/(\d+)\s*[\-+]?\s*(?:\d+\s*)?years?/);
    const requiredYears = match ? parseInt(match[1], 10) : null;
    if (requiredYears === null) {
        // No explicit requirement stated → neutral 10 pts (benefit of the doubt)
        return 10;
    }
    if (candidateYears == null) {
        // Requirement exists but we don't know candidate years → partial 8 pts
        return 8;
    }
    if (candidateYears >= requiredYears)
        return 20; // Meets or exceeds
    if (candidateYears >= requiredYears * 0.75)
        return 14; // Within 25% of requirement
    if (candidateYears >= requiredYears * 0.5)
        return 8; // Within 50% of requirement
    return 3; // Significantly below
}
// ── 4. Location Match (max 15 pts) ────────────────────────────────────────────
function locationMatchScore(candidateCountry, jobCountry) {
    if (!jobCountry || !candidateCountry)
        return 0;
    return candidateCountry.trim().toLowerCase() === jobCountry.trim().toLowerCase() ? 15 : 0;
}
// ── Main scoring function ─────────────────────────────────────────────────────
function computeMatchScore(candidate, job) {
    const jobProfession = (job.professions || '');
    const jobText = ((job.professions || '') + ' ' + (job.comments || '')).toLowerCase();
    const candidatePos = (candidate.position || '');
    const candidateSkills = (candidate.skills || '');
    const candidateCtry = (candidate.country_of_interest || '');
    const jobCtry = (job.country || '');
    const title = titleMatchScore(jobProfession, candidatePos);
    const skills = skillsMatchScore(candidateSkills, jobText);
    const exp = experienceMatchScore(candidate.experience_years, job.comments || '');
    const location = locationMatchScore(candidateCtry, jobCtry);
    return Math.min(title + skills + exp + location, 100);
}
// ─── GET /recommendations/pool-count/:jobId ───────────────────────────────────
// Loose count of candidates matching a job's profession — used for locked state.
// Never returns less than 15.
router.get('/pool-count/:jobId', async (req, res) => {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { jobId } = req.params;
        const { data: job } = await db
            .from('employer_leads')
            .select('professions, country')
            .eq('id', jobId)
            .single();
        if (!job)
            return res.json({ count: 15 });
        // Use specialty (discriminating) words only — avoids counting all engineers for a specific discipline
        let keywords = specialtyWords(job.professions || '').slice(0, 2);
        if (keywords.length === 0) {
            keywords = normalizeTitle(job.professions || '').filter((w) => !GENERIC_TITLE_WORDS.has(w)).slice(0, 2);
        }
        if (keywords.length === 0) {
            keywords = normalizeTitle(job.professions || '').slice(0, 2);
        }
        if (keywords.length === 0)
            return res.json({ count: 15 });
        const orParts = keywords.flatMap((kw) => [
            `position.ilike.%${kw}%`,
            `skills.ilike.%${kw}%`,
        ]);
        const { count } = await db
            .from('candidates')
            .select('id', { count: 'exact', head: true })
            .or(orParts.join(','));
        return res.json({ count: Math.max(count || 0, 15) });
    }
    catch (err) {
        console.error('Error getting pool count:', err);
        res.status(500).json({ error: 'Failed to get pool count' });
    }
});
// ─── GET /recommendations/job/:jobId/candidates ───────────────────────────────
// Admin: search candidates matching a job for the "Find Candidates" panel.
router.get('/job/:jobId/candidates', async (req, res) => {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { jobId } = req.params;
        const { search } = req.query;
        const { data: job, error: jobErr } = await db
            .from('employer_leads')
            .select('id, professions, country, comments')
            .eq('id', jobId)
            .single();
        if (jobErr || !job)
            return res.status(404).json({ error: 'Job not found' });
        // Use specialty words for primary filter — avoids pulling in wrong discipline
        let keywords = specialtyWords(job.professions || '').slice(0, 3);
        if (keywords.length === 0) {
            keywords = normalizeTitle(job.professions || '')
                .filter((w) => !GENERIC_TITLE_WORDS.has(w)).slice(0, 3);
        }
        if (keywords.length === 0) {
            keywords = normalizeTitle(job.professions || '').slice(0, 3);
        }
        let query = db
            .from('candidates')
            .select('id, name, position, skills, experience_years, country_of_interest, profile_photo_url, candidate_code, professional_summary')
            .order('created_at', { ascending: false })
            .limit(150);
        if (search) {
            query = query.or(`position.ilike.%${search}%,skills.ilike.%${search}%,name.ilike.%${search}%`);
        }
        else if (keywords.length > 0) {
            // Match specialty words in position OR skills
            const orParts = keywords.flatMap((kw) => [
                `position.ilike.%${kw}%`,
                `skills.ilike.%${kw}%`,
            ]);
            query = query.or(orParts.join(','));
        }
        const { data: candidates, error } = await query;
        if (error)
            throw error;
        // Mark already-recommended candidates
        const { data: existing } = await db
            .from('job_candidate_recommendations')
            .select('candidate_id')
            .eq('job_id', jobId);
        const alreadyRecommended = new Set((existing || []).map((r) => r.candidate_id));
        const scored = (candidates || [])
            .map((c) => ({
            ...c,
            match_score: computeMatchScore(c, job),
            already_recommended: alreadyRecommended.has(c.id),
        }))
            .sort((a, b) => b.match_score - a.match_score);
        return res.json({ candidates: scored, job });
    }
    catch (err) {
        console.error('Error fetching candidate pool:', err);
        res.status(500).json({ error: 'Failed to fetch candidates' });
    }
});
// ─── POST /recommendations/job/:jobId/recommend ───────────────────────────────
// Admin: push selected candidates as recommendations for a specific job.
router.post('/job/:jobId/recommend', async (req, res) => {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { jobId } = req.params;
        const { candidates } = req.body;
        if (!Array.isArray(candidates) || candidates.length === 0) {
            return res.status(400).json({ error: 'No candidates provided' });
        }
        // Verify job exists
        const { data: job, error: jobErr } = await db
            .from('employer_leads')
            .select('id')
            .eq('id', jobId)
            .single();
        if (jobErr || !job)
            return res.status(404).json({ error: 'Job not found' });
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
        if (error)
            throw error;
        return res.json({ recommended: data?.length || 0, recommendations: data });
    }
    catch (err) {
        console.error('Error saving recommendations:', err);
        res.status(500).json({ error: 'Failed to save recommendations' });
    }
});
// ─── GET /recommendations/job/:jobId ─────────────────────────────────────────
// Get all recommendations for a job (with candidate details).
// Used by both admin and employer portal.
router.get('/job/:jobId', async (req, res) => {
    try {
        const db = (0, database_1.supabaseAdminClient)();
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
        if (error)
            throw error;
        return res.json({ recommendations: data || [] });
    }
    catch (err) {
        console.error('Error fetching recommendations:', err);
        res.status(500).json({ error: 'Failed to fetch recommendations' });
    }
});
// ─── PATCH /recommendations/:recId/score ─────────────────────────────────────
// Admin: edit the match score for a recommendation.
router.patch('/:recId/score', async (req, res) => {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { recId } = req.params;
        const { match_score } = req.body;
        if (typeof match_score !== 'number' || match_score < 0 || match_score > 100) {
            return res.status(400).json({ error: 'match_score must be an integer 0–100' });
        }
        const { data, error } = await db
            .from('job_candidate_recommendations')
            .update({ match_score: Math.round(match_score) })
            .eq('id', recId)
            .select()
            .single();
        if (error)
            throw error;
        return res.json({ recommendation: data });
    }
    catch (err) {
        console.error('Error updating score:', err);
        res.status(500).json({ error: 'Failed to update score' });
    }
});
// ─── PATCH /recommendations/:recId/employer-status ───────────────────────────
// Employer: update their review status for a recommended candidate.
router.patch('/:recId/employer-status', async (req, res) => {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { recId } = req.params;
        const { employer_status } = req.body;
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
        if (error)
            throw error;
        return res.json({ recommendation: data });
    }
    catch (err) {
        console.error('Error updating employer status:', err);
        res.status(500).json({ error: 'Failed to update status' });
    }
});
// ─── DELETE /recommendations/:recId ──────────────────────────────────────────
// Admin: remove a recommendation.
router.delete('/:recId', async (req, res) => {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { recId } = req.params;
        const { error } = await db
            .from('job_candidate_recommendations')
            .delete()
            .eq('id', recId);
        if (error)
            throw error;
        return res.json({ success: true });
    }
    catch (err) {
        console.error('Error deleting recommendation:', err);
        res.status(500).json({ error: 'Failed to delete recommendation' });
    }
});
exports.default = router;
