// Public Talent-Pool API for the falishamanpower.com recruiter search.
// Serves ANONYMIZED candidate cards only (no candidate PII) — see talentService.
//
// Mounted at /api/talent. CORS is already '*' on the app, so the website can
// call these directly. Optional light guard: if TALENT_API_KEY is set, requests
// must send it as X-Talent-Key (or ?key=) — otherwise the endpoints are open
// (safe, since the data is anonymized and all contact routes back to Falisha).

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandling';
import { getProfessions, getCandidates, getStats } from '../services/talentService';

const router = Router();

function optionalKeyGuard(req: Request, res: Response, next: () => void) {
  const required = process.env.TALENT_API_KEY;
  if (!required) return next(); // open by default
  const provided = (req.headers['x-talent-key'] as string) || (req.query.key as string);
  if (provided !== required) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.use(optionalKeyGuard);

// GET /api/talent/professions
// → { total, categories:[ {category, total, professions:[{profession,count}]} ] }
// Use this to build the browse sidebar and the "366 Drivers available" counts.
router.get('/professions', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getProfessions());
}));

// GET /api/talent/stats  → headline numbers for a dashboard/landing block.
router.get('/stats', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getStats());
}));

// GET /api/talent/candidates
//   ?profession=Driver & category=... & nationality=Pakistan & country=Saudi Arabia
//   & min_experience=2 & q=welding & page=1 & limit=20
// → { total, page, limit, contact:{Falisha...}, candidates:[ anonymized cards ] }
router.get('/candidates', asyncHandler(async (req: Request, res: Response) => {
  const n = (v: unknown) => {
    const x = parseInt(String(v ?? ''), 10);
    return Number.isFinite(x) ? x : undefined;
  };
  res.json(
    await getCandidates({
      profession: (req.query.profession as string) || undefined,
      category: (req.query.category as string) || undefined,
      nationality: (req.query.nationality as string) || undefined,
      country: (req.query.country as string) || undefined,
      minExperience: n(req.query.min_experience),
      q: (req.query.q as string) || undefined,
      page: n(req.query.page),
      limit: n(req.query.limit),
    })
  );
}));

export default router;
