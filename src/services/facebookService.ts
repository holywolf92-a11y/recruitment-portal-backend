import { supabaseAdminClient } from '../config/database';

const GRAPH_BASE = 'https://graph.facebook.com/v20.0';

function cfg() {
  const pageId    = process.env.FACEBOOK_PAGE_ID?.trim();
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  return { pageId, pageToken, configured: !!(pageId && pageToken) };
}

export function isFacebookConfigured(): boolean {
  return cfg().configured;
}

// ─── Post a raw text message (+ optional link) to the configured Facebook Page
export async function postToPage(message: string, link?: string): Promise<{ postId: string }> {
  const { pageId, pageToken, configured } = cfg();
  if (!configured) throw new Error('FACEBOOK_PAGE_ID or FACEBOOK_PAGE_ACCESS_TOKEN not set');

  const params = new URLSearchParams();
  params.set('message', message);
  if (link) params.set('link', link);
  params.set('access_token', pageToken!);

  const res = await fetch(`${GRAPH_BASE}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fbErr = (body as any)?.error;
    throw new Error(fbErr?.message ?? `Graph API HTTP ${res.status}`);
  }

  return { postId: (body as any).id };
}

// ─── Format a job_lead row into a Facebook post message
export function formatLeadPost(lead: {
  title: string;
  employer_name: string | null;
  city: string | null;
  country_name: string | null;
  country_code: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  position_category: string;
  description_snippet: string | null;
}): string {
  const parts: string[] = [];

  parts.push(`🔍 Hiring Now: ${lead.title}`);
  parts.push('');

  if (lead.employer_name) parts.push(`🏢 ${lead.employer_name}`);

  const location = [lead.city, lead.country_name].filter(Boolean).join(', ');
  if (location) parts.push(`📍 ${location}`);

  const salary = fmtSalary(lead.salary_min, lead.salary_max, lead.salary_currency);
  if (salary) parts.push(`💰 ${salary}`);

  parts.push('');

  if (lead.description_snippet) {
    const snippet = lead.description_snippet.trim().slice(0, 280);
    parts.push(snippet + (lead.description_snippet.length > 280 ? '…' : ''));
    parts.push('');
  }

  const tag = lead.position_category.toLowerCase().replace(/\s+/g, '');
  parts.push(`#hiring #recruitment #jobs #${tag}`);

  return parts.join('\n');
}

function fmtSalary(min: number | null, max: number | null, ccy: string | null): string {
  if (!min && !max) return '';
  const cur = ccy || '';
  if (min && max && min !== max) return `${cur}${Math.round(min).toLocaleString()}–${Math.round(max).toLocaleString()}`;
  return `${cur}${Math.round(min ?? max ?? 0).toLocaleString()}`;
}

// ─── Fetch a lead from DB, post it, and record the result
export async function postJobLead(leadId: string): Promise<{ postId: string; alreadyPosted: boolean }> {
  const db = supabaseAdminClient();
  const { data: lead, error } = await db
    .from('job_leads')
    .select('id, title, employer_name, city, country_name, country_code, salary_min, salary_max, salary_currency, position_category, description_snippet, source_url, fb_post_id')
    .eq('id', leadId)
    .single();

  if (error || !lead) throw new Error('Job lead not found');

  if ((lead as any).fb_post_id) {
    return { postId: (lead as any).fb_post_id, alreadyPosted: true };
  }

  const message = formatLeadPost(lead as any);
  const { postId } = await postToPage(message, (lead as any).source_url ?? undefined);

  await db
    .from('job_leads')
    .update({ fb_post_id: postId, fb_posted_at: new Date().toISOString() })
    .eq('id', leadId);

  return { postId, alreadyPosted: false };
}
