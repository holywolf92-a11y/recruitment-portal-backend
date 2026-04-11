import { Router, Request, Response } from 'express';
import { supabaseAdminClient } from '../config/database';

const router = Router();

/**
 * GET /employer-leads
 * Admin endpoint: list all employer leads (unique companies) with optional search, status filter, pagination.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();

    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    let query = db
      .from('employer_leads')
      .select('*', { count: 'exact' })
      .order('company_name', { ascending: true })
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(
        `company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,country.ilike.%${search}%`
      );
    }

    if (status) {
      query = query.eq('status', status);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    // Deduplicate by email (keep latest per company contact)
    const seen = new Set<string>();
    const dedupedLeads: typeof data = [];
    const requirementCounts: Record<string, number> = {};

    if (data) {
      // Count requirements per email key
      for (const lead of data) {
        const key = (lead.email || lead.company_name || lead.id).toLowerCase();
        requirementCounts[key] = (requirementCounts[key] || 0) + 1;
      }

      for (const lead of data) {
        const key = (lead.email || lead.company_name || lead.id).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          dedupedLeads.push({ ...lead, requirements_count: requirementCounts[key] });
        }
      }
    }

    res.json({
      leads: dedupedLeads,
      total: dedupedLeads.length,
      raw_total: count,
    });
  } catch (error: any) {
    console.error('Error listing employer leads:', error);
    res.status(500).json({ error: 'Failed to fetch employer leads' });
  }
});

/**
 * GET /employer-leads/:id
 * Get a single employer lead with all their requirements.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const { id } = req.params;

    const { data: lead, error } = await db
      .from('employer_leads')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Not found' });
      throw error;
    }

    // Fetch all requirements for the same contact (by email or company_name)
    let requirements: any[] = [];
    if (lead.email) {
      const { data: reqs } = await db
        .from('employer_leads')
        .select('*')
        .ilike('email', lead.email)
        .order('created_at', { ascending: false });
      requirements = reqs || [];
    }

    res.json({ lead, requirements });
  } catch (error: any) {
    console.error('Error fetching employer lead:', error);
    res.status(500).json({ error: 'Failed to fetch employer lead' });
  }
});

export default router;
