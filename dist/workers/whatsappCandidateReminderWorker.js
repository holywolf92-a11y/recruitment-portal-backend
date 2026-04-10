"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWhatsAppCandidateReminderWorker = startWhatsAppCandidateReminderWorker;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const whatsappInboxService_1 = require("../services/whatsappInboxService");
const whatsappBotStateService_1 = require("../services/whatsappBotStateService");
const whatsappInteractiveService_1 = require("../services/whatsappInteractiveService");
const logger = (0, errorHandling_1.createLogger)('WhatsAppFlowReminderWorker');
const CHECK_INTERVAL_MS = Number(process.env.WHATSAPP_FLOW_REMINDER_CHECK_INTERVAL_MS
    || process.env.WHATSAPP_CANDIDATE_REMINDER_CHECK_INTERVAL_MS
    || 15 * 60 * 1000);
const REMINDER_GAP_MS = Number(process.env.WHATSAPP_FLOW_REMINDER_GAP_MS
    || process.env.WHATSAPP_CANDIDATE_REMINDER_IDLE_MS
    || 24 * 60 * 60 * 1000);
const MAX_REMINDERS = Number(process.env.WHATSAPP_FLOW_REMINDER_MAX_COUNT
    || process.env.WHATSAPP_CANDIDATE_REMINDER_MAX_COUNT
    || 3);
const START_DELAY_MS = Number(process.env.WHATSAPP_FLOW_REMINDER_START_DELAY_MS
    || process.env.WHATSAPP_CANDIDATE_REMINDER_START_DELAY_MS
    || 2 * 60 * 1000);
const MENU_HUMAN_BUTTONS = [
    { id: 'main_menu', title: 'Main Menu' },
    { id: 'talk_human', title: 'Talk to Human' },
];
const CANDIDATE_CV_BUTTONS = [
    { id: 'submit_candidate', title: 'Submit' },
    { id: 'main_menu', title: 'Main Menu' },
    { id: 'talk_human', title: 'Talk to Human' },
];
const FLOW_CONFIGS = {
    candidate_intake: {
        reminderKey: 'candidate',
        steps: {
            basic_details: {
                header: 'Job Seeker',
                buttons: MENU_HUMAN_BUTTONS,
                buildBody: (botData) => {
                    const required = [
                        ['name', 'Full Name'],
                        ['profession', 'Profession'],
                        ['contact_number', 'Contact Number'],
                        ['email', 'Email'],
                        ['preferred_country', 'Preferred Country'],
                    ];
                    const missing = required
                        .filter(([key]) => !String(botData[key] || '').trim())
                        .map(([, label]) => label);
                    return [
                        'Reminder: complete your Falisha job seeker profile.',
                        missing.length ? `Missing: ${missing.join(', ')}` : 'Please send your remaining job seeker details.',
                        '',
                        'Reply with the missing items, or resend all 5 details in one message.',
                    ].join('\n');
                },
            },
            cv_upload: {
                header: 'Job Seeker',
                buttons: CANDIDATE_CV_BUTTONS,
                buildBody: () => [
                    'Reminder: your job seeker profile is almost complete.',
                    'Please upload your CV as a WhatsApp document, or tap Submit to finish without CV.',
                ].join('\n'),
            },
        },
    },
    employer_intake: {
        reminderKey: 'employer',
        steps: {
            company_name: { header: 'Employer', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your employer request, please send your Company Name.' },
            contact_number: { header: 'Employer', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your employer request, please send your Contact Number.' },
            email: { header: 'Employer', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your employer request, please send your Email Address.' },
            country: { header: 'Employer', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your employer request, please send your Country.' },
            employees_required: { header: 'Employer', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your employer request, please send the number of employees required.' },
            job_profession: { header: 'Employer', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your employer request, please send the Job Profession.' },
            salary: { header: 'Employer', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your employer request, please send the Salary.' },
            duty_hours: { header: 'Employer', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your employer request, please send the Duty Hours.' },
            comments: { header: 'Employer', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: your employer request is almost complete. Please send your comments, or reply Skip.' },
        },
    },
    partner_onboarding: {
        reminderKey: 'partner',
        steps: {
            name: { header: 'Become a Partner', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your partner/agent application, please send your Name.' },
            contact: { header: 'Become a Partner', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your partner/agent application, please send your Contact Number.' },
            email: { header: 'Become a Partner', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your partner/agent application, please send your Email.' },
            district: { header: 'Become a Partner', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your partner/agent application, please send your District.' },
            cnic: { header: 'Become a Partner', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: to continue your partner/agent application, please send your CNIC.' },
            cnic_upload: { header: 'Become a Partner', buttons: MENU_HUMAN_BUTTONS, buildBody: () => 'Reminder: your partner/agent application is almost complete. Please upload your CNIC picture.' },
        },
    },
};
let reminderTimer = null;
let reminderRunInFlight = false;
function getReminderMetadata(conversation) {
    const reminderKey = FLOW_CONFIGS[conversation.bot_flow].reminderKey;
    const botData = conversation.bot_data ?? {};
    const count = Number(botData[`${reminderKey}_reminder_count`] || 0);
    const lastReminderAt = typeof botData[`${reminderKey}_last_reminder_at`] === 'string'
        ? Date.parse(botData[`${reminderKey}_last_reminder_at`])
        : 0;
    return { reminderKey, count, lastReminderAt };
}
async function fetchIncompleteConversations() {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_conversations')
        .select('id, phone_number, bot_flow, bot_step, bot_data, last_inbound_at, reply_mode')
        .eq('reply_mode', 'ai')
        .in('bot_flow', ['candidate_intake', 'employer_intake', 'partner_onboarding'])
        .not('bot_step', 'is', null);
    if (error) {
        throw error;
    }
    return (data ?? []);
}
async function sendReminder(conversation, phoneNumberId, accessToken) {
    const flowConfig = FLOW_CONFIGS[conversation.bot_flow];
    const step = conversation.bot_step;
    if (!step) {
        return;
    }
    const stepConfig = flowConfig.steps[step];
    if (!stepConfig) {
        return;
    }
    const body = stepConfig.buildBody(conversation.bot_data ?? {});
    const sentAt = new Date();
    const response = await (0, whatsappInteractiveService_1.sendButtons)(phoneNumberId, accessToken, conversation.phone_number, body, [...stepConfig.buttons], stepConfig.header);
    await (0, whatsappInboxService_1.recordOutboundMessage)({
        conversationId: conversation.id,
        direction: 'outbound',
        fromNumberId: phoneNumberId,
        toPhoneNumber: conversation.phone_number,
        body: `[buttons] ${body}`,
        metaMessageId: response?.messages?.[0]?.id,
        status: 'sent',
        raw: { kind: 'flow_reminder', flow: conversation.bot_flow, step, response },
        sentAt,
    });
    const { reminderKey, count } = getReminderMetadata(conversation);
    await (0, whatsappBotStateService_1.patchBotData)(conversation.phone_number, {
        [`${reminderKey}_last_reminder_at`]: sentAt.toISOString(),
        [`${reminderKey}_reminder_count`]: count + 1,
        [`${reminderKey}_reminder_step`]: step,
    });
}
async function runReminderPass() {
    if (reminderRunInFlight) {
        logger.debug('WhatsApp flow reminder worker already running, skipping overlap');
        return;
    }
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!accessToken || !phoneNumberId) {
        logger.warn('WhatsApp flow reminder worker skipped: WhatsApp credentials missing');
        return;
    }
    reminderRunInFlight = true;
    const now = Date.now();
    try {
        const conversations = await fetchIncompleteConversations();
        for (const conversation of conversations) {
            const { count, lastReminderAt } = getReminderMetadata(conversation);
            if (count >= MAX_REMINDERS) {
                continue;
            }
            const lastInboundAt = conversation.last_inbound_at ? Date.parse(conversation.last_inbound_at) : 0;
            const baselineAt = Math.max(lastInboundAt, lastReminderAt);
            if (!baselineAt || now - baselineAt < REMINDER_GAP_MS) {
                continue;
            }
            const withinWindow = await (0, whatsappInboxService_1.isWithin24HourWindow)(conversation.id).catch((error) => {
                logger.warn('Failed to check 24h window for WhatsApp flow reminder', {
                    conversationId: conversation.id,
                    flow: conversation.bot_flow,
                    error: error instanceof Error ? error.message : String(error),
                });
                return false;
            });
            if (!withinWindow) {
                logger.info('Skipping flow reminder outside 24-hour WhatsApp window', {
                    conversationId: conversation.id,
                    flow: conversation.bot_flow,
                    step: conversation.bot_step,
                    reminderCount: count,
                });
                continue;
            }
            try {
                await sendReminder(conversation, phoneNumberId, accessToken);
                logger.info('Sent WhatsApp incomplete-flow reminder', {
                    conversationId: conversation.id,
                    phoneNumber: conversation.phone_number,
                    flow: conversation.bot_flow,
                    step: conversation.bot_step,
                    reminderCount: count + 1,
                });
            }
            catch (error) {
                logger.warn('Failed to send WhatsApp incomplete-flow reminder', {
                    conversationId: conversation.id,
                    phoneNumber: conversation.phone_number,
                    flow: conversation.bot_flow,
                    step: conversation.bot_step,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
    catch (error) {
        logger.error('WhatsApp flow reminder worker pass failed', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
    finally {
        reminderRunInFlight = false;
    }
}
function startWhatsAppCandidateReminderWorker() {
    logger.info('Starting WhatsApp incomplete-flow reminder worker', {
        checkIntervalMs: CHECK_INTERVAL_MS,
        reminderGapMs: REMINDER_GAP_MS,
        maxReminders: MAX_REMINDERS,
        startDelayMs: START_DELAY_MS,
    });
    if (reminderTimer) {
        clearInterval(reminderTimer);
    }
    setTimeout(() => {
        void runReminderPass();
        reminderTimer = setInterval(() => {
            void runReminderPass();
        }, CHECK_INTERVAL_MS);
    }, START_DELAY_MS);
}
