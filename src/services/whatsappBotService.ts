/**
 * WhatsApp Bot Engine — Falisha Manpower
 *
 * Flows:
 *   A. candidate_intake  — Looking for a Job
 *   B. employer_intake   — Start Recruiting
 *   C. partner_onboarding — Become a Partner
 *   D. jobs              — See All Jobs
 *   E. social            — Follow / Join Channels
 *
 * The entry point handleBotMessage() returns true when it handled the message
 * (so the caller skips the generic AI reply).
 *
 * State is persisted in whatsapp_conversations.bot_flow / bot_step / bot_data.
 */

import { supabaseAdminClient } from '../config/database';
import { createLogger } from '../utils/errorHandling';
import { createCandidate, normalizePhoneE164, updateCandidate } from './candidateService';
import { whatsappSocialLinksQueue } from '../config/queue';
import { DocumentLinkService } from './documentLinkService';
import { getBotState, setBotState, patchBotData, resetBotState, BotState } from './whatsappBotStateService';
import { sendText, sendButtons, sendList, WaButton, WaListSection } from './whatsappInteractiveService';
import { recordOutboundMessage } from './whatsappInboxService';
import { resolveFrontendUrl } from '../utils/publicUrl';
import { upsertAppUserProfile } from './userService';
import crypto from 'crypto';

const logger = createLogger('WhatsAppBot');
const MAIN_MENU_DEBOUNCE_MS = 45_000;

// ─── Config (set in Railway env) ─────────────────────────────────────────────
const JOBS_URL        = process.env.WHATSAPP_BOT_JOBS_URL        || 'https://falishajobs.up.railway.app/jobs';
const LINKEDIN_URL    = process.env.WHATSAPP_BOT_LINKEDIN_URL    || 'https://www.linkedin.com/company/falishaenterprises';
const FACEBOOK_URL    = process.env.WHATSAPP_BOT_FACEBOOK_URL    || 'https://www.facebook.com/falishaenterprises.pk/';
const INSTAGRAM_URL   = process.env.WHATSAPP_BOT_INSTAGRAM_URL   || 'https://www.instagram.com/falisha.manpower';
const TIKTOK_URL      = process.env.WHATSAPP_BOT_TIKTOK_URL      || 'https://www.tiktok.com/@falishamanpower';
const YOUTUBE_URL     = process.env.WHATSAPP_BOT_YOUTUBE_URL     || 'https://youtube.com/@falishamanpower897?si=-sKB5_wZdoICyLbj';
const WA_CHANNEL_URL  = process.env.WHATSAPP_BOT_CHANNEL_URL     || '';
const BOT_ACTOR_ID = 'whatsapp-bot';
const FRONTEND_URL = resolveFrontendUrl(process.env.FRONTEND_URL);
const CANDIDATE_REQUIRED_FIELDS = [
  { key: 'name', label: 'Full Name' },
  { key: 'profession', label: 'Profession' },
  { key: 'contact_number', label: 'Contact Number' },
  { key: 'email', label: 'Email' },
  { key: 'preferred_country', label: 'Preferred Country' },
] as const;

// ─── Incoming message shape ──────────────────────────────────────────────────

export interface BotIncoming {
  type: 'text' | 'interactive' | 'media' | 'other';
  text: string;          // lowercase trimmed text body (empty for non-text)
  rawText: string;       // original text
  interactiveId: string; // button_reply.id or list_reply.id (empty if not interactive)
  interactiveTitle: string;
  hasMedia: boolean;
  mediaType: string;     // document | image | video | audio
  mediaId: string;
  mimeType: string;
  fileName: string;
  inboxMessageId: string | null;
  conversationId: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isGreeting(text: string): boolean {
  return /^(hi|hey|hello|salam|assalam|salaam|start|menu|main menu|home|helo|help|hola|marhaba|مرحبا|السلام)/.test(text);
}

function isMainMenuRequest(text: string, id: string): boolean {
  return id === 'main_menu' || text === 'menu' || text === 'main menu' || text === 'return to main menu' || text === 'home';
}

function isTalkHumanRequest(text: string, id: string): boolean {
  return id === 'talk_human' || text === 'human' || text === 'agent' || text === 'talk to human' || text === 'support';
}

function isSocialLinksRequest(text: string, id: string): boolean {
  if (id === 'menu_social') {
    return true;
  }

  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    /social|social media|channel/.test(normalized) ||
    /linkedin|facebook|instagram|insta|tiktok|tik tok|youtube/.test(normalized) ||
    (/link|links/.test(normalized) && /follow|send|share|give/.test(normalized))
  );
}

async function tx(phoneNumberId: string, accessToken: string, to: string, convId: string | null, body: string): Promise<void> {
  await sendText(phoneNumberId, accessToken, to, body);
  if (convId) {
    await recordOutboundMessage({
      conversationId: convId,
      direction: 'outbound',
      fromNumberId: phoneNumberId,
      toPhoneNumber: to,
      body,
      status: 'sent',
      raw: { kind: 'bot_message' },
    }).catch(() => { /* non-fatal */ });
  }
}

async function ix(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  convId: string | null,
  bodyText: string,
  buttons: WaButton[],
  header?: string,
): Promise<void> {
  await sendButtons(phoneNumberId, accessToken, to, bodyText, buttons, header);
  if (convId) {
    await recordOutboundMessage({
      conversationId: convId,
      direction: 'outbound',
      fromNumberId: phoneNumberId,
      toPhoneNumber: to,
      body: `[buttons] ${bodyText}`,
      status: 'sent',
      raw: { kind: 'bot_interactive', buttons },
    }).catch(() => { /* non-fatal */ });
  }
}

async function lx(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  convId: string | null,
  bodyText: string,
  label: string,
  sections: WaListSection[],
  header?: string,
): Promise<void> {
  await sendList(phoneNumberId, accessToken, to, bodyText, label, sections, header);
  if (convId) {
    await recordOutboundMessage({
      conversationId: convId,
      direction: 'outbound',
      fromNumberId: phoneNumberId,
      toPhoneNumber: to,
      body: `[list] ${bodyText}`,
      status: 'sent',
      raw: { kind: 'bot_interactive', label },
    }).catch(() => { /* non-fatal */ });
  }
}

/** Navigation buttons appended to many steps. */
const NAV_BUTTONS: WaButton[] = [
  { id: 'main_menu',  title: 'Main Menu' },
  { id: 'talk_human', title: 'Talk to Human' },
];

const MAIN_MENU_BUTTONS: WaButton[] = [
  { id: 'menu_candidate', title: 'Job Seeker' },
  { id: 'menu_employer', title: 'Employer' },
  { id: 'menu_partner', title: 'Become Partner' },
];

function isSkipValue(text: string, id: string): boolean {
  return id === 'skip' || text === 'skip' || text === 'no' || text === 'none' || text === 'n/a';
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeFreeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeStructuredInputLine(value: string): string {
  return value
    .trim()
    .replace(/^\d+[\)\.\-\s]*/, '')
    .replace(/^(full name|name|profession|contact number|contact|phone number|phone|email|preferred country|country)\s*:\s*/i, '')
    .trim();
}

function generateTrackingToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const prefix = chars[Math.floor(Math.random() * chars.length)] + chars[Math.floor(Math.random() * chars.length)];
  const numbers = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}${numbers}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pickStructuredFieldValue(raw: string, labels: string[]): string | null {
  const labelPattern = labels.map((label) => escapeRegExp(label)).join('|');
  const fieldPattern = new RegExp(
    `(?:^|[\\n\\r]|\\b)(?:${labelPattern})\\s*:\\s*(.+?)(?=(?:[\\n\\r]|\\b(?:full name|name|profession|contact number|contact|phone number|phone|email|preferred country|country)\\s*:|$))`,
    'is',
  );
  const match = raw.match(fieldPattern);
  return match?.[1] ? normalizeFreeText(match[1]) : null;
}

function parseNumberedSegments(raw: string): string[] {
  const matches = Array.from(raw.matchAll(/(?:^|\s)([1-5])[\)\.\-:]\s*(.+?)(?=(?:\s+[1-5][\)\.\-:]\s*)|$)/gs));
  if (matches.length < 5) {
    return [];
  }

  return matches
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => normalizeFreeText(match[2] || ''))
    .filter(Boolean);
}

function parseDelimitedSegments(raw: string): string[] {
  return raw
    .split(/\r?\n|\||;/)
    .map((segment) => normalizeStructuredInputLine(segment))
    .filter(Boolean);
}

function parseCommaSeparatedSegments(raw: string): string[] {
  const segments = raw
    .split(/\s*,\s*/)
    .map((segment) => normalizeStructuredInputLine(segment))
    .filter(Boolean);

  return segments.length >= 5 ? segments : [];
}

function parseCandidateBasicDetails(
  raw: string,
  existingData: Record<string, any> = {},
): { data: Record<string, string | null>; missingLabels: string[]; invalidEmail: boolean } {
  const normalizedRaw = raw.trim();
  const baseData: Record<string, string | null> = {
    name: existingData.name ?? null,
    profession: existingData.profession ?? null,
    contact_number: existingData.contact_number ?? null,
    email: existingData.email ?? null,
    preferred_country: existingData.preferred_country ?? null,
    nationality: existingData.nationality ?? null,
  };
  const labeledValues = {
    name: pickStructuredFieldValue(normalizedRaw, ['full name', 'name']),
    profession: pickStructuredFieldValue(normalizedRaw, ['profession']),
    contact_number: pickStructuredFieldValue(normalizedRaw, ['contact number', 'contact', 'phone number', 'phone']),
    email: pickStructuredFieldValue(normalizedRaw, ['email']),
    preferred_country: pickStructuredFieldValue(normalizedRaw, ['preferred country', 'country']),
  };

  const hasLabeledFormat = Object.values(labeledValues).some(Boolean);

  if (hasLabeledFormat) {
    for (const [key, value] of Object.entries(labeledValues)) {
      if (value) {
        baseData[key] = value;
      }
    }
  } else {
    const numberedSegments = parseNumberedSegments(normalizedRaw);
    const delimitedSegments = parseDelimitedSegments(normalizedRaw);
    const commaSeparatedSegments = parseCommaSeparatedSegments(normalizedRaw);
    const segments = numberedSegments.length >= 5
      ? numberedSegments
      : delimitedSegments.length >= 5
        ? delimitedSegments
        : commaSeparatedSegments;

    if (segments.length > 0) {
      const targetKeys = segments.length >= CANDIDATE_REQUIRED_FIELDS.length
        ? CANDIDATE_REQUIRED_FIELDS.map((field) => field.key)
        : CANDIDATE_REQUIRED_FIELDS
            .map((field) => field.key)
            .filter((fieldKey) => !baseData[fieldKey]);

      segments.forEach((segment, index) => {
        const targetKey = targetKeys[index];
        if (targetKey) {
          baseData[targetKey] = segment;
        }
      });
    }
  }

  let invalidEmail = false;
  if (baseData.email && !looksLikeEmail(baseData.email)) {
    invalidEmail = true;
    baseData.email = null;
  }

  const missingLabels = CANDIDATE_REQUIRED_FIELDS
    .filter((field) => !baseData[field.key])
    .map((field) => field.label);

  return {
    data: {
      ...baseData,
      email: baseData.email ? baseData.email.toLowerCase() : null,
    },
    missingLabels,
    invalidEmail,
  };
}

function buildMissingCandidateFieldsMessage(missingLabels: string[], invalidEmail: boolean): string {
  const lines = ['Please complete the missing job seeker details:'];

  for (const label of missingLabels) {
    lines.push(`- ${label}`);
  }

  if (invalidEmail) {
    lines.push('- Email must be a valid address');
  }

  lines.push('');
  lines.push('Reply with only the missing items, or resend all 5 details in one message.');
  return lines.join('\n');
}

function generateTemporaryPassword(): string {
  return `Falisha!${crypto.randomBytes(4).toString('hex')}`;
}

async function promptStep(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  convId: string | null,
  body: string,
  buttons: WaButton[],
  expectedIds: string[],
  header?: string,
): Promise<void> {
  await ix(phoneNumberId, accessToken, to, convId, body, buttons, header);
  await setExpectedInteractive(to, expectedIds);
}

function buildSocialLinksMessage(): string {
  return [
    '🌐 *Stay connected with Falisha Manpower:*',
    '',
    `💼 LinkedIn: ${LINKEDIN_URL}`,
    `📘 Facebook: ${FACEBOOK_URL}`,
    `📸 Instagram: ${INSTAGRAM_URL}`,
    `🎵 TikTok: ${TIKTOK_URL}`,
    `▶️ YouTube: ${YOUTUBE_URL}`,
    ...(WA_CHANNEL_URL ? [`WhatsApp Channel: ${WA_CHANNEL_URL}`] : []),
    '',
    '_Follow us for job updates, success stories, and more!_',
  ].join('\n');
}

async function sendPortalEntryLink(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  convId: string | null,
  audience: 'candidate' | 'employer' | 'partner',
): Promise<void> {
  const labels: Record<typeof audience, { title: string; intro: string }> = {
    candidate: {
      title: 'Job Seeker Portal',
      intro: 'Use this link to complete your Falisha candidate intake and get your profile link right away:',
    },
    employer: {
      title: 'Employer Portal',
      intro: 'Use this link to open your Falisha employer intake and receive dashboard access with login credentials:',
    },
    partner: {
      title: 'Partner Portal',
      intro: 'Use this link to register as a Falisha partner and receive your portal credentials:',
    },
  };

  const details = labels[audience];
  const portalUrl = `${FRONTEND_URL}/apply/${audience}`;

  await tx(
    phoneNumberId,
    accessToken,
    to,
    convId,
    [details.title, '', details.intro, portalUrl, '', 'You can type menu anytime to return here.'].join('\n'),
  );
  // Social links: candidates get them after form submission, partners after 15 min delay, employers never.
  if (audience === 'partner') {
    try {
      await whatsappSocialLinksQueue.add(
        'send-social-links',
        { phone: to, message: buildSocialLinksMessage(), recipientRole: 'partner' },
        { delay: 15 * 60 * 1000, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } },
      );
    } catch { /* non-critical */ }
  }
  await promptStep(
    phoneNumberId,
    accessToken,
    to,
    convId,
    'Choose another option or return to the main menu.',
    [
      { id: 'main_menu', title: 'Main Menu' },
      { id: 'talk_human', title: 'Talk to Human' },
    ],
    ['main_menu', 'talk_human'],
    'Falisha',
  );
  await resetBotState(to);
}

async function ensureCandidateOnboardingLink(candidateId: string): Promise<string | null> {
  const db = supabaseAdminClient();
  const { data: candidate, error } = await db
    .from('candidates')
    .select('id, email_tracking_token')
    .eq('id', candidateId)
    .maybeSingle();

  if (error || !candidate) {
    return null;
  }

  let trackingToken = String((candidate as any).email_tracking_token || '').trim().toUpperCase();
  if (!trackingToken) {
    trackingToken = generateTrackingToken();
    const { error: updateError } = await db
      .from('candidates')
      .update({ email_tracking_token: trackingToken })
      .eq('id', candidateId);

    if (updateError) {
      logger.warn('Failed to assign onboarding token to WhatsApp candidate', {
        candidateId,
        error: updateError.message,
      });
      return null;
    }
  }

  return `${FRONTEND_URL}/onboarding?token=${trackingToken}`;
}

async function saveCandidateProgress(state: BotState, data: Record<string, any>): Promise<string | null> {
  const candidateId = await upsertWhatsAppCandidate(state, data);
  if (candidateId) {
    await patchBotData(state.phoneNumber, { ...data, candidate_id: candidateId });
  }
  return candidateId;
}

// ─── Main Menu ────────────────────────────────────────────────────────────────

async function showMainMenu(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  convId: string | null,
  state: BotState,
  options?: { force?: boolean },
): Promise<void> {
  const force = !!options?.force;
  const lastMainMenuAtRaw = state.data?.last_main_menu_at as string | undefined;
  if (!force && lastMainMenuAtRaw) {
    const lastMs = Date.parse(lastMainMenuAtRaw);
    if (Number.isFinite(lastMs) && Date.now() - lastMs < MAIN_MENU_DEBOUNCE_MS) {
      return;
    }
  }

  const body = [
    'Welcome to Falisha Enterprises 🌍',
    '',
    'Please choose from the menu below:',
    '',
    'You can type *menu* anytime to return here.',
  ].join('\n');

  await ix(phoneNumberId, accessToken, to, convId, body, MAIN_MENU_BUTTONS, 'Falisha');
  await patchBotData(to, {
    last_main_menu_at: new Date().toISOString(),
    expected_interactive_ids: MAIN_MENU_BUTTONS.map((button) => button.id),
  });
}

async function setExpectedInteractive(phoneNumber: string, ids: string[]): Promise<void> {
  await patchBotData(phoneNumber, { expected_interactive_ids: ids });
}

function getExpectedInteractiveIds(state: BotState): string[] {
  return Array.isArray(state.data?.expected_interactive_ids)
    ? state.data.expected_interactive_ids.filter((x: any) => typeof x === 'string')
    : [];
}

async function repromptActiveFlow(
  state: BotState,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const { phoneNumber, conversationId: convId } = state;
  if (!state.step) {
    await showMainMenu(phoneNumberId, accessToken, phoneNumber, convId, state, { force: true });
    return;
  }

  switch (state.flow) {
    case 'candidate_intake':
      await promptCandidateStep(state, phoneNumberId, accessToken);
      return;
    case 'employer_intake':
      await promptEmployerStep(state, phoneNumberId, accessToken);
      return;
    case 'partner_onboarding':
      await promptPartnerStep(state, phoneNumberId, accessToken);
      return;
    default:
      await showMainMenu(phoneNumberId, accessToken, phoneNumber, convId, state, { force: true });
  }
}

// ─── Talk to Human ────────────────────────────────────────────────────────────

async function switchToHuman(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  convId: string | null,
  phoneNumber: string,
): Promise<void> {
  await resetBotState(phoneNumber);

  // Switch conversation to human mode
  if (convId) {
    const db = supabaseAdminClient();
    try {
      await db
        .from('whatsapp_conversations')
        .update({ reply_mode: 'human', bot_flow: null, bot_step: null, bot_data: {} })
        .eq('id', convId);
    } catch { /* non-fatal */ }
  }

  await tx(
    phoneNumberId, accessToken, to, convId,
    'Dear Valued Customer,\n\nFor any information or assistance, please feel free to contact us:\n\n📞 0300-5547806\n📞 0300-5787762\n📞 051-4927145-6\n📧 Support@falishajobs.com\n\n📍 Office No. 10, 11 & 12, 1st Floor, Umer Farooq Plaza, Murree Road, Chandni Chowk, Rawalpindi, Pakistan\nNear Mezan Bank\nLocation link\nhttps://maps.app.goo.gl/bA7XTJzFKaRb9BgB8?g_st=ig\n\nWe are always here to assist you.\n\nBest regards,\nFalisha Jobs Team',
  );
}

// ─── Flow A: Candidate Intake ─────────────────────────────────────────────────

async function promptCandidateStep(state: BotState, phoneNumberId: string, accessToken: string): Promise<void> {
  const { phoneNumber, conversationId: convId, step } = state;

  switch (step) {
    case 'basic_details':
      await promptStep(
        phoneNumberId,
        accessToken,
        phoneNumber,
        convId,
        [
          'Step 1/2 - Please send these 5 details in one message:',
          '',
          '1. Full Name',
          '2. Profession',
          '3. Contact Number',
          '4. Email',
          '5. Preferred Country',
          '',
          'Example:',
          'Ali Khan',
          'Electrician',
          '+92 300 1234567',
          'ali@example.com',
          'Saudi Arabia',
        ].join('\n'),
        [{ id: 'main_menu', title: 'Main Menu' }],
        ['main_menu'],
        'Job Seeker',
      );
      return;
    case 'cv_upload':
      await promptStep(
        phoneNumberId,
        accessToken,
        phoneNumber,
        convId,
        'Step 2/2 - Upload your CV as a WhatsApp document now, or tap Submit to finish without CV.',
        [
          { id: 'submit_candidate', title: 'Submit' },
          { id: 'main_menu', title: 'Main Menu' },
          { id: 'talk_human', title: 'Talk to Human' },
        ],
        ['submit_candidate', 'main_menu', 'talk_human'],
        'Job Seeker',
      );
      return;
  }
}

async function upsertWhatsAppCandidate(state: BotState, data: Record<string, any>): Promise<string | null> {
  const db = supabaseAdminClient();
  const normalizedPhone = normalizePhoneE164(data.contact_number || state.phoneNumber) || data.contact_number || state.phoneNumber;
  const email = data.email ? normalizeFreeText(String(data.email)).toLowerCase() : null;

  let candidateId: string | null = null;

  const { data: conversation } = await db
    .from('whatsapp_conversations')
    .select('candidate_id')
    .eq('phone_number', state.phoneNumber)
    .maybeSingle();

  if ((conversation as any)?.candidate_id) {
    candidateId = (conversation as any).candidate_id;
  }

  if (!candidateId && normalizedPhone) {
    const { data: existingByPhone } = await db
      .from('candidates')
      .select('id')
      .eq('phone', normalizedPhone)
      .maybeSingle();
    candidateId = (existingByPhone as any)?.id ?? null;
  }

  if (!candidateId && email) {
    const { data: existingByEmail } = await db
      .from('candidates')
      .select('id')
      .ilike('email', email)
      .limit(1)
      .maybeSingle();
    candidateId = (existingByEmail as any)?.id ?? null;
  }

  const candidatePayload = {
    name: data.name,
    position: data.profession,
    phone: normalizedPhone,
    email: email || undefined,
    nationality: data.nationality || undefined,
    country_of_interest: data.preferred_country || undefined,
    source: 'WhatsApp',
    cv_received: Boolean(data.cv_uploaded),
    auto_extracted: false,
    needs_review: true,
  };

  if (candidateId) {
    await updateCandidate(candidateId, candidatePayload, BOT_ACTOR_ID);
  } else {
    const created = await createCandidate(candidatePayload, BOT_ACTOR_ID);
    candidateId = created?.id ?? null;
  }

  if (candidateId) {
    await db
      .from('whatsapp_conversations')
      .update({ candidate_id: candidateId, display_name: data.name || null })
      .eq('phone_number', state.phoneNumber);

    const documentLinkService = new DocumentLinkService();
    await documentLinkService.reconcileDocumentsForCandidate(candidateId).catch(() => undefined);
  }

  return candidateId;
}

async function findExistingAuthUserByEmail(email?: string | null) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const supabase = supabaseAdminClient();
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    throw error;
  }

  return data.users.find((user) => String(user.email || '').trim().toLowerCase() === normalizedEmail) || null;
}

async function ensurePartnerPortalAccount(data: Record<string, any>, partnerApplicationId?: string | null) {
  const email = String(data.email || '').trim().toLowerCase();
  if (!email) {
    return { created: false, userId: null, password: null, dashboardUrl: `${FRONTEND_URL}/partner/dashboard` };
  }

  const supabase = supabaseAdminClient();
  const existingAuthUser = await findExistingAuthUserByEmail(email);
  const password = existingAuthUser ? null : generateTemporaryPassword();

  const authUser = existingAuthUser || (await (async () => {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password: password!,
      email_confirm: true,
      user_metadata: {
        name: data.name || null,
        phone: data.contact || null,
        role: 'partner',
      },
    });
    if (error) {
      throw error;
    }
    return created.user;
  })());

  await upsertAppUserProfile({
    id: authUser.id,
    email: authUser.email || email,
    role: 'partner',
    name: data.name || null,
    phone: data.contact || null,
    status: 'Active',
  });

  if (partnerApplicationId) {
    const { error: linkError } = await supabase
      .from('partner_applications')
      .update({ user_id: authUser.id, updated_at: new Date().toISOString() })
      .eq('id', partnerApplicationId)
      .is('user_id', null);

    if (linkError) {
      logger.warn('Failed to link partner application to auth user (non-fatal)', {
        partnerApplicationId,
        userId: authUser.id,
        error: linkError.message,
      });
    }
  }

  return {
    created: !existingAuthUser,
    userId: authUser.id,
    password,
    dashboardUrl: `${FRONTEND_URL}/partner/dashboard`,
  };
}

async function saveFormSubmission(args: {
  phoneNumber: string;
  conversationId: string | null;
  flowType: string;
  entityType: string;
  entityId?: string | null;
  submissionData: Record<string, any>;
}): Promise<void> {
  const db = supabaseAdminClient();
  await db.from('whatsapp_form_submissions').insert({
    phone_number: args.phoneNumber,
    conversation_id: args.conversationId,
    flow_type: args.flowType,
    entity_type: args.entityType,
    entity_id: args.entityId ?? null,
    submission_data: args.submissionData,
    status: 'submitted',
  });
}

async function finalizeCandidateFlow(
  state: BotState,
  phoneNumberId: string,
  accessToken: string,
  data: Record<string, any>,
): Promise<void> {
  const candidateId = await upsertWhatsAppCandidate(state, data);
  const onboardingLink = candidateId ? await ensureCandidateOnboardingLink(candidateId) : null;
  await saveFormSubmission({
    phoneNumber: state.phoneNumber,
    conversationId: state.conversationId,
    flowType: 'job_seeker',
    entityType: 'candidate',
    entityId: candidateId,
    submissionData: data,
  }).catch((err) => logger.warn('Failed to store WhatsApp candidate submission (non-fatal)', { error: err?.message }));

  await tx(
    phoneNumberId,
    accessToken,
    state.phoneNumber,
    state.conversationId,
    [
      'Thank you! Your job seeker profile has been submitted.',
      '',
      `Name: ${data.name}`,
      `Profession: ${data.profession}`,
      `Contact: ${data.contact_number}`,
      `Email: ${data.email || 'Not provided'}`,
      `Preferred Country: ${data.preferred_country}`,
      `CV Uploaded: ${data.cv_uploaded ? 'Yes' : 'No'}`,
    ].join('\n'),
  );
  if (onboardingLink) {
    await tx(
      phoneNumberId,
      accessToken,
      state.phoneNumber,
      state.conversationId,
      [
        'Your profile link:',
        onboardingLink,
        '',
        'Open this link to complete or edit your profile.',
      ].join('\n'),
    );
  }
  // Schedule social links 15 minutes after WhatsApp intake submission
  try {
    await whatsappSocialLinksQueue.add(
      'send-social-links',
      { phone: state.phoneNumber, message: buildSocialLinksMessage(), recipientRole: 'candidate' },
      { delay: 15 * 60 * 1000, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } },
    );
  } catch { /* non-critical */ }
  await promptStep(
    phoneNumberId,
    accessToken,
    state.phoneNumber,
    state.conversationId,
    'You are all set.',
    [
      { id: 'main_menu', title: 'Main Menu' },
      { id: 'talk_human', title: 'Talk to Human' },
    ],
    ['main_menu', 'talk_human'],
    'Falisha',
  );
  await resetBotState(state.phoneNumber);
}

async function handleCandidateFlow(
  state: BotState,
  incoming: BotIncoming,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const { phoneNumber, step, data } = state;
  const raw = normalizeFreeText(incoming.rawText || '');

  if (!step) {
    await setBotState(phoneNumber, 'candidate_intake', 'basic_details', {});
    await promptCandidateStep({ ...state, step: 'basic_details', data: {} }, phoneNumberId, accessToken);
    return;
  }

  if (step === 'basic_details') {
    if (!raw) {
      await promptCandidateStep(state, phoneNumberId, accessToken);
      return;
    }
    const parsed = parseCandidateBasicDetails(incoming.rawText || '', data);
    const nextData = { ...data, ...parsed.data };
    await patchBotData(phoneNumber, nextData);

    if (parsed.missingLabels.length > 0 || parsed.invalidEmail) {
      await tx(
        phoneNumberId,
        accessToken,
        phoneNumber,
        state.conversationId,
        buildMissingCandidateFieldsMessage(parsed.missingLabels, parsed.invalidEmail),
      );
      await promptCandidateStep(state, phoneNumberId, accessToken);
      return;
    }

    await saveCandidateProgress(state, nextData);
    await setBotState(phoneNumber, 'candidate_intake', 'cv_upload', nextData);
    await promptCandidateStep({ ...state, step: 'cv_upload', data: nextData }, phoneNumberId, accessToken);
    return;
  }

  if (step === 'cv_upload') {
    if (incoming.interactiveId === 'submit_candidate' || incoming.text === 'submit') {
      const nextData = {
        ...data,
        cv_uploaded: Boolean(data.cv_uploaded),
        cv_inbox_message_id: data.cv_inbox_message_id ?? null,
        cv_file_name: data.cv_file_name ?? null,
      };
      await patchBotData(phoneNumber, nextData);
      await finalizeCandidateFlow(state, phoneNumberId, accessToken, nextData);
      return;
    }
    if (!incoming.hasMedia || incoming.mediaType !== 'document') {
      await tx(phoneNumberId, accessToken, phoneNumber, state.conversationId, 'Please upload your CV as a WhatsApp document, or tap Submit to finish now.');
      await promptCandidateStep(state, phoneNumberId, accessToken);
      return;
    }
    const nextData = {
      ...data,
      cv_uploaded: true,
      cv_inbox_message_id: incoming.inboxMessageId,
      cv_file_name: incoming.fileName || null,
    };
    await patchBotData(phoneNumber, nextData);
    await tx(phoneNumberId, accessToken, phoneNumber, state.conversationId, 'CV received. Submitting your profile now.');
    await finalizeCandidateFlow(state, phoneNumberId, accessToken, nextData);
    return;
  }
}

// ─── Flow B: Employer Intake ──────────────────────────────────────────────────

async function promptEmployerStep(state: BotState, phoneNumberId: string, accessToken: string): Promise<void> {
  const { phoneNumber, conversationId: convId, step } = state;

  switch (step) {
    case 'company_name':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 1/8 - Company Name?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Employer');
      return;
    case 'contact_number':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 2/8 - Contact Number?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Employer');
      return;
    case 'email':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 3/8 - Email Address?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Employer');
      return;
    case 'country':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 4/8 - Country?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Employer');
      return;
    case 'employees_required':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 5/8 - Number of Employees Required?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Employer');
      return;
    case 'job_profession':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 6/8 - Job Profession?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Employer');
      return;
    case 'salary':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 7/8 - Salary?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Employer');
      return;
    case 'duty_hours':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 7/8 - Duty Hours?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Employer');
      return;
    case 'comments':
      await promptStep(
        phoneNumberId,
        accessToken,
        phoneNumber,
        convId,
        'Step 8/8 - Any comments?',
        [
          { id: 'skip', title: 'Skip' },
          { id: 'main_menu', title: 'Main Menu' },
        ],
        ['skip', 'main_menu'],
        'Employer',
      );
      return;
  }
}

async function saveEmployerLead(
  phoneNumber: string,
  conversationId: string | null,
  data: Record<string, any>,
): Promise<string | null> {
  try {
    const db = supabaseAdminClient();
    const { data: inserted } = await db.from('employer_leads').insert({
      phone_number: phoneNumber,
      conversation_id: conversationId,
      company_name: data.company_name ?? null,
      email: data.email ?? null,
      country: data.country ?? null,
      quantity: data.employees_required ?? null,
      professions: data.job_profession ?? null,
      salary_range: data.salary ?? null,
      duty_hours: data.duty_hours ?? null,
      comments: data.comments ?? null,
      payload: data,
      status: 'new',
    }).select('id').single();
    logger.info('Employer lead saved', { phoneNumber });
    return (inserted as any)?.id ?? null;
  } catch (err: any) {
    logger.warn('Failed to save employer lead (non-fatal)', { phoneNumber, error: err?.message });
    return null;
  }
}

async function finalizeEmployerFlow(
  state: BotState,
  phoneNumberId: string,
  accessToken: string,
  data: Record<string, any>,
): Promise<void> {
  const employerLeadId = await saveEmployerLead(state.phoneNumber, state.conversationId, data);
  await saveFormSubmission({
    phoneNumber: state.phoneNumber,
    conversationId: state.conversationId,
    flowType: 'employer',
    entityType: 'employer_lead',
    entityId: employerLeadId,
    submissionData: data,
  }).catch((err) => logger.warn('Failed to store WhatsApp employer submission (non-fatal)', { error: err?.message }));

  await tx(
    phoneNumberId,
    accessToken,
    state.phoneNumber,
    state.conversationId,
    [
      'Thank you! Your employer request has been submitted.',
      '',
      `Company: ${data.company_name}`,
      `Contact: ${data.contact_number}`,
      `Email: ${data.email}`,
      `Country: ${data.country}`,
      `Employees Required: ${data.employees_required}`,
      `Profession: ${data.job_profession}`,
      `Salary: ${data.salary}`,
      `Duty Hours: ${data.duty_hours}`,
      `Comments: ${data.comments || 'None'}`,
    ].join('\n'),
  );
  // No social links for employers
  await promptStep(
    phoneNumberId,
    accessToken,
    state.phoneNumber,
    state.conversationId,
    'Our team will contact you shortly.',
    [
      { id: 'main_menu', title: 'Main Menu' },
      { id: 'talk_human', title: 'Talk to Human' },
    ],
    ['main_menu', 'talk_human'],
    'Falisha',
  );
  await resetBotState(state.phoneNumber);
}

async function handleEmployerFlow(
  state: BotState,
  incoming: BotIncoming,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const { phoneNumber, step, data } = state;
  const raw = normalizeFreeText(incoming.rawText || '');

  if (!step) {
    await setBotState(phoneNumber, 'employer_intake', 'company_name', {});
    await promptEmployerStep({ ...state, step: 'company_name', data: {} }, phoneNumberId, accessToken);
    return;
  }

  const nextStepMap: Record<string, { field: string; next: string | null; validator?: (value: string) => boolean }> = {
    company_name: { field: 'company_name', next: 'contact_number' },
    contact_number: { field: 'contact_number', next: 'email' },
    email: { field: 'email', next: 'country', validator: looksLikeEmail },
    country: { field: 'country', next: 'employees_required' },
    employees_required: { field: 'employees_required', next: 'job_profession' },
    job_profession: { field: 'job_profession', next: 'salary' },
    salary: { field: 'salary', next: 'duty_hours' },
    duty_hours: { field: 'duty_hours', next: 'comments' },
  };

  if (step in nextStepMap) {
    const stepConfig = nextStepMap[step];
    if (!raw || (stepConfig.validator && !stepConfig.validator(raw))) {
      await promptEmployerStep(state, phoneNumberId, accessToken);
      return;
    }
    const nextData = { ...data, [stepConfig.field]: raw };
    await patchBotData(phoneNumber, nextData);
    if (stepConfig.next) {
      await setBotState(phoneNumber, 'employer_intake', stepConfig.next, nextData);
      await promptEmployerStep({ ...state, step: stepConfig.next, data: nextData }, phoneNumberId, accessToken);
    }
    return;
  }

  if (step === 'comments') {
    const nextData = { ...data, comments: isSkipValue(incoming.text, incoming.interactiveId) ? null : raw };
    await patchBotData(phoneNumber, nextData);
    await finalizeEmployerFlow(state, phoneNumberId, accessToken, nextData);
  }
}

// ─── Flow C: Partner Onboarding ───────────────────────────────────────────────

async function promptPartnerStep(state: BotState, phoneNumberId: string, accessToken: string): Promise<void> {
  const { phoneNumber, conversationId: convId, step } = state;

  switch (step) {
    case 'name':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 1/6 - Name?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Become a Partner');
      return;
    case 'contact':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 2/6 - Contact Number?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Become a Partner');
      return;
    case 'email':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 3/6 - Email?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Become a Partner');
      return;
    case 'district':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 4/6 - District?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Become a Partner');
      return;
    case 'cnic':
      await promptStep(phoneNumberId, accessToken, phoneNumber, convId, 'Step 5/6 - CNIC?', [{ id: 'main_menu', title: 'Main Menu' }], ['main_menu'], 'Become a Partner');
      return;
    case 'cnic_upload':
      await promptStep(
        phoneNumberId,
        accessToken,
        phoneNumber,
        convId,
        'Step 6/6 - Please upload your CNIC picture now.',
        [
          { id: 'main_menu', title: 'Main Menu' },
          { id: 'talk_human', title: 'Talk to Human' },
        ],
        ['main_menu', 'talk_human'],
        'Become a Partner',
      );
      return;
  }
}

async function savePartnerApplication(
  phoneNumber: string,
  conversationId: string | null,
  data: Record<string, any>,
): Promise<string | null> {
  try {
    const db = supabaseAdminClient();
    const { data: inserted } = await db.from('partner_applications').insert({
      phone_number: phoneNumber,
      conversation_id: conversationId,
      company_name: data.name ?? null,
      applicant_name: data.name ?? null,
      city_country: data.district ?? null,
      district: data.district ?? null,
      partner_type: 'whatsapp_partner',
      email: data.email ?? null,
      cnic: data.cnic ?? null,
      payload: data,
      status: 'pending',
    }).select('id').single();
    logger.info('Partner application saved', { phoneNumber });
    return (inserted as any)?.id ?? null;
  } catch (err: any) {
    logger.warn('Failed to save partner application (non-fatal)', { phoneNumber, error: err?.message });
    return null;
  }
}

async function finalizePartnerFlow(
  state: BotState,
  phoneNumberId: string,
  accessToken: string,
  data: Record<string, any>,
): Promise<void> {
  const partnerApplicationId = await savePartnerApplication(state.phoneNumber, state.conversationId, data);
  const partnerAccount = await ensurePartnerPortalAccount(data, partnerApplicationId);
  await saveFormSubmission({
    phoneNumber: state.phoneNumber,
    conversationId: state.conversationId,
    flowType: 'partner',
    entityType: 'partner_application',
    entityId: partnerApplicationId,
    submissionData: data,
  }).catch((err) => logger.warn('Failed to store WhatsApp partner submission (non-fatal)', { error: err?.message }));

  await tx(
    phoneNumberId,
    accessToken,
    state.phoneNumber,
    state.conversationId,
    [
      'Thank you! Your partner application has been submitted.',
      '',
      `Name: ${data.name}`,
      `Contact: ${data.contact}`,
      `Email: ${data.email}`,
      `District: ${data.district}`,
      `CNIC: ${data.cnic}`,
      `CNIC Upload: ${data.cnic_picture_received ? 'Received' : 'Pending'}`,
      '',
      `Partner Dashboard: ${partnerAccount.dashboardUrl}`,
      ...(partnerAccount.password
        ? [
            `Login Email: ${data.email}`,
            `Temporary Password: ${partnerAccount.password}`,
          ]
        : [
            `Login Email: ${data.email}`,
            'An existing partner account was found, so your previous login remains active.',
          ]),
    ].join('\n'),
  );
  await tx(
    phoneNumberId,
    accessToken,
    state.phoneNumber,
    state.conversationId,
    [
      'Your partner/agent account is ready.',
      `Dashboard: ${partnerAccount.dashboardUrl}`,
      `Email: ${data.email}`,
      ...(partnerAccount.password ? [`Temporary Password: ${partnerAccount.password}`] : ['Use your existing password to log in.']),
      '',
      'After login you can access the partner dashboard and submit candidates.',
    ].join('\n'),
  );
  // Schedule social links 15 minutes after partner submission
  try {
    await whatsappSocialLinksQueue.add(
      'send-social-links',
      { phone: state.phoneNumber, message: buildSocialLinksMessage(), recipientRole: 'partner' },
      { delay: 15 * 60 * 1000, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } },
    );
  } catch { /* non-critical */ }
  await promptStep(
    phoneNumberId,
    accessToken,
    state.phoneNumber,
    state.conversationId,
    'Our admin team will review your application.',
    [
      { id: 'main_menu', title: 'Main Menu' },
      { id: 'talk_human', title: 'Talk to Human' },
    ],
    ['main_menu', 'talk_human'],
    'Falisha',
  );
  await resetBotState(state.phoneNumber);
}

async function handlePartnerFlow(
  state: BotState,
  incoming: BotIncoming,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const { phoneNumber, step, data } = state;
  const raw = normalizeFreeText(incoming.rawText || '');

  if (!step) {
    await setBotState(phoneNumber, 'partner_onboarding', 'name', {});
    await promptPartnerStep({ ...state, step: 'name', data: {} }, phoneNumberId, accessToken);
    return;
  }

  const nextStepMap: Record<string, { field: string; next: string | null; validator?: (value: string) => boolean }> = {
    name: { field: 'name', next: 'contact' },
    contact: { field: 'contact', next: 'email' },
    email: { field: 'email', next: 'district', validator: looksLikeEmail },
    district: { field: 'district', next: 'cnic' },
    cnic: { field: 'cnic', next: 'cnic_upload' },
  };

  if (step in nextStepMap) {
    const stepConfig = nextStepMap[step];
    if (!raw || (stepConfig.validator && !stepConfig.validator(raw))) {
      await promptPartnerStep(state, phoneNumberId, accessToken);
      return;
    }
    const nextData = { ...data, [stepConfig.field]: raw };
    await patchBotData(phoneNumber, nextData);
    if (stepConfig.next) {
      await setBotState(phoneNumber, 'partner_onboarding', stepConfig.next, nextData);
      await promptPartnerStep({ ...state, step: stepConfig.next, data: nextData }, phoneNumberId, accessToken);
    }
    return;
  }

  if (step === 'cnic_upload') {
    if (!incoming.hasMedia) {
      await tx(phoneNumberId, accessToken, phoneNumber, state.conversationId, 'Please upload your CNIC picture to continue.');
      await promptPartnerStep(state, phoneNumberId, accessToken);
      return;
    }
    const nextData = {
      ...data,
      cnic_picture_received: true,
      cnic_upload_message_id: incoming.inboxMessageId,
      cnic_file_name: incoming.fileName || null,
    };
    await patchBotData(phoneNumber, nextData);
    await finalizePartnerFlow(state, phoneNumberId, accessToken, nextData);
  }
}

// ─── Flow D: Jobs ─────────────────────────────────────────────────────────────

async function handleJobsFlow(
  state: BotState,
  incoming: BotIncoming,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const { phoneNumber, conversationId: convId } = state;

  await tx(
    phoneNumberId, accessToken, phoneNumber, convId,
    [
      '💼 *Browse All Open Positions*',
      '',
      'Click the link below to see all current job openings:',
      '',
      JOBS_URL,
      '',
      'To apply directly via WhatsApp, tap *Apply via WhatsApp* below.',
    ].join('\n'),
  );

  await ix(
    phoneNumberId, accessToken, phoneNumber, convId,
    'What would you like to do?',
    [
      { id: 'menu_candidate', title: 'Apply via WhatsApp' },
      { id: 'main_menu',      title: 'Main Menu' },
      { id: 'talk_human',     title: 'Talk to Human' },
    ],
  );

  await setExpectedInteractive(phoneNumber, ['menu_candidate', 'main_menu', 'talk_human']);

  await resetBotState(phoneNumber);
}

// ─── Flow E: Social Channels ──────────────────────────────────────────────────

async function handleSocialFlow(
  state: BotState,
  incoming: BotIncoming,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const { phoneNumber, conversationId: convId } = state;

  const links: string[] = [
    '📣 *Follow Falisha Manpower for daily job updates:*',
    '',
    `💼 LinkedIn:\n${LINKEDIN_URL}`,
    `👍 Facebook:\n${FACEBOOK_URL}`,
    `📸 Instagram:\n${INSTAGRAM_URL}`,
    `🎵 TikTok:\n${TIKTOK_URL}`,
    `▶️ YouTube:\n${YOUTUBE_URL}`,
    ...(WA_CHANNEL_URL  ? [`💬 WhatsApp Channel:\n${WA_CHANNEL_URL}`] : []),
    '',
    'Follow to get the latest jobs every day! ✅',
  ];

  await tx(phoneNumberId, accessToken, phoneNumber, convId, links.join('\n'));
  await ix(
    phoneNumberId, accessToken, phoneNumber, convId,
    'Anything else?',
    [
      { id: 'main_menu',      title: 'Main Menu' },
      { id: 'menu_candidate', title: 'Apply for a Job' },
    ],
  );
  await setExpectedInteractive(phoneNumber, ['main_menu', 'menu_candidate']);
  await resetBotState(phoneNumber);
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Main bot entry point. Called from the WhatsApp webhook handler.
 *
 * Returns true  → bot handled the message; caller must NOT send AI reply.
 * Returns false → bot did not handle; caller may fall through to AI.
 */
export async function handleBotMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  incoming: BotIncoming;
}): Promise<boolean> {
  const { phoneNumberId, accessToken, incoming } = params;
  const phoneNumber = incoming.interactiveId
    ? incoming.interactiveId  // id won't be a phone number — we need from/phone separately
    : '';                     // ← filled in below from state

  // We need to look up state by the conversation's phone_number.
  // The caller should have set incoming with the sender's phone in a dedicated field.
  // For clarity, we expose a separate `from` field below.
  return false; // placeholder → real entry at handleBotMessageFrom
}

/**
 * Actual entry point (handleBotMessage is kept for backward compat).
 * Call this from the webhook route.
 */
export async function handleBotMessageFrom(params: {
  from: string;          // sender's WhatsApp phone number (E.164 digits without +)
  phoneNumberId: string;
  accessToken: string;
  incoming: BotIncoming;
}): Promise<boolean> {
  const { from, phoneNumberId, accessToken, incoming } = params;

  try {
    const state = await getBotState(from);
    if (!state) {
      // No conversation record yet — cannot handle; let the webhook create it first.
      return false;
    }

    // If a human agent has taken over, bot stays silent.
    if (state.replyMode === 'human') return false;

    const text = incoming.text;
    const id   = incoming.interactiveId;

    // ── Global overrides (work from any step) ────────────────────────────────
    if (isMainMenuRequest(text, id)) {
      await resetBotState(from);
      await showMainMenu(phoneNumberId, accessToken, from, state.conversationId, state, { force: true });
      return true;
    }

    if (isTalkHumanRequest(text, id)) {
      await switchToHuman(phoneNumberId, accessToken, from, state.conversationId, from);
      return true;
    }

    if (isSocialLinksRequest(text, id)) {
      await handleSocialFlow({ ...state, flow: 'social', step: null, data: {} }, incoming, phoneNumberId, accessToken);
      return true;
    }

    // ── No active flow — check if this is a trigger ──────────────────────────
    if (!state.flow) {
      if (id.startsWith('menu_')) {
        await routeMenuSelection(id, state, incoming, phoneNumberId, accessToken, from);
        return true;
      }

      // Greeting triggers main menu
      if (isGreeting(text)) {
        await showMainMenu(phoneNumberId, accessToken, from, state.conversationId, state);
        return true;
      }
      // Not a known trigger — let AI handle it
      return false;
    }

    // ── Active flow: route to the appropriate handler ─────────────────────────
    if (incoming.type === 'interactive' && id) {
      const expectedIds = getExpectedInteractiveIds(state);
      const isGlobal = id === 'main_menu' || id === 'talk_human' || id.startsWith('menu_');
      if (!isGlobal && expectedIds.length > 0 && !expectedIds.includes(id)) {
        await tx(
          phoneNumberId,
          accessToken,
          from,
          state.conversationId,
          'That button is from an older menu. Please use the latest options below.',
        );
        await repromptActiveFlow(state, phoneNumberId, accessToken);
        return true;
      }
    }

    if (id.startsWith('menu_')) {
      // User tapped a menu button while in an existing flow — restart new flow
      await routeMenuSelection(id, state, incoming, phoneNumberId, accessToken, from);
      return true;
    }

    await routeActiveFlow(state, incoming, phoneNumberId, accessToken);
    return true;

  } catch (err: any) {
    logger.error('Bot error (fail-open)', { from, error: err?.message || err });
    return false; // fail open — don't crash the webhook
  }
}

async function routeMenuSelection(
  menuId: string,
  state: BotState,
  incoming: BotIncoming,
  phoneNumberId: string,
  accessToken: string,
  from: string,
): Promise<void> {
  // Reset old state before starting a new flow
  const freshState: BotState = { ...state, flow: null, step: null, data: {} };

  switch (menuId) {
    case 'menu_candidate':
      await sendPortalEntryLink(phoneNumberId, accessToken, from, state.conversationId, 'candidate');
      break;
    case 'menu_employer':
      await sendPortalEntryLink(phoneNumberId, accessToken, from, state.conversationId, 'employer');
      break;
    case 'menu_partner':
      await sendPortalEntryLink(phoneNumberId, accessToken, from, state.conversationId, 'partner');
      break;
    case 'menu_jobs':
      await handleJobsFlow({ ...freshState, flow: 'jobs' }, incoming, phoneNumberId, accessToken);
      break;
    case 'menu_social':
      await handleSocialFlow({ ...freshState, flow: 'social' }, incoming, phoneNumberId, accessToken);
      break;
  }
}

async function routeActiveFlow(
  state: BotState,
  incoming: BotIncoming,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  switch (state.flow) {
    case 'candidate_intake':
      await handleCandidateFlow(state, incoming, phoneNumberId, accessToken);
      break;
    case 'employer_intake':
      await handleEmployerFlow(state, incoming, phoneNumberId, accessToken);
      break;
    case 'partner_onboarding':
      await handlePartnerFlow(state, incoming, phoneNumberId, accessToken);
      break;
    case 'jobs':
      await handleJobsFlow(state, incoming, phoneNumberId, accessToken);
      break;
    case 'social':
      await handleSocialFlow(state, incoming, phoneNumberId, accessToken);
      break;
    case 'menu':
    default:
      await showMainMenu(phoneNumberId, accessToken, state.phoneNumber, state.conversationId, state);
      await resetBotState(state.phoneNumber);
  }
}
