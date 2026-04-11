export type KnowledgeAudience = 'all' | 'candidate' | 'employer' | 'partner';

export type KnowledgeIntent =
  | 'social_links'
  | 'job_listings'
  | 'portal_access'
  | 'application_status'
  | 'document_help'
  | 'recruitment_process'
  | 'partner_commission'
  | 'pricing_quote'
  | 'office_contact'
  | 'application_links';

export interface KnowledgeSourceRef {
  id: string;
  path: string;
  purpose: string;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  audience: KnowledgeAudience[];
  intents: KnowledgeIntent[];
  tags: string[];
  facts: string[];
  sourceIds: string[];
}

export interface KnowledgeBase {
  version: string;
  sources: KnowledgeSourceRef[];
  articles: KnowledgeArticle[];
}

const KNOWLEDGE_SOURCES: KnowledgeSourceRef[] = [
  {
    id: 'public_urls',
    path: 'src/utils/publicUrl.ts',
    purpose: 'Canonical frontend and backend URLs used across user-facing flows.',
  },
  {
    id: 'public_portal',
    path: 'src/services/publicPortalService.ts',
    purpose: 'Candidate, employer, and partner public intake flows, portal links, and social channel URLs.',
  },
  {
    id: 'onboarding_documents',
    path: 'src/routes/onboarding.ts',
    purpose: 'Canonical onboarding document list and labels for candidate profiles.',
  },
  {
    id: 'email_service',
    path: 'src/services/emailService.ts',
    purpose: 'Canonical outbound contact email identity for Falisha Jobs.',
  },
  {
    id: 'cv_generator',
    path: 'src/services/cvGeneratorService.ts',
    purpose: 'Employer-safe CV footer with public support email and phone number.',
  },
  {
    id: 'whatsapp_bot_jobs',
    path: 'src/services/whatsappBotService.ts',
    purpose: 'WhatsApp bot job browsing copy and jobs URL usage.',
  },
  {
    id: 'whatsapp_ai',
    path: 'src/services/whatsappAIService.ts',
    purpose: 'Role-specific support rules, recruitment process language, partner commission guidance, and escalation policy.',
  },
];

const FALISHA_KNOWLEDGE_BASE: KnowledgeBase = {
  version: '2026-04-11.whatsapp-kb.v1',
  sources: KNOWLEDGE_SOURCES,
  articles: [
    {
      id: 'company_contact',
      title: 'Falisha public contact details',
      audience: ['all'],
      intents: ['office_contact'],
      tags: ['contact', 'email', 'phone', 'support'],
      facts: [
        'Canonical support email: support@falishajobs.com.',
        'Public contact phone used in employer-safe CV footer: +923303333335.',
        'Canonical frontend URL: https://falishajobs.up.railway.app.',
      ],
      sourceIds: ['email_service', 'cv_generator', 'public_urls'],
    },
    {
      id: 'social_channels',
      title: 'Falisha social media channels',
      audience: ['all'],
      intents: ['social_links'],
      tags: ['social', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube', 'channel'],
      facts: [
        'LinkedIn: https://www.linkedin.com/company/falishaenterprises',
        'Facebook: https://www.facebook.com/falishaenterprises.pk/',
        'Instagram: https://www.instagram.com/falisha.manpower',
        'TikTok: https://www.tiktok.com/@falishamanpower',
        'YouTube: https://youtube.com/@falishamanpower897?si=-sKB5_wZdoICyLbj',
        'WhatsApp Channel is optional and controlled by WHATSAPP_BOT_CHANNEL_URL.',
      ],
      sourceIds: ['public_portal'],
    },
    {
      id: 'application_links',
      title: 'Falisha application entry points',
      audience: ['all'],
      intents: ['application_links', 'portal_access', 'job_listings'],
      tags: ['apply', 'candidate', 'employer', 'partner', 'portal', 'register'],
      facts: [
        'Job seeker application link: https://falishajobs.up.railway.app/apply/candidate',
        'Employer application link: https://falishajobs.up.railway.app/apply/employer',
        'Partner application link: https://falishajobs.up.railway.app/apply/partner',
        'Jobs listing page: https://falishajobs.up.railway.app/jobs',
      ],
      sourceIds: ['public_urls', 'public_portal', 'whatsapp_bot_jobs'],
    },
    {
      id: 'portal_dashboards',
      title: 'Portal dashboard links',
      audience: ['candidate', 'employer', 'partner'],
      intents: ['portal_access'],
      tags: ['dashboard', 'login', 'portal', 'password'],
      facts: [
        'Employer dashboard: https://falishajobs.up.railway.app/employer/dashboard',
        'Partner dashboard: https://falishajobs.up.railway.app/partner/dashboard',
        'Candidate self-service profile completion uses onboarding links generated from the candidate tracking token.',
        'If the user cannot log in, the assistant should guide them to the correct portal link first before escalating.',
      ],
      sourceIds: ['public_urls', 'public_portal', 'whatsapp_ai'],
    },
    {
      id: 'candidate_documents',
      title: 'Candidate onboarding documents',
      audience: ['candidate'],
      intents: ['document_help'],
      tags: ['documents', 'passport', 'cnic', 'license', 'certificate', 'medical', 'visa'],
      facts: [
        'Candidate onboarding tracks these documents: Passport, CNIC, Driving License, Police Character Certificate, Certificates, Medical Report, and Visa.',
        'Document uploads are supported through onboarding and WhatsApp-assisted document collection.',
        'The assistant should speak in terms of missing documents rather than guessing approval status.',
      ],
      sourceIds: ['onboarding_documents', 'whatsapp_ai'],
    },
    {
      id: 'recruitment_process',
      title: 'Falisha recruitment process',
      audience: ['candidate', 'employer'],
      intents: ['recruitment_process', 'application_status'],
      tags: ['process', 'screening', 'interview', 'visa', 'deployment', 'hiring'],
      facts: [
        'Recruitment process summary: sourcing -> screening -> interviews -> visa processing -> deployment.',
        'For employers, the assistant may reference requested professions, quantity, country, and city when available from employer_leads.',
        'For candidates, application status guidance must rely on the actual candidate record instead of generic promises.',
      ],
      sourceIds: ['whatsapp_ai'],
    },
    {
      id: 'partner_commission_flow',
      title: 'Partner commission and submission flow',
      audience: ['partner'],
      intents: ['partner_commission', 'portal_access'],
      tags: ['partner', 'commission', 'payout', 'placement', 'dashboard'],
      facts: [
        'Partner guidance: refer candidate -> placement confirmed -> payout processed.',
        'Do not promise exact commission amounts in automated replies.',
        'If approved, partners should be guided to the partner dashboard for submission and payout-related details.',
      ],
      sourceIds: ['whatsapp_ai'],
    },
    {
      id: 'pricing_policy',
      title: 'Pricing and quotation policy',
      audience: ['employer', 'partner'],
      intents: ['pricing_quote'],
      tags: ['price', 'pricing', 'quotation', 'charges', 'commercial'],
      facts: [
        'Automated assistants should not quote exact prices or commercial terms.',
        'Pricing and formal quotations should be handled by the human team.',
      ],
      sourceIds: ['whatsapp_ai'],
    },
  ],
};

function tokenize(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function getFalishaKnowledgeBase(): KnowledgeBase {
  return FALISHA_KNOWLEDGE_BASE;
}

export function retrieveFalishaKnowledge(params: {
  query: string;
  role?: KnowledgeAudience | null;
  intentId?: string | null;
  limit?: number;
}): KnowledgeArticle[] {
  const queryTokens = new Set(tokenize(params.query));
  const role = params.role || 'all';
  const intentId = String(params.intentId || '').trim();
  const limit = params.limit ?? 3;

  const scored = FALISHA_KNOWLEDGE_BASE.articles
    .map((article) => {
      let score = 0;

      if (article.audience.includes('all') || article.audience.includes(role)) {
        score += 2;
      }

      if (intentId && article.intents.includes(intentId as KnowledgeIntent)) {
        score += 4;
      }

      for (const tag of article.tags) {
        if (queryTokens.has(tag.toLowerCase())) {
          score += 2;
        }
      }

      for (const fact of article.facts) {
        const factTokens = tokenize(fact);
        const overlap = factTokens.filter((token) => queryTokens.has(token)).length;
        score += Math.min(3, overlap * 0.5);
      }

      return { article, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.article);

  return scored;
}

export function buildFalishaKnowledgeContext(params: {
  query: string;
  role?: KnowledgeAudience | null;
  intentId?: string | null;
  limit?: number;
}): string {
  const articles = retrieveFalishaKnowledge(params);
  if (articles.length === 0) {
    return '';
  }

  return articles
    .map((article) => {
      const facts = article.facts.map((fact) => `- ${fact}`).join('\n');
      const sources = article.sourceIds.join(', ');
      return `## ${article.title}\n${facts}\nSources: ${sources}`;
    })
    .join('\n\n');
}