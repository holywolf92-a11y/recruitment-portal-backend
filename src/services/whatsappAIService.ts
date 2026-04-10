import { createLogger } from '../utils/errorHandling';
import { supabaseAdminClient } from '../config/database';
import { normalizePhoneE164 } from './candidateService';

const logger = createLogger('WhatsAppAIService');

export type AIUserRole = 'candidate' | 'employer' | 'partner' | null;

// ─── Person context resolved from DB ─────────────────────────────────────────

export interface PersonContext {
  role: AIUserRole;
  name: string | null;
  // Candidate fields
  status?: string | null;
  position?: string | null;
  nationality?: string | null;
  countryOfInterest?: string | null;
  experienceYears?: number | null;
  cvReceived?: boolean | null;
  passportReceived?: boolean | null;
  skills?: string | null;
  education?: string | null;
  previousEmployment?: string | null;
  candidateCode?: string | null;
  // Employer fields
  companyName?: string | null;
  professions?: string | null;
  quantity?: string | null;
  country?: string | null;
  city?: string | null;
  leadStatus?: string | null;
  // Partner fields
  partnerType?: string | null;
  partnerStatus?: string | null;
  cityCountry?: string | null;
  district?: string | null;
}

/**
 * Resolve a person's full record from Supabase by phone number.
 * Priority: users table (role) → candidates → employer_leads → partner_applications
 */
export async function resolvePersonContext(phone: string): Promise<PersonContext> {
  const db = supabaseAdminClient();

  // Normalise to E.164 and also get digit-only variant for fuzzy matching
  const e164 = normalizePhoneE164(phone) || phone;
  const digits = phone.replace(/\D/g, '');

  // ── 1. Check users table to determine role ─────────────────────────────────
  let appUserRole: string | null = null;
  let appUserName: string | null = null;
  try {
    const { data } = await db
      .from('users')
      .select('role, name, phone')
      .or(`phone.eq.${e164},phone.eq.+${digits},phone.eq.${digits}`)
      .limit(1)
      .maybeSingle();
    if (data) {
      appUserRole = data.role;
      appUserName = data.name;
    }
  } catch { /* non-fatal */ }

  // ── 2. Candidate ────────────────────────────────────────────────────────────
  if (!appUserRole || appUserRole === 'candidate') {
    try {
      const { data } = await db
        .from('candidates')
        .select(
          'name, status, position, nationality, country_of_interest, experience_years, ' +
          'cv_received, passport_received, cnic_received, visa_received, ' +
          'skills, education, previous_employment, candidate_code, source',
        )
        .or(`phone.eq.${e164},phone.ilike.%${digits}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        return {
          role: 'candidate',
          name: appUserName || (data as any).name || null,
          status: (data as any).status,
          position: (data as any).position,
          nationality: (data as any).nationality,
          countryOfInterest: (data as any).country_of_interest,
          experienceYears: (data as any).experience_years,
          cvReceived: (data as any).cv_received,
          passportReceived: (data as any).passport_received,
          skills: (data as any).skills,
          education: (data as any).education,
          previousEmployment: (data as any).previous_employment,
          candidateCode: (data as any).candidate_code,
        };
      }
    } catch { /* non-fatal */ }
  }

  // ── 3. Employer ─────────────────────────────────────────────────────────────
  if (!appUserRole || appUserRole === 'employer') {
    try {
      const { data } = await db
        .from('employer_leads')
        .select('contact_name, company_name, professions, quantity, country, city, status')
        .or(`phone_number.eq.${e164},phone_number.ilike.%${digits}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        return {
          role: 'employer',
          name: appUserName || (data as any).contact_name || null,
          companyName: (data as any).company_name,
          professions: (data as any).professions,
          quantity: (data as any).quantity,
          country: (data as any).country,
          city: (data as any).city,
          leadStatus: (data as any).status,
        };
      }
    } catch { /* non-fatal */ }
  }

  // ── 4. Partner ──────────────────────────────────────────────────────────────
  if (!appUserRole || appUserRole === 'partner') {
    try {
      const { data } = await db
        .from('partner_applications')
        .select('applicant_name, company_name, city_country, district, partner_type, status')
        .or(`phone_number.eq.${e164},phone_number.ilike.%${digits}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        return {
          role: 'partner',
          name: appUserName || (data as any).applicant_name || null,
          companyName: (data as any).company_name,
          cityCountry: (data as any).city_country,
          district: (data as any).district,
          partnerType: (data as any).partner_type,
          partnerStatus: (data as any).status,
        };
      }
    } catch { /* non-fatal */ }
  }

  // ── 5. Unknown ──────────────────────────────────────────────────────────────
  return { role: null, name: appUserName || null };
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(ctx: PersonContext, botFlow?: string | null): string {
  const firstName = ctx.name ? ctx.name.split(' ')[0] : null;
  const nameRef = firstName ? `Their name is ${ctx.name}.` : '';

  // ── Candidate prompt ────────────────────────────────────────────────────────
  if (ctx.role === 'candidate') {
    const profile: string[] = [];
    if (ctx.candidateCode)      profile.push(`Ref #: ${ctx.candidateCode}`);
    if (ctx.status)             profile.push(`Application status: ${ctx.status}`);
    if (ctx.position)           profile.push(`Desired position: ${ctx.position}`);
    if (ctx.nationality)        profile.push(`Nationality: ${ctx.nationality}`);
    if (ctx.countryOfInterest)  profile.push(`Preferred destination: ${ctx.countryOfInterest}`);
    if (ctx.experienceYears != null) profile.push(`Experience: ${ctx.experienceYears} year(s)`);
    if (ctx.cvReceived != null) profile.push(`CV received: ${ctx.cvReceived ? 'Yes' : 'No — they still need to submit it'}`);
    if (ctx.passportReceived != null) profile.push(`Passport received: ${ctx.passportReceived ? 'Yes' : 'No'}`);
    if (ctx.skills)             profile.push(`Skills: ${ctx.skills}`);

    return `You are a professional recruitment assistant at Falisha Enterprises, Pakistan's #1 overseas recruitment company.
${nameRef}
You are speaking with a JOB SEEKER. Use their profile data below to give personalised, accurate answers.

CANDIDATE PROFILE:
${profile.length ? profile.map(l => `• ${l}`).join('\n') : '• Profile not yet fully complete.'}

Your responsibilities:
- Answer questions about their application status, next steps, and required documents
- If their CV is not received, encourage them to send it
- If the status is "Applied", tell them a consultant will review within 48 hours
- If the status is "Shortlisted", congratulate them and say a team member will contact them
- Guide them to apply online at falishajobs.up.railway.app/apply/candidate if not registered
- Keep replies warm, encouraging, and concise (2-3 sentences max for WhatsApp)

Rules:
- Never charge money — this service is free for job seekers
- Don't guarantee a placement or invent statuses not shown above
- If they ask something outside this data, say "our team will check and update you shortly"`;
  }

  // ── Employer prompt ─────────────────────────────────────────────────────────
  if (ctx.role === 'employer') {
    const profile: string[] = [];
    if (ctx.companyName)  profile.push(`Company: ${ctx.companyName}`);
    if (ctx.leadStatus)   profile.push(`Lead status: ${ctx.leadStatus}`);
    if (ctx.professions)  profile.push(`Professions requested: ${ctx.professions}`);
    if (ctx.quantity)     profile.push(`Quantity needed: ${ctx.quantity}`);
    if (ctx.country)      profile.push(`Country: ${ctx.country}`);
    if (ctx.city)         profile.push(`City: ${ctx.city}`);

    return `You are a senior recruitment consultant at Falisha Enterprises, Pakistan's #1 overseas recruitment company.
${nameRef}
You are speaking with an EMPLOYER. Use their account data below to give personalised answers.

EMPLOYER ACCOUNT:
${profile.length ? profile.map(l => `• ${l}`).join('\n') : '• Account not yet fully set up.'}

Your responsibilities:
- Reference their specific hiring requirement when relevant (professions, quantity, country)
- Explain the recruitment process: sourcing → screening → interviews → visa → deployment
- If their lead status is "new", confirm their requirement is received and the team will follow up
- Guide them to the Employer Dashboard at falishajobs.up.railway.app/employer/dashboard
- Keep replies professional, confident, and concise (2-4 sentences max for WhatsApp)

Rules:
- Never quote exact prices — say "our team will provide a formal quotation"
- Don't invent statuses or timelines beyond what's in the profile above
- Escalate complex legal or compliance questions to the human team`;
  }

  // ── Partner prompt ──────────────────────────────────────────────────────────
  if (ctx.role === 'partner') {
    const profile: string[] = [];
    if (ctx.companyName)    profile.push(`Agency/Company: ${ctx.companyName}`);
    if (ctx.cityCountry)    profile.push(`Location: ${ctx.cityCountry}`);
    if (ctx.district)       profile.push(`District: ${ctx.district}`);
    if (ctx.partnerType)    profile.push(`Partner type: ${ctx.partnerType}`);
    if (ctx.partnerStatus)  profile.push(`Application status: ${ctx.partnerStatus}`);

    return `You are a partnership manager at Falisha Enterprises, Pakistan's #1 overseas recruitment company.
${nameRef}
You are speaking with a PARTNER AGENT. Use their account data below to give personalised answers.

PARTNER ACCOUNT:
${profile.length ? profile.map(l => `• ${l}`).join('\n') : '• Account not yet fully set up.'}

Your responsibilities:
- Reference their location and agency when relevant
- If their status is "pending", encourage them and explain the approval process
- If "approved", guide them to submit candidates via their Partner Dashboard
- Explain how to earn commissions: refer candidate → placement confirmed → payout processed
- Link them to falishajobs.up.railway.app/partner/dashboard for full details
- Keep replies friendly, motivating, and concise (2-4 sentences max for WhatsApp)

Rules:
- Never share data about other partners
- Don't promise specific commission amounts — refer to their dashboard
- Escalate payout disputes to the human team`;
  }

  // ── Unknown / first contact ─────────────────────────────────────────────────
  return `You are a professional recruitment assistant at Falisha Enterprises, Pakistan's #1 overseas recruitment company.
You are speaking with a new contact. We don't have their profile on record yet.

Your responsibilities:
- Welcome them warmly and ask if they are a Job Seeker, an Employer, or a Recruitment Partner
- Direct them to the right application page based on their answer:
  • Job Seeker: falishajobs.up.railway.app/apply/candidate
  • Employer: falishajobs.up.railway.app/apply/employer
  • Partner Agent: falishajobs.up.railway.app/apply/partner
- Keep the reply brief and friendly (2-3 sentences max for WhatsApp)`;
}

export interface WhatsAppConversationContext {
  from: string;
  text: string;
  personCtx?: PersonContext;
  botFlow?: string | null;
  messageHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  // legacy fields kept for callers that have not yet migrated
  role?: AIUserRole;
  userName?: string | null;
}

/**
 * Generate an AI-powered reply to WhatsApp messages using OpenAI
 */
export async function generateWhatsAppReply(context: WhatsAppConversationContext): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not configured, returning default response');
    return 'Thank you for your message. Our team will get back to you shortly.';
  }

  try {
    // Prefer richer personCtx; fall back to legacy role/userName
    const personCtx: PersonContext = context.personCtx ?? {
      role: context.role ?? null,
      name: context.userName ?? null,
    };

    const systemPrompt = buildSystemPrompt(personCtx, context.botFlow);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(context.messageHistory || []).map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: context.text }
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.WHATSAPP_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages,
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('OpenAI API request failed', { 
        status: response.status, 
        error: errorText.substring(0, 200) 
      });
      return 'Thank you for your message. Our team will respond to you shortly.';
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      logger.warn('OpenAI returned empty response');
      return 'Thank you for contacting Falisha Manpower. A team member will assist you soon.';
    }

    logger.info('Generated AI reply', { 
      from: context.from, 
      messageLength: context.text.length,
      replyLength: reply.length 
    });

    return reply;

  } catch (error) {
    logger.error('Error generating AI reply', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      from: context.from 
    });
    return 'Thank you for your message. Our recruitment team will get back to you shortly.';
  }
}

/**
 * Determine if a message should get an automated AI reply
 */
export function shouldReplyWithAI(messageData: { type?: string; text?: string; mediaId?: string }): boolean {
  // Don't auto-reply to media messages (CVs, documents) - they're job applications
  if (messageData.mediaId) {
    return false;
  }

  // Only reply to text messages
  if (messageData.type !== 'text' || !messageData.text) {
    return false;
  }

  // Don't reply to very short messages (likely errors or typos)
  if (messageData.text.trim().length < 3) {
    return false;
  }

  return true;
}
