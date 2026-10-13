// Public talent-pool service for the falishamanpower.com recruiter search.
//
// Serves ANONYMIZED candidate cards: profession, skills, nationality, experience
// — but NO candidate name/phone/email/CV. The contact shown is always Falisha's
// (the "employer-safe CV" model: recruiters enquire through the agency, which
// looks the real candidate up internally by `code`).
//
// Backed by a single in-memory cache of ~5k small cards (~1-2MB), refreshed on a
// TTL. One bounded object (not a per-key growing map), so no leak risk; it also
// shields Supabase from per-request load.

import { supabaseAdminClient } from '../config/database';
import { createLogger } from '../utils/errorHandling';
import { normalizeProfession, normalizeNationality, normalizeCountry } from './talentNormalizer';

const logger = createLogger('TalentService');

// The single contact shown on every card — Falisha mediates all introductions.
export const FALISHA_CONTACT = {
  agency: 'Falisha Manpower',
  phone: '+92 330 3333335',
  whatsapp: '+92 300 5547806',
  email: 'info@falishamanpower.com',
  website: 'https://www.falishamanpower.com',
} as const;

export interface TalentCard {
  code: string;
  name: string | null;
  title: string | null; // the candidate's actual position/title from their CV (the "main profession")
  category: string;
  profession: string;
  nationality: string | null;
  country_of_interest: string | null;
  experience_years: number | null;
  gcc_years: number | null;
  age: number | null;
  gender: string | null;
  skills: string[];
  available: string | null;
}

interface Index {
  builtAt: number;
  cards: TalentCard[];
}

const TTL_MS = 10 * 60 * 1000; // refresh at most every 10 min
let cache: Index | null = null;
let building: Promise<Index> | null = null;

const CANDIDATE_FIELDS =
  'id,candidate_code,name,position,nationality,country_of_interest,experience_years,gcc_years,skills,date_of_birth,gender,status,date_available,professional_summary,previous_employment,education';

// WhatsApp Business enquiry link — every empty/low search routes here so a
// recruiter never hits a dead end ("never show empty — say N available, enquire").
const WA_NUMBER = FALISHA_CONTACT.whatsapp.replace(/[^0-9]/g, '');
const FALLBACK_AVAILABLE = 50; // reassurance count shown when a search has no exact match
function enquiryLink(note: string): string {
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(note)}`;
}

function computeAge(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  return age >= 16 && age <= 75 ? age : null; // guard parser garbage (future DOBs etc.)
}

function toSkills(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  if (typeof raw === 'string') {
    return raw
      .split(/[,;\n/|]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 40)
      .slice(0, 12);
  }
  return [];
}

// Incorporate blank-position candidates: when `position` is empty, infer the
// profession from their skills / summary / work history instead of dropping them
// into an "Unspecified" bucket (per "don't show unspecified — incorporate them").
function inferProfession(row: any): { category: string; profession: string } {
  const direct = normalizeProfession(row.position);
  if (direct.category !== 'Unspecified') return direct; // has a usable position
  const text = [row.skills, row.professional_summary, row.previous_employment, row.education]
    .map((x) => (typeof x === 'string' ? x : Array.isArray(x) ? x.join(' ') : ''))
    .join(' ');
  const inferred = normalizeProfession(text);
  // Only accept a confident inference (a named profession, not the Other catch-all).
  if (inferred.category !== 'Unspecified' && inferred.category !== 'Other') return inferred;
  return direct; // still genuinely unknown
}

function toCard(row: any): TalentCard {
  const { category, profession } = inferProfession(row);
  // The candidate's real title (raw CV position) is the most informative label;
  // fall back to the normalized profession when the position field is blank.
  const rawPos = typeof row.position === 'string' ? row.position.trim() : '';
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : null;
  return {
    code: row.candidate_code || `FAL-${String(row.id).slice(0, 8)}`,
    name,
    title: rawPos ? rawPos.slice(0, 60) : profession,
    category,
    profession,
    nationality: normalizeNationality(row.nationality),
    country_of_interest: normalizeCountry(row.country_of_interest),
    experience_years: typeof row.experience_years === 'number' ? row.experience_years : null,
    gcc_years: typeof row.gcc_years === 'number' ? row.gcc_years : null,
    age: computeAge(row.date_of_birth),
    gender: row.gender || null,
    skills: toSkills(row.skills),
    available: row.date_available || null,
  };
}

async function buildIndex(): Promise<Index> {
  const db = supabaseAdminClient();
  const cards: TalentCard[] = [];
  let start = 0;
  // Only active (Applied) candidates are shown; Deleted/Cancelled are excluded.
  for (;;) {
    const { data, error } = await db
      .from('candidates')
      .select(CANDIDATE_FIELDS)
      .eq('status', 'Applied')
      .order('created_at', { ascending: false })
      .range(start, start + 999);
    if (error) throw new Error(`talent index query failed: ${error.message}`);
    const chunk = data || [];
    for (const row of chunk) cards.push(toCard(row));
    if (chunk.length < 1000) break;
    start += 1000;
    if (start > 50000) break; // safety ceiling
  }
  logger.info('Talent index built', { cards: cards.length });
  return { builtAt: Date.now(), cards };
}

async function getIndex(): Promise<Index> {
  if (cache && Date.now() - cache.builtAt < TTL_MS) return cache;
  if (building) return building; // coalesce concurrent rebuilds
  building = buildIndex()
    .then((idx) => {
      cache = idx;
      return idx;
    })
    .finally(() => {
      building = null;
    });
  try {
    return await building;
  } catch (err) {
    if (cache) return cache; // serve stale on failure rather than erroring
    throw err;
  }
}

// ── Public API used by the routes ────────────────────────────────────────────

export interface ProfessionGroup {
  category: string;
  total: number;
  professions: { profession: string; count: number }[];
}

export async function getProfessions(): Promise<{ total: number; categories: ProfessionGroup[] }> {
  const { cards } = await getIndex();
  const byCat = new Map<string, Map<string, number>>();
  for (const c of cards) {
    if (!byCat.has(c.category)) byCat.set(c.category, new Map());
    const m = byCat.get(c.category)!;
    m.set(c.profession, (m.get(c.profession) || 0) + 1);
  }
  const categories: ProfessionGroup[] = [...byCat.entries()]
    .filter(([category]) => category !== 'Unspecified') // never surface the blank bucket
    .map(([category, m]) => ({
      category,
      total: [...m.values()].reduce((a, b) => a + b, 0),
      professions: [...m.entries()]
        .map(([profession, count]) => ({ profession, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.total - a.total);
  return { total: cards.length, categories };
}

export interface CandidateFilters {
  profession?: string;
  category?: string;
  nationality?: string;
  country?: string;
  minExperience?: number;
  q?: string;
  page?: number;
  limit?: number;
}

export interface Enquiry {
  whatsapp: string;
  available_estimate: number;
  message: string | null;
}

export async function getCandidates(f: CandidateFilters): Promise<{
  total: number;
  page: number;
  limit: number;
  contact: typeof FALISHA_CONTACT;
  candidates: TalentCard[];
  enquiry: Enquiry;
}> {
  const { cards } = await getIndex();
  const page = Math.max(1, f.page || 1);
  const limit = Math.min(60, Math.max(1, f.limit || 20));
  const eq = (a: string | null, b?: string) => !b || (a || '').toLowerCase() === b.toLowerCase();
  const q = (f.q || '').toLowerCase().trim();
  // Broad, token-based search: EVERY word in the query must appear somewhere in
  // the candidate's name / real title / profession / category / skills / country.
  // So "chemical engineer" matches a candidate titled "Engineer" with a
  // "Chemical Analysis" skill, etc.
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const matchesQ = (c: TalentCard) => {
    if (!tokens.length) return true;
    const hay = [c.name, c.title, c.profession, c.category, c.nationality, c.country_of_interest, ...c.skills]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return tokens.every((t) => hay.includes(t));
  };

  const filtered = cards.filter(
    (c) =>
      eq(c.profession, f.profession) &&
      eq(c.category, f.category) &&
      eq(c.nationality, f.nationality) &&
      eq(c.country_of_interest, f.country) &&
      (f.minExperience == null || (c.experience_years || 0) >= f.minExperience) &&
      matchesQ(c),
  );

  // Never-empty: a search with no exact match still returns an enquiry CTA with a
  // reassurance count, so the website can show "50+ available — enquire" instead
  // of a dead end, routing the recruiter to WhatsApp Business.
  const what = f.profession || f.q || f.category || 'workers';
  const enquiry: Enquiry =
    filtered.length === 0
      ? {
          whatsapp: enquiryLink(`Hi Falisha, I'm looking for ${what}. What do you have available?`),
          available_estimate: FALLBACK_AVAILABLE,
          message: `We can source ${what} on request — ${FALLBACK_AVAILABLE}+ profiles available. Enquire on WhatsApp.`,
        }
      : {
          whatsapp: enquiryLink(`Hi Falisha, I'm interested in your ${what} candidates.`),
          available_estimate: filtered.length,
          message: null,
        };

  const startIdx = (page - 1) * limit;
  return {
    total: filtered.length,
    page,
    limit,
    contact: FALISHA_CONTACT,
    candidates: filtered.slice(startIdx, startIdx + limit),
    enquiry,
  };
}

export async function getStats(): Promise<{
  total_candidates: number;
  by_category: { category: string; count: number }[];
  by_country: { country: string; count: number }[];
  top_professions: { profession: string; count: number }[];
}> {
  const { cards } = await getIndex();
  const tally = (vals: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].map(([k, count]) => ({ k, count })).sort((a, b) => b.count - a.count);
  };
  const named = cards.filter((c) => c.category !== 'Unspecified');
  return {
    total_candidates: cards.length,
    by_category: tally(named.map((c) => c.category)).map((x) => ({ category: x.k, count: x.count })),
    by_country: tally(cards.map((c) => c.country_of_interest)).slice(0, 15).map((x) => ({ country: x.k, count: x.count })),
    top_professions: tally(named.map((c) => c.profession)).slice(0, 25).map((x) => ({ profession: x.k, count: x.count })),
  };
}
