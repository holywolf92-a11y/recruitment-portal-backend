import { Router, Request, Response } from 'express';
import { supabaseAdminClient } from '../config/database';

const router = Router();

/**
 * GET /employer-leads
 * Admin endpoint: list employer leads with optional search, status filter, pagination.
 * Pass ?dedupe=true to collapse multiple rows per email into one company (for Employer Management view).
 * Default: dedupe=false — returns all individual requirement rows (for Job Orders view).
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();

    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const dedupe = req.query.dedupe === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    let query = db
      .from('employer_leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(
        `company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,country.ilike.%${search}%,professions.ilike.%${search}%`
      );
    }

    if (status) {
      query = query.eq('status', status);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    if (!dedupe) {
      // Return all individual rows as job requirements/orders
      return res.json({
        leads: data || [],
        total: count ?? (data?.length || 0),
      });
    }

    // Deduplicate by email (keep latest per company contact)
    const seen = new Set<string>();
    const dedupedLeads: typeof data = [];
    const requirementCounts: Record<string, number> = {};

    if (data) {
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

    return res.json({
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
 * POST /employer-leads
 * Admin: create a new job requirement / employer lead.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();

    const {
      company_name,
      contact_name,
      email,
      phone_number,
      country,
      city,
      professions,
      quantity,
      salary_range,
      duty_hours,
      contract_duration,
      benefits_included,
      comments,
      status,
    } = req.body;

    if (!company_name || !String(company_name).trim()) {
      return res.status(400).json({ error: 'Company name is required' });
    }
    if (!professions || !String(professions).trim()) {
      return res.status(400).json({ error: 'Professions / position is required' });
    }

    const { data, error } = await db
      .from('employer_leads')
      .insert({
        company_name: String(company_name).trim(),
        contact_name: contact_name ? String(contact_name).trim() : null,
        email: email ? String(email).trim().toLowerCase() : null,
        phone_number: phone_number ? String(phone_number).trim() : null,
        country: country ? String(country).trim() : null,
        city: city ? String(city).trim() : null,
        professions: String(professions).trim(),
        quantity: quantity ? String(quantity).trim() : null,
        salary_range: salary_range ? String(salary_range).trim() : null,
        duty_hours: duty_hours ? String(duty_hours).trim() : null,
        contract_duration: contract_duration ? String(contract_duration).trim() : null,
        benefits_included: benefits_included ? String(benefits_included).trim() : null,
        comments: comments ? String(comments).trim() : null,
        status: status ? String(status).trim() : 'New',
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ lead: data });
  } catch (error: any) {
    console.error('Error creating employer lead:', error);
    return res.status(500).json({ error: error.message || 'Failed to create job order' });
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

/**
 * PUT /employer-leads/:id
 * Admin: update status and/or notes on a requirement.
 * The employer portal reads status via GET /auth/portal-requirements, so this update
 * is immediately visible to the employer when they next load their dashboard.
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const { id } = req.params;

    const ALLOWED_STATUSES = ['New', 'Active', 'Contacted', 'In Progress', 'Fulfilled', 'Closed'];

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    if (req.body.status !== undefined) {
      if (!ALLOWED_STATUSES.includes(req.body.status)) {
        return res.status(400).json({ error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(', ')}` });
      }
      updates.status = req.body.status;
    }
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.company_name !== undefined) updates.company_name = req.body.company_name;
    if (req.body.contact_name !== undefined) updates.contact_name = req.body.contact_name;
    if (req.body.professions !== undefined) updates.professions = req.body.professions;
    if (req.body.quantity !== undefined) updates.quantity = req.body.quantity;
    if (req.body.country !== undefined) updates.country = req.body.country;
    if (req.body.salary_range !== undefined) updates.salary_range = req.body.salary_range;

    const { data, error } = await db
      .from('employer_leads')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Not found' });
      throw error;
    }

    return res.json({ lead: data });
  } catch (error: any) {
    console.error('Error updating employer lead:', error);
    return res.status(500).json({ error: 'Failed to update job order' });
  }
});

export default router;
