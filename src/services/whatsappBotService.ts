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
import { getBotState, setBotState, patchBotData, resetBotState, BotState } from './whatsappBotStateService';
import { sendText, sendButtons, sendList, sendImage, WaButton, WaListSection } from './whatsappInteractiveService';
import { recordOutboundMessage } from './whatsappInboxService';

const logger = createLogger('WhatsAppBot');
const MAIN_MENU_DEBOUNCE_MS = 45_000;

// ─── Config (set in Railway env) ─────────────────────────────────────────────
const JOBS_URL        = process.env.WHATSAPP_BOT_JOBS_URL        || 'https://falisha.com/jobs';
const WELCOME_IMG_URL = process.env.WHATSAPP_BOT_WELCOME_IMG_URL || '';   // public image URL or ''
const INSTAGRAM_URL   = process.env.WHATSAPP_BOT_INSTAGRAM_URL   || 'https://instagram.com/falishamanpower';
const FACEBOOK_URL    = process.env.WHATSAPP_BOT_FACEBOOK_URL    || 'https://facebook.com/falishamanpower';
const YOUTUBE_URL     = process.env.WHATSAPP_BOT_YOUTUBE_URL     || '';
const WA_CHANNEL_URL  = process.env.WHATSAPP_BOT_CHANNEL_URL     || '';

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
  return id === 'main_menu' || text === 'menu' || text === 'main menu' || text === 'home';
}

function isTalkHumanRequest(text: string, id: string): boolean {
  return id === 'talk_human' || text === 'human' || text === 'agent' || text === 'talk to human' || text === 'support';
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

  // Send welcome image only ONCE per user (idempotent regardless of webhook retries).
  // Write the flag to DB BEFORE sending so any retry sees it already set.
  if (WELCOME_IMG_URL && !state.data?.welcomed) {
    await patchBotData(to, { welcomed: true });
    await sendImage(phoneNumberId, accessToken, to, WELCOME_IMG_URL, 'Falisha Manpower').catch(() => { /* non-fatal */ });
  }

  const body = [
    'Assalam o Alaikum! Welcome to *Falisha Manpower*. 👋',
    '',
    'How can we help you today? Please select an option:',
  ].join('\n');

  const sections: WaListSection[] = [
    {
      rows: [
        { id: 'menu_candidate', title: '👷 Looking for a Job',    description: 'Submit your CV & profile' },
        { id: 'menu_employer',  title: '🏢 Start Recruiting',     description: 'Hire skilled workers' },
        { id: 'menu_partner',   title: '🤝 Become a Partner',     description: 'Join as sub-agent/agency' },
        { id: 'menu_jobs',      title: '📋 See All Jobs',         description: 'Browse open positions' },
        { id: 'menu_social',    title: '📣 Follow Our Channels',  description: 'Stay updated on new jobs' },
      ],
    },
  ];

  await lx(phoneNumberId, accessToken, to, convId, body, 'View Options', sections);
  await patchBotData(to, {
    last_main_menu_at: new Date().toISOString(),
    expected_interactive_ids: ['menu_candidate', 'menu_employer', 'menu_partner', 'menu_jobs', 'menu_social'],
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

  if (state.flow === 'candidate_intake') {
    if (state.step === 'profession') {
      await lx(phoneNumberId, accessToken, phoneNumber, convId, 'Please select your profession:', 'Select Profession', [{ rows: PROFESSION_ROWS }]);
      await setExpectedInteractive(phoneNumber, PROFESSION_ROWS.map((r) => r.id));
      return;
    }
    if (state.step === 'experience') {
      await lx(phoneNumberId, accessToken, phoneNumber, convId, 'Please select your experience level:', 'Select Experience', [{ rows: EXPERIENCE_ROWS }]);
      await setExpectedInteractive(phoneNumber, EXPERIENCE_ROWS.map((r) => r.id));
      return;
    }
    if (state.step === 'country') {
      await lx(phoneNumberId, accessToken, phoneNumber, convId, 'Please select your preferred country:', 'Select Country', [{ rows: COUNTRY_ROWS }]);
      await setExpectedInteractive(phoneNumber, COUNTRY_ROWS.map((r) => r.id));
      return;
    }
    if (state.step === 'upload_waiting') {
      await ix(
        phoneNumberId,
        accessToken,
        phoneNumber,
        convId,
        'Please send your CV/documents, or tap *Done* if finished.',
        [
          { id: 'candidate_done', title: "Done / I'm finished" },
          { id: 'talk_human', title: 'Talk to Human' },
          { id: 'main_menu', title: 'Main Menu' },
        ],
      );
      await setExpectedInteractive(phoneNumber, ['candidate_done', 'talk_human', 'main_menu']);
      return;
    }
  }

  if (state.flow === 'employer_intake') {
    if (state.step === 'country') {
      await lx(phoneNumberId, accessToken, phoneNumber, convId, 'Please select a country:', 'Select Country', [{ rows: EMPLOYER_COUNTRY_ROWS }]);
      await setExpectedInteractive(phoneNumber, EMPLOYER_COUNTRY_ROWS.map((r) => r.id));
      return;
    }
    if (state.step === 'benefits') {
      await ix(
        phoneNumberId,
        accessToken,
        phoneNumber,
        convId,
        '🍽 Does the package include accommodation, food, and transport?',
        [
          { id: 'ben_yes', title: '✅ Yes, included' },
          { id: 'ben_no', title: '❌ No' },
          { id: 'ben_partial', title: 'Partially' },
        ],
      );
      await setExpectedInteractive(phoneNumber, ['ben_yes', 'ben_no', 'ben_partial']);
      return;
    }
  }

  if (state.flow === 'partner_onboarding') {
    if (state.step === 'phone_confirm') {
      await ix(
        phoneNumberId,
        accessToken,
        phoneNumber,
        convId,
        'Please confirm your contact number:',
        [
          { id: 'pc_use_this', title: 'Use this number ✅' },
          { id: 'pc_enter_diff', title: 'Enter different number' },
        ],
      );
      await setExpectedInteractive(phoneNumber, ['pc_use_this', 'pc_enter_diff']);
      return;
    }
    if (state.step === 'partner_type') {
      await lx(phoneNumberId, accessToken, phoneNumber, convId, '🤝 What type of partner are you?', 'Select Type', [{ rows: PARTNER_TYPE_ROWS }]);
      await setExpectedInteractive(phoneNumber, PARTNER_TYPE_ROWS.map((r) => r.id));
      return;
    }
    if (state.step === 'email') {
      await ix(phoneNumberId, accessToken, phoneNumber, convId, '📧 (Optional) Please share your *email address*, or tap Skip:', [{ id: 'email_skip', title: '⏭ Skip' }]);
      await setExpectedInteractive(phoneNumber, ['email_skip']);
      return;
    }
  }

  await showMainMenu(phoneNumberId, accessToken, phoneNumber, convId, state, { force: true });
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
    '👤 Got it! We have connected you to our team. A representative will reply shortly.\n\nThank you for your patience.',
  );
}

// ─── Flow A: Candidate Intake ─────────────────────────────────────────────────

const PROFESSION_ROWS: WaListSection['rows'] = [
  { id: 'prof_electrician',  title: '⚡ Electrician' },
  { id: 'prof_plumber',      title: '🔧 Plumber' },
  { id: 'prof_welder',       title: '🔥 Welder' },
  { id: 'prof_mason',        title: '🧱 Mason / Construction' },
  { id: 'prof_driver',       title: '🚗 Driver' },
  { id: 'prof_cook',         title: '🍳 Cook / Chef' },
  { id: 'prof_nurse',        title: '🏥 Nurse / Healthcare' },
  { id: 'prof_technician',   title: '🛠 Technician' },
  { id: 'prof_engineer',     title: '👷 Engineer' },
  { id: 'prof_other',        title: '🔹 Other' },
];

const EXPERIENCE_ROWS: WaListSection['rows'] = [
  { id: 'exp_1_2',  title: '1 – 2 years' },
  { id: 'exp_3_5',  title: '3 – 5 years' },
  { id: 'exp_6_10', title: '6 – 10 years' },
  { id: 'exp_10p',  title: '10+ years' },
];

const COUNTRY_ROWS: WaListSection['rows'] = [
  { id: 'ctr_saudi',    title: '🇸🇦 Saudi Arabia' },
  { id: 'ctr_uae',      title: '🇦🇪 UAE' },
  { id: 'ctr_qatar',    title: '🇶🇦 Qatar' },
  { id: 'ctr_oman',     title: '🇴🇲 Oman' },
  { id: 'ctr_kuwait',   title: '🇰🇼 Kuwait' },
  { id: 'ctr_bahrain',  title: '🇧🇭 Bahrain' },
  { id: 'ctr_malaysia', title: '🇲🇾 Malaysia' },
  { id: 'ctr_europe',   title: '🇪🇺 Europe' },
  { id: 'ctr_other',    title: '🌍 Other' },
];

function professionLabel(id: string): string {
  return PROFESSION_ROWS.find((r) => r.id === id)?.title ?? id;
}
function experienceLabel(id: string): string {
  return EXPERIENCE_ROWS.find((r) => r.id === id)?.title ?? id;
}
function countryLabel(id: string): string {
  return COUNTRY_ROWS.find((r) => r.id === id)?.title ?? id;
}

async function handleCandidateFlow(
  state: BotState,
  incoming: BotIncoming,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const { phoneNumber, conversationId: convId, step, data } = state;
  const id    = incoming.interactiveId;
  const text  = incoming.text;

  // ── Step: name ────────────────────────────────────────────────────────────
  if (!step || step === 'name') {
    if (!step) {
      // Just entered this flow
      await setBotState(phoneNumber, 'candidate_intake', 'name', {});
      await tx(
        phoneNumberId, accessToken, phoneNumber, convId,
        '👷 Great! Let\'s build your profile.\n\nPlease type your *Full Name*:',
      );
      return;
    }
    if (incoming.type === 'text' && text.length > 0) {
      await patchBotData(phoneNumber, { name: incoming.rawText.trim() });
      await setBotState(phoneNumber, 'candidate_intake', 'profession', { ...data, name: incoming.rawText.trim() });
      await setExpectedInteractive(phoneNumber, []);
      await lx(
        phoneNumberId, accessToken, phoneNumber, convId,
        `Thanks *${incoming.rawText.trim()}*! 👍\n\nWhat is your *Profession / Trade*?`,
        'Select Profession',
        [{ rows: PROFESSION_ROWS }],
      );
      await setExpectedInteractive(phoneNumber, PROFESSION_ROWS.map((r) => r.id));
      return;
    }
    await tx(phoneNumberId, accessToken, phoneNumber, convId, 'Please type your full name to continue.');
    return;
  }

  // ── Step: profession ──────────────────────────────────────────────────────
  if (step === 'profession') {
    const profId = id.startsWith('prof_') ? id : null;
    const profText = profId ? professionLabel(profId) : incoming.rawText.trim();
    if (!profId && text.length === 0) {
      await lx(
        phoneNumberId, accessToken, phoneNumber, convId,
        'Please select your profession:',
        'Select Profession',
        [{ rows: PROFESSION_ROWS }],
      );
      return;
    }
    const newData = { ...data, profession: profText };
    await setBotState(phoneNumber, 'candidate_intake', 'experience', newData);
    await lx(
      phoneNumberId, accessToken, phoneNumber, convId,
      '📅 How many years of experience do you have?',
      'Select Experience',
      [{ rows: EXPERIENCE_ROWS }],
    );
    await setExpectedInteractive(phoneNumber, EXPERIENCE_ROWS.map((r) => r.id));
    return;
  }

  // ── Step: experience ──────────────────────────────────────────────────────
  if (step === 'experience') {
    const expId = id.startsWith('exp_') ? id : null;
    const expText = expId ? experienceLabel(expId) : incoming.rawText.trim();
    if (!expId && text.length === 0) {
      await lx(
        phoneNumberId, accessToken, phoneNumber, convId,
        'Please select your experience level:',
        'Select Experience',
        [{ rows: EXPERIENCE_ROWS }],
      );
      return;
    }
    const newData = { ...data, experience: expText };
    await setBotState(phoneNumber, 'candidate_intake', 'country', newData);
    await lx(
      phoneNumberId, accessToken, phoneNumber, convId,
      '🌍 Which country are you interested in working in?',
      'Select Country',
      [{ rows: COUNTRY_ROWS }],
    );
    await setExpectedInteractive(phoneNumber, COUNTRY_ROWS.map((r) => r.id));
    return;
  }

  // ── Step: country ─────────────────────────────────────────────────────────
  if (step === 'country') {
    const ctrId = id.startsWith('ctr_') ? id : null;
    const ctrText = ctrId ? countryLabel(ctrId) : incoming.rawText.trim();
    if (!ctrId && text.length === 0) {
      await lx(
        phoneNumberId, accessToken, phoneNumber, convId,
        'Please select your preferred country:',
        'Select Country',
        [{ rows: COUNTRY_ROWS }],
      );
      return;
    }
    const newData: Record<string, any> = { ...data, preferred_country: ctrText };
    await setBotState(phoneNumber, 'candidate_intake', 'upload_prompt', newData);

    await tx(
      phoneNumberId, accessToken, phoneNumber, convId,
      [
        `✅ Profile summary:`,
        `• Name: *${newData.name || 'Not set'}*`,
        `• Profession: *${newData.profession || 'Not set'}*`,
        `• Experience: *${newData.experience || 'Not set'}*`,
        `• Country: *${newData.preferred_country}*`,
        '',
        '📎 Now please upload your documents.',
        'Send them as *files* (not photos) for best quality:',
        '',
        '✅ CV / Resume *(required)*',
        '📘 Passport *(recommended)*',
        '🪪 CNIC',
        '🎓 Certificates / Degree',
        '🚗 Driving License',
        '',
        'You can send multiple files one by one. Tap *Done* when finished.',
      ].join('\n'),
    );
    await ix(
      phoneNumberId, accessToken, phoneNumber, convId,
      'Ready to upload your documents?',
      [
        { id: 'candidate_done',  title: "Done / I'm finished" },
        { id: 'main_menu',       title: 'Main Menu' },
        { id: 'talk_human',      title: 'Talk to Human' },
      ],
    );
    await setExpectedInteractive(phoneNumber, ['candidate_done', 'main_menu', 'talk_human']);
    await setBotState(phoneNumber, 'candidate_intake', 'upload_waiting', newData);
    return;
  }

  // ── Step: upload_waiting — accept any media, offer "Done" button ──────────
  if (step === 'upload_waiting') {
    if (incoming.hasMedia) {
      // Media is handled by the existing WhatsApp media worker (CV parsing pipeline).
      // Just acknowledge and keep waiting.
      await ix(
        phoneNumberId, accessToken, phoneNumber, convId,
        '📥 Document received! Send more or tap *Done* when finished.',
        [
          { id: 'candidate_done', title: "Done / I'm finished" },
          { id: 'talk_human',     title: 'Talk to Human' },
        ],
      );
      await setExpectedInteractive(phoneNumber, ['candidate_done', 'talk_human']);
      return;
    }

    if (id === 'candidate_done' || text === 'done' || text === 'finished') {
      await confirmCandidateProfile(state, phoneNumberId, accessToken);
      return;
    }

    // They typed something while we're waiting for upload
    await ix(
      phoneNumberId, accessToken, phoneNumber, convId,
      'Please send your CV and documents now, or tap *Done* if you\'re finished.',
      [
        { id: 'candidate_done', title: "Done / I'm finished" },
        { id: 'talk_human',     title: 'Talk to Human' },
      ],
    );
    await setExpectedInteractive(phoneNumber, ['candidate_done', 'talk_human']);
    return;
  }

  // ── Step: post_actions ────────────────────────────────────────────────────
  if (step === 'post_actions') {
    if (id === 'candidate_upload_more') {
      await setBotState(phoneNumber, 'candidate_intake', 'upload_waiting', data);
      await ix(
        phoneNumberId,
        accessToken,
        phoneNumber,
        convId,
        'Great, please send additional documents now. Tap *Done* when finished.',
        [
          { id: 'candidate_done', title: "Done / I'm finished" },
          { id: 'talk_human', title: 'Talk to Human' },
          { id: 'main_menu', title: 'Main Menu' },
        ],
      );
      await setExpectedInteractive(phoneNumber, ['candidate_done', 'talk_human', 'main_menu']);
      return;
    }
    if (id === 'menu_jobs') {
      await handleJobsFlow({ ...state, flow: 'jobs' }, incoming, phoneNumberId, accessToken);
      return;
    }
    await ix(
      phoneNumberId,
      accessToken,
      phoneNumber,
      convId,
      'Please choose an option below:',
      [
        { id: 'candidate_upload_more', title: 'Upload More Docs' },
        { id: 'menu_jobs', title: 'See Jobs' },
        { id: 'talk_human', title: 'Talk to Human' },
      ],
    );
    await setExpectedInteractive(phoneNumber, ['candidate_upload_more', 'menu_jobs', 'talk_human']);
    return;
  }
}

async function confirmCandidateProfile(
  state: BotState,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const { phoneNumber, conversationId: convId, data } = state;
  await setBotState(phoneNumber, 'candidate_intake', 'post_actions', data);
  await tx(
    phoneNumberId, accessToken, phoneNumber, convId,
    [
      '🎉 *Thank you!* Your profile has been created.',
      '',
      `• Name: *${data.name || 'Pending'}*`,
      `• Profession: *${data.profession || 'Pending'}*`,
      `• Experience: *${data.experience || 'Pending'}*`,
      `• Country: *${data.preferred_country || 'Pending'}*`,
      '',
      'Our team will review your profile and contact you shortly. You can also send more documents anytime.',
      '',
      '— Falisha Manpower Team',
    ].join('\n'),
  );
  await ix(
    phoneNumberId, accessToken, phoneNumber, convId,
    'What would you like to do next?',
    [
      { id: 'candidate_upload_more', title: 'Upload More Docs' },
      { id: 'menu_jobs',      title: 'See Jobs' },
      { id: 'talk_human',     title: 'Talk to Human' },
    ],
  );
  await setExpectedInteractive(phoneNumber, ['candidate_upload_more', 'menu_jobs', 'talk_human']);
}

// ─── Flow B: Employer Intake ──────────────────────────────────────────────────

const EMPLOYER_COUNTRY_ROWS: WaListSection['rows'] = [
  { id: 'ec_saudi',   title: '🇸🇦 Saudi Arabia' },
  { id: 'ec_uae',     title: '🇦🇪 UAE' },
  { id: 'ec_qatar',   title: '🇶🇦 Qatar' },
  { id: 'ec_oman',    title: '🇴🇲 Oman' },
  { id: 'ec_kuwait',  title: '🇰🇼 Kuwait' },
  { id: 'ec_bahrain', title: '🇧🇭 Bahrain' },
  { id: 'ec_other',   title: '🌍 Other' },
];

async function handleEmployerFlow(
  state: BotState,
  incoming: BotIncoming,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const { phoneNumber, conversationId: convId, step, data } = state;
  const id   = incoming.interactiveId;
  const text = incoming.text;
  const raw  = incoming.rawText.trim();

  // Entry
  if (!step || step === 'country') {
    if (!step) {
      await setBotState(phoneNumber, 'employer_intake', 'country', {});
      await lx(
        phoneNumberId, accessToken, phoneNumber, convId,
        '🏢 Great! Let\'s set up your recruitment request.\n\n*Which country are you recruiting from?*',
        'Select Country',
        [{ rows: EMPLOYER_COUNTRY_ROWS }],
      );
      await setExpectedInteractive(phoneNumber, EMPLOYER_COUNTRY_ROWS.map((r) => r.id));
      return;
    }
    const ctrId = id.startsWith('ec_') ? id : null;
    const ctrText = ctrId
      ? (EMPLOYER_COUNTRY_ROWS.find((r) => r.id === ctrId)?.title ?? ctrId)
      : raw;
    if (!ctrId && raw.length === 0) {
      await lx(phoneNumberId, accessToken, phoneNumber, convId, 'Please select a country:', 'Select Country', [{ rows: EMPLOYER_COUNTRY_ROWS }]);
      return;
    }
    await setBotState(phoneNumber, 'employer_intake', 'professions', { ...data, country: ctrText });
    await tx(
      phoneNumberId, accessToken, phoneNumber, convId,
      '👷 What professions / trades do you need?\n\nPlease type them separated by commas.\n\n_Example:_ Electricians, Plumbers, Welders, Drivers',
    );
    return;
  }

  if (step === 'professions') {
    if (raw.length === 0) { await tx(phoneNumberId, accessToken, phoneNumber, convId, 'Please type the professions you need.'); return; }
    await setBotState(phoneNumber, 'employer_intake', 'quantity', { ...data, professions: raw });
    await tx(phoneNumberId, accessToken, phoneNumber, convId, '🔢 How many workers do you need in total?\n\n_Example:_ 25');
    return;
  }

  if (step === 'quantity') {
    if (raw.length === 0) { await tx(phoneNumberId, accessToken, phoneNumber, convId, 'Please enter the number of workers needed.'); return; }
    await setBotState(phoneNumber, 'employer_intake', 'salary', { ...data, quantity: raw });
    await tx(phoneNumberId, accessToken, phoneNumber, convId, '💰 What is the *salary range* (per month)?\n\n_Example:_ SAR 1500 – 2000');
    return;
  }

  if (step === 'salary') {
    if (raw.length === 0) { await tx(phoneNumberId, accessToken, phoneNumber, convId, 'Please enter the salary range.'); return; }
    await setBotState(phoneNumber, 'employer_intake', 'duration', { ...data, salary_range: raw });
    await tx(phoneNumberId, accessToken, phoneNumber, convId, '📅 What is the *contract duration*?\n\n_Example:_ 2 years');
    return;
  }

  if (step === 'duration') {
    if (raw.length === 0) { await tx(phoneNumberId, accessToken, phoneNumber, convId, 'Please enter the contract duration.'); return; }
    await setBotState(phoneNumber, 'employer_intake', 'benefits', { ...data, contract_duration: raw });
    await ix(
      phoneNumberId, accessToken, phoneNumber, convId,
      '🍽 Does the package include accommodation, food, and transport?',
      [
        { id: 'ben_yes',      title: '✅ Yes, included' },
        { id: 'ben_no',       title: '❌ No' },
        { id: 'ben_partial',  title: 'Partially' },
      ],
    );
    await setExpectedInteractive(phoneNumber, ['ben_yes', 'ben_no', 'ben_partial']);
    return;
  }

  if (step === 'benefits') {
    const benMap: Record<string, string> = { ben_yes: 'Yes', ben_no: 'No', ben_partial: 'Partial' };
    const ben = (benMap[id] ?? raw) || 'Not specified';
    await setBotState(phoneNumber, 'employer_intake', 'city', { ...data, benefits_included: ben });
    await tx(phoneNumberId, accessToken, phoneNumber, convId, '📍 What is the *work city / location*?');
    return;
  }

  if (step === 'city') {
    if (raw.length === 0) { await tx(phoneNumberId, accessToken, phoneNumber, convId, 'Please enter the work city/location.'); return; }
    const newData: Record<string, any> = { ...data, city: raw };
    await setBotState(phoneNumber, 'employer_intake', 'confirmed', newData);
    await saveEmployerLead(phoneNumber, convId, newData);
    await tx(
      phoneNumberId, accessToken, phoneNumber, convId,
      [
        '✅ *Recruitment Request Submitted!*',
        '',
        `• Country: *${newData.country}*`,
        `• Professions: *${newData.professions}*`,
        `• Quantity: *${newData.quantity}*`,
        `• Salary: *${newData.salary_range}*`,
        `• Duration: *${newData.contract_duration}*`,
        `• Benefits: *${newData.benefits_included}*`,
        `• City: *${newData.city}*`,
        '',
        'Our recruitment team will contact you within 24 hours. Thank you! 🤝',
        '',
        '— Falisha Manpower Team',
      ].join('\n'),
    );
    await ix(
      phoneNumberId, accessToken, phoneNumber, convId,
      'What would you like to do next?',
      [
        { id: 'menu_employer', title: 'Add Another Role' },
        { id: 'menu_partner',  title: 'Become a Partner' },
        { id: 'talk_human',    title: 'Talk to Human' },
      ],
    );
    await setExpectedInteractive(phoneNumber, ['menu_employer', 'menu_partner', 'talk_human']);
    await resetBotState(phoneNumber);
    return;
  }
}

async function saveEmployerLead(
  phoneNumber: string,
  conversationId: string | null,
  data: Record<string, any>,
): Promise<void> {
  try {
    const db = supabaseAdminClient();
    await db.from('employer_leads').insert({
      phone_number:      phoneNumber,
      conversation_id:   conversationId,
      country:           data.country ?? null,
      professions:       data.professions ?? null,
      quantity:          data.quantity ?? null,
      salary_range:      data.salary_range ?? null,
      contract_duration: data.contract_duration ?? null,
      benefits_included: data.benefits_included ?? null,
      city:              data.city ?? null,
      status:            'new',
    });
    logger.info('Employer lead saved', { phoneNumber });
  } catch (err: any) {
    logger.warn('Failed to save employer lead (non-fatal)', { phoneNumber, error: err?.message });
  }
}

// ─── Flow C: Partner Onboarding ───────────────────────────────────────────────

const PARTNER_TYPE_ROWS: WaListSection['rows'] = [
  { id: 'pt_subagent',    title: '🔗 Sub-agent',          description: 'Refer candidates / clients' },
  { id: 'pt_company',     title: '🏢 Company / Employer',  description: 'Direct hiring company' },
  { id: 'pt_overseas',    title: '✈️ Overseas Recruiter',  description: 'Based outside Pakistan' },
  { id: 'pt_other',       title: '🔹 Other',              description: 'Other partnership type' },
];

async function handlePartnerFlow(
  state: BotState,
  incoming: BotIncoming,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const { phoneNumber, conversationId: convId, step, data } = state;
  const id   = incoming.interactiveId;
  const raw  = incoming.rawText.trim();

  if (!step || step === 'phone_confirm') {
    if (!step) {
      await setBotState(phoneNumber, 'partner_onboarding', 'phone_confirm', {});
      await ix(
        phoneNumberId, accessToken, phoneNumber, convId,
        '🤝 Welcome! To register as a Falisha Manpower partner, please confirm your contact number.',
        [
          { id: 'pc_use_this',   title: 'Use this number ✅' },
          { id: 'pc_enter_diff', title: 'Enter different number' },
        ],
        `Register as Partner`,
      );
      await setExpectedInteractive(phoneNumber, ['pc_use_this', 'pc_enter_diff']);
      return;
    }
    if (id === 'pc_use_this') {
      await setBotState(phoneNumber, 'partner_onboarding', 'company_name', { ...data, contact_phone: phoneNumber });
      await tx(phoneNumberId, accessToken, phoneNumber, convId, '✅ Number confirmed.\n\nPlease enter your *Company / Agency name* (or your personal name if individual):');
      return;
    }
    if (id === 'pc_enter_diff') {
      await setBotState(phoneNumber, 'partner_onboarding', 'phone_input', data);
      await tx(phoneNumberId, accessToken, phoneNumber, convId, 'Please type your preferred contact number (with country code, e.g. +923001234567):');
      return;
    }
    await ix(
      phoneNumberId, accessToken, phoneNumber, convId,
      'Please confirm your contact number:',
      [
        { id: 'pc_use_this',   title: 'Use this number ✅' },
        { id: 'pc_enter_diff', title: 'Enter different number' },
      ],
    );
    return;
  }

  if (step === 'phone_input') {
    if (raw.length === 0) { await tx(phoneNumberId, accessToken, phoneNumber, convId, 'Please type your contact number.'); return; }
    await setBotState(phoneNumber, 'partner_onboarding', 'company_name', { ...data, contact_phone: raw });
    await tx(phoneNumberId, accessToken, phoneNumber, convId, '✅ Number saved.\n\nPlease enter your *Company / Agency name*:');
    return;
  }

  if (step === 'company_name') {
    if (raw.length === 0) { await tx(phoneNumberId, accessToken, phoneNumber, convId, 'Please enter your company or agency name.'); return; }
    await setBotState(phoneNumber, 'partner_onboarding', 'city_country', { ...data, company_name: raw });
    await tx(phoneNumberId, accessToken, phoneNumber, convId, '📍 Please enter your *City & Country*:\n\n_Example:_ Lahore, Pakistan');
    return;
  }

  if (step === 'city_country') {
    if (raw.length === 0) { await tx(phoneNumberId, accessToken, phoneNumber, convId, 'Please enter your city and country.'); return; }
    await setBotState(phoneNumber, 'partner_onboarding', 'partner_type', { ...data, city_country: raw });
    await lx(
      phoneNumberId, accessToken, phoneNumber, convId,
      '🤝 What type of partner are you?',
      'Select Type',
      [{ rows: PARTNER_TYPE_ROWS }],
    );
    await setExpectedInteractive(phoneNumber, PARTNER_TYPE_ROWS.map((r) => r.id));
    return;
  }

  if (step === 'partner_type') {
    const ptMap: Record<string, string> = {
      pt_subagent: 'Sub-agent', pt_company: 'Company', pt_overseas: 'Overseas Recruiter', pt_other: 'Other',
    };
    const ptText = (ptMap[id] ?? raw) || 'Other';
    await setBotState(phoneNumber, 'partner_onboarding', 'email', { ...data, partner_type: ptText });
    await ix(
      phoneNumberId, accessToken, phoneNumber, convId,
      '📧 (Optional) Please share your *email address*, or tap Skip:',
      [{ id: 'email_skip', title: '⏭ Skip' }],
    );
    await setExpectedInteractive(phoneNumber, ['email_skip']);
    return;
  }

  if (step === 'email') {
    const email = id === 'email_skip' ? null : (raw.includes('@') ? raw : null);
    if (!email && id !== 'email_skip' && raw.length > 0) {
      await ix(
        phoneNumberId, accessToken, phoneNumber, convId,
        'That doesn\'t look like a valid email. Please try again or tap Skip:',
        [{ id: 'email_skip', title: '⏭ Skip' }],
      );
      return;
    }
    const newData: Record<string, any> = { ...data, email };
    await setBotState(phoneNumber, 'partner_onboarding', 'confirmed', newData);
    await savePartnerApplication(phoneNumber, convId, newData);
    await tx(
      phoneNumberId, accessToken, phoneNumber, convId,
      [
        '✅ *Partner Application Submitted!*',
        '',
        `• Company: *${newData.company_name}*`,
        `• Location: *${newData.city_country}*`,
        `• Type: *${newData.partner_type}*`,
        `• Contact: *${newData.contact_phone}*`,
        ...(newData.email ? [`• Email: *${newData.email}*`] : []),
        '',
        'Our admin team will review your application and get back to you within 48 hours.',
        '',
        '— Falisha Manpower Team',
      ].join('\n'),
    );
    await ix(
      phoneNumberId, accessToken, phoneNumber, convId,
      'What would you like to do next?',
      [
        { id: 'main_menu',   title: 'Main Menu' },
        { id: 'talk_human',  title: 'Talk to Human' },
      ],
    );
    await setExpectedInteractive(phoneNumber, ['main_menu', 'talk_human']);
    await resetBotState(phoneNumber);
    return;
  }
}

async function savePartnerApplication(
  phoneNumber: string,
  conversationId: string | null,
  data: Record<string, any>,
): Promise<void> {
  try {
    const db = supabaseAdminClient();
    await db.from('partner_applications').insert({
      phone_number:    phoneNumber,
      conversation_id: conversationId,
      company_name:    data.company_name ?? null,
      city_country:    data.city_country ?? null,
      partner_type:    data.partner_type ?? null,
      email:           data.email ?? null,
      status:          'pending',
    });
    logger.info('Partner application saved', { phoneNumber });
  } catch (err: any) {
    logger.warn('Failed to save partner application (non-fatal)', { phoneNumber, error: err?.message });
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
    ...(INSTAGRAM_URL   ? [`📸 Instagram:\n${INSTAGRAM_URL}`]   : []),
    ...(FACEBOOK_URL    ? [`👍 Facebook:\n${FACEBOOK_URL}`]    : []),
    ...(YOUTUBE_URL     ? [`▶️ YouTube:\n${YOUTUBE_URL}`]       : []),
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

    // ── No active flow — check if this is a trigger ──────────────────────────
    if (!state.flow) {
      // Greeting or menu tap triggers main menu
      if (isGreeting(text) || id.startsWith('menu_')) {
        await showMainMenu(phoneNumberId, accessToken, from, state.conversationId, state);
        if (id.startsWith('menu_')) {
          // Fall through immediately to route the selected menu item
          // (processed in the block below after a fresh state read isn't needed
          //  since we know the id — handle inline)
          await routeMenuSelection(id, state, incoming, phoneNumberId, accessToken, from);
        }
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
      await handleCandidateFlow({ ...freshState, flow: 'candidate_intake' }, incoming, phoneNumberId, accessToken);
      break;
    case 'menu_employer':
      await handleEmployerFlow({ ...freshState, flow: 'employer_intake' }, incoming, phoneNumberId, accessToken);
      break;
    case 'menu_partner':
      await handlePartnerFlow({ ...freshState, flow: 'partner_onboarding' }, incoming, phoneNumberId, accessToken);
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
