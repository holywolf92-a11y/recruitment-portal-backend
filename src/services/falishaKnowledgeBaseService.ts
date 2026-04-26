import { SOCIAL_LINKS } from '../config/socialLinks';

export type KnowledgeAudience = 'all' | 'candidate' | 'employer' | 'partner';

export type KnowledgeIntent =
  | 'greeting'
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

export type KnowledgeSupportLevel = 'grounded' | 'partial' | 'unsupported';

export interface KnowledgeSupportAssessment {
  supportLevel: KnowledgeSupportLevel;
  articles: KnowledgeArticle[];
  matchedIntentArticles: KnowledgeArticle[];
  reason: string;
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
      id: 'welcome_menu',
      title: 'Welcome and menu guidance',
      audience: ['all'],
      intents: ['greeting', 'application_links'],
      tags: ['welcome', 'hello', 'aoa', 'menu', 'start', 'help', 'new user'],
      facts: [
        'New contacts should be guided to choose whether they are a Job Seeker, Employer, or Recruitment Partner.',
        'Job seeker application link: https://falishajobs.up.railway.app/apply/candidate',
        'Employer application link: https://falishajobs.up.railway.app/apply/employer',
        'Partner application link: https://falishajobs.up.railway.app/apply/partner',
        'Users can also ask for jobs, portal links, or social media links.',
      ],
      sourceIds: ['public_urls', 'whatsapp_ai'],
    },
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
      tags: ['social', 'linkedin', 'facebook', 'instagram', 'tiktok', 'x', 'twitter', 'youtube', 'channel'],
      facts: [
        `LinkedIn: ${SOCIAL_LINKS.linkedin}`,
        `Facebook: ${SOCIAL_LINKS.facebook}`,
        `Instagram: ${SOCIAL_LINKS.instagram}`,
        `TikTok: ${SOCIAL_LINKS.tiktok}`,
        `X: ${SOCIAL_LINKS.x}`,
        `YouTube: ${SOCIAL_LINKS.youtube}`,
        `WhatsApp Channel: ${SOCIAL_LINKS.whatsappChannel}`,
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
      id: 'job_inquiry_guidance',
      title: 'General job inquiry guidance',
      audience: ['all'],
      intents: ['job_listings'],
      tags: ['job', 'jobs', 'vacancy', 'vacancies', 'ad', 'advert', 'work permit', 'dubai', 'turkey'],
      facts: [
        'Current job openings are published on https://falishajobs.up.railway.app/jobs.',
        'Job seekers should apply through https://falishajobs.up.railway.app/apply/candidate.',
        'If a user asks about a generic ad or work-permit opportunity without a specific job code, guide them to the jobs page and candidate application link.',
      ],
      sourceIds: ['public_urls', 'whatsapp_bot_jobs', 'whatsapp_ai'],
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
      audience: ['all'],
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
      id: 'partner_application_status',
      title: 'Partner application status guidance',
      audience: ['partner'],
      intents: ['application_status'],
      tags: ['partner', 'status', 'approval', 'dashboard', 'application'],
      facts: [
        'Partner application status must be confirmed from the partner account record when available.',
        'If a partner is approved, they should be guided to the partner dashboard for candidate submission.',
        'If a partner status cannot be verified from the current phone number, ask for company name and registered email.',
      ],
      sourceIds: ['whatsapp_ai'],
    },
    {
      id: 'pricing_policy',
      title: 'Pricing and quotation policy',
      audience: ['all'],
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
      const audienceEligible = article.audience.includes('all') || article.audience.includes(role);
      if (!audienceEligible) {
        return { article, score: 0 };
      }

      let score = 0;
      let hasDirectSignal = false;

      if (intentId && article.intents.includes(intentId as KnowledgeIntent)) {
        score += 4;
        hasDirectSignal = true;
      }

      for (const tag of article.tags) {
        if (queryTokens.has(tag.toLowerCase())) {
          score += 2;
          hasDirectSignal = true;
        }
      }

      for (const fact of article.facts) {
        const factTokens = tokenize(fact);
        const overlap = factTokens.filter((token) => queryTokens.has(token)).length;
        score += Math.min(3, overlap * 0.5);
        if (overlap > 0) {
          hasDirectSignal = true;
        }
      }

      if (hasDirectSignal) {
        score += 1;
      }

      if (!hasDirectSignal) {
        score = 0;
      }

      return { article, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.article);

  return scored;
}

export function assessFalishaKnowledgeSupport(params: {
  query: string;
  role?: KnowledgeAudience | null;
  intentId?: string | null;
  limit?: number;
}): KnowledgeSupportAssessment {
  const articles = retrieveFalishaKnowledge(params);
  const intentId = String(params.intentId || '').trim();
  const supportedIntentIds = new Set<KnowledgeIntent>([
    'greeting',
    'social_links',
    'job_listings',
    'portal_access',
    'application_status',
    'document_help',
    'recruitment_process',
    'partner_commission',
    'pricing_quote',
    'office_contact',
    'application_links',
  ]);

  if (!supportedIntentIds.has(intentId as KnowledgeIntent)) {
    return {
      supportLevel: 'unsupported',
      articles: [],
      matchedIntentArticles: [],
      reason: 'This intent is not grounded by the curated Falisha knowledge base.',
    };
  }

  const matchedIntentArticles = intentId
    ? articles.filter((article) => article.intents.includes(intentId as KnowledgeIntent))
    : [];

  if (matchedIntentArticles.length > 0) {
    return {
      supportLevel: 'grounded',
      articles,
      matchedIntentArticles,
      reason: 'Verified knowledge articles matched the current intent.',
    };
  }

  if (articles.length > 0) {
    return {
      supportLevel: 'partial',
      articles,
      matchedIntentArticles,
      reason: 'Some related knowledge was found, but not enough to fully ground this intent.',
    };
  }

  return {
    supportLevel: 'unsupported',
    articles: [],
    matchedIntentArticles: [],
    reason: 'No verified knowledge article matched this request.',
  };
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