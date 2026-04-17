"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WHATSAPP_ESCALATION_MATRIX = exports.WHATSAPP_RESPONSE_MATRIX = exports.WHATSAPP_INTENT_TAXONOMY = void 0;
exports.classifyWhatsAppIntent = classifyWhatsAppIntent;
exports.getIntentMatrixEntry = getIntentMatrixEntry;
exports.resolveIntentAction = resolveIntentAction;
exports.getEscalationMatrixEntry = getEscalationMatrixEntry;
function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}
exports.WHATSAPP_INTENT_TAXONOMY = [
    {
        id: 'greeting',
        label: 'Greeting',
        description: 'Greeting, hello, start, help, menu requests.',
        examples: ['hi', 'hello', 'menu', 'start'],
        patterns: [/^(hi|hey|hello|salam|assalam|aoa|aslam|menu|start|help|home|new user)\b/i, /menu again|send me the menu|i.?m a new user/i, /اسلام علیکم|السلام علیکم/i],
    },
    {
        id: 'social_links',
        label: 'Social Links',
        description: 'Requests for social media profiles, YouTube, Instagram, Facebook, LinkedIn, or WhatsApp channel.',
        examples: ['send me social media links', 'youtube link', 'instagram page'],
        patterns: [
            /social|social media|channel/i,
            /linkedin|facebook|instagram|insta|youtube|tiktok|tik tok/i,
            /(send|share|give|follow).*(social|linkedin|facebook|instagram|insta|youtube|tiktok|tik tok|channel)/i,
        ],
    },
    {
        id: 'job_listings',
        label: 'Jobs',
        description: 'Requests for job openings, vacancies, and open positions.',
        examples: ['show jobs', 'current vacancies', 'open positions'],
        patterns: [/\bjobs?\b|vacancies|openings|positions/i, /work permit|job in|vacancy in/i, /saw this ad|want to know about it/i],
    },
    {
        id: 'portal_access',
        label: 'Portal Access',
        description: 'Requests for portal, dashboard, login, password, sign in, username.',
        examples: ['how to login', 'send dashboard link', 'forgot password'],
        patterns: [/login|log in|signin|sign in|password|username|dashboard|portal|profile link|dashboard link|portal link/i],
    },
    {
        id: 'application_status',
        label: 'Status Check',
        description: 'Requests for candidate application status, employer hiring request status, or partner application status.',
        examples: ['what is my status', 'application update', 'hiring progress'],
        patterns: [/status|update|progress|application status|requirement|hiring|follow up|followup/i],
    },
    {
        id: 'document_help',
        label: 'Documents',
        description: 'Requests about CV, passport, CNIC, visa, resume, and required documents.',
        examples: ['what documents do you need', 'passport required?', 'cv upload'],
        patterns: [/document|documents|cv|resume|passport|cnic|visa(?!\s+stamping)/i],
    },
    {
        id: 'recruitment_process',
        label: 'Recruitment Process',
        description: 'Questions about how hiring works, stages, screening, interviews, visa, deployment.',
        examples: ['how does your process work', 'recruitment steps'],
        patterns: [/process|steps|screening|interview|deployment|recruitment process|timeline|stamping|how long|how many days/i],
    },
    {
        id: 'partner_commission',
        label: 'Partner Commission',
        description: 'Questions from partners about commission and payouts.',
        examples: ['how do i earn commission', 'partner payout'],
        patterns: [/commission|payout|earn|referral income/i],
    },
    {
        id: 'pricing_quote',
        label: 'Pricing Quote',
        description: 'Questions about pricing, quotation, fees, commercial terms.',
        examples: ['what are your charges', 'send quotation'],
        patterns: [/price|pricing|quote|quotation|charges|fee|fees|commercial/i],
    },
    {
        id: 'office_contact',
        label: 'Office Contact',
        description: 'Questions about address, phone, contact details, office location, business hours.',
        examples: ['office address', 'contact number', 'where is your office'],
        patterns: [/office|address|contact details|contact number|phone number|location|hours|timing|timings/i],
    },
    {
        id: 'human_handoff',
        label: 'Human Handoff',
        description: 'Direct request to talk to a human, agent, support, team member.',
        examples: ['talk to human', 'agent please', 'support'],
        patterns: [/human|agent|support|representative|team member/i],
    },
    {
        id: 'application_links',
        label: 'Application Links',
        description: 'Requests for candidate, employer, or partner application links.',
        examples: ['candidate apply link', 'employer form', 'partner registration link'],
        patterns: [/apply|application link|register|registration|form/i],
    },
];
exports.WHATSAPP_RESPONSE_MATRIX = [
    { intentId: 'greeting', defaultAction: 'ai', escalationLevel: 'none', autoSwitchToHuman: false },
    { intentId: 'social_links', defaultAction: 'deterministic', escalationLevel: 'none', autoSwitchToHuman: false },
    { intentId: 'job_listings', defaultAction: 'deterministic', escalationLevel: 'none', autoSwitchToHuman: false },
    { intentId: 'portal_access', defaultAction: 'deterministic', escalationLevel: 'soft', autoSwitchToHuman: false, escalationReason: 'Manual recovery may need the support team if self-service login help does not solve it.' },
    { intentId: 'application_status', defaultAction: 'deterministic', requiresKnownRole: true, requiresProfileContext: true, escalationLevel: 'soft', autoSwitchToHuman: false, escalationReason: 'Escalate only if profile context is missing or the status requires manual investigation.' },
    { intentId: 'document_help', defaultAction: 'deterministic', escalationLevel: 'soft', autoSwitchToHuman: false, escalationReason: 'Escalate document issues only if the user reports a missing or rejected upload that cannot be resolved automatically.' },
    { intentId: 'recruitment_process', defaultAction: 'deterministic', escalationLevel: 'none', autoSwitchToHuman: false },
    { intentId: 'partner_commission', defaultAction: 'deterministic', escalationLevel: 'soft', autoSwitchToHuman: false, escalationReason: 'Escalate payout disputes or commission exceptions to the partnership team.' },
    { intentId: 'pricing_quote', defaultAction: 'escalate', escalationReason: 'Pricing and commercial quotations should be handled by the human team.', escalationLevel: 'required', autoSwitchToHuman: true },
    { intentId: 'office_contact', defaultAction: 'deterministic', escalationLevel: 'none', autoSwitchToHuman: false },
    { intentId: 'human_handoff', defaultAction: 'escalate', escalationReason: 'The user explicitly asked to talk to a human.', escalationLevel: 'required', autoSwitchToHuman: true },
    { intentId: 'application_links', defaultAction: 'deterministic', escalationLevel: 'none', autoSwitchToHuman: false },
    { intentId: 'unknown', defaultAction: 'ai', escalationLevel: 'soft', autoSwitchToHuman: false, escalationReason: 'Unknown intents may need human review if the assistant still cannot resolve the request.' },
];
exports.WHATSAPP_ESCALATION_MATRIX = exports.WHATSAPP_RESPONSE_MATRIX.map((entry) => ({
    intentId: entry.intentId,
    escalationLevel: entry.escalationLevel ?? 'none',
    autoSwitchToHuman: entry.autoSwitchToHuman ?? false,
    reason: entry.escalationReason || 'No escalation required.',
}));
function classifyWhatsAppIntent(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
        return { id: 'unknown', confidence: 0, matchedPatterns: [] };
    }
    let bestMatch = { id: 'unknown', confidence: 0, matchedPatterns: [] };
    for (const definition of exports.WHATSAPP_INTENT_TAXONOMY) {
        const matchedPatterns = definition.patterns
            .filter((pattern) => pattern.test(normalized))
            .map((pattern) => pattern.source);
        if (matchedPatterns.length === 0) {
            continue;
        }
        const confidence = Math.min(1, 0.35 + matchedPatterns.length * 0.25);
        if (confidence > bestMatch.confidence) {
            bestMatch = {
                id: definition.id,
                confidence,
                matchedPatterns,
            };
        }
    }
    return bestMatch;
}
function getIntentMatrixEntry(intentId) {
    return exports.WHATSAPP_RESPONSE_MATRIX.find((entry) => entry.intentId === intentId) || {
        intentId: 'unknown',
        defaultAction: 'ai',
    };
}
function resolveIntentAction(intentId, role) {
    const entry = getIntentMatrixEntry(intentId);
    if (role && entry.roleActions?.[role]) {
        return entry.roleActions[role];
    }
    return entry.defaultAction;
}
function getEscalationMatrixEntry(intentId) {
    return exports.WHATSAPP_ESCALATION_MATRIX.find((entry) => entry.intentId === intentId) || {
        intentId: 'unknown',
        escalationLevel: 'none',
        autoSwitchToHuman: false,
        reason: 'No escalation required.',
    };
}
