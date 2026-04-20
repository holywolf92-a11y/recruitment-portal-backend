"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitCandidatePublicIntake = submitCandidatePublicIntake;
exports.submitEmployerPublicIntake = submitEmployerPublicIntake;
exports.submitPartnerPublicIntake = submitPartnerPublicIntake;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const candidateService_1 = require("./candidateService");
const candidateDocumentService_1 = require("./candidateDocumentService");
const whatsappInteractiveService_1 = require("./whatsappInteractiveService");
const userService_1 = require("./userService");
const publicUrl_1 = require("../utils/publicUrl");
const queue_1 = require("../config/queue");
const FRONTEND_URL = (0, publicUrl_1.resolveFrontendUrl)(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || undefined);
const LINKEDIN_URL = process.env.WHATSAPP_BOT_LINKEDIN_URL || 'https://www.linkedin.com/company/falishaenterprises';
const FACEBOOK_URL = process.env.WHATSAPP_BOT_FACEBOOK_URL || 'https://www.facebook.com/falishaenterprises.pk/';
const INSTAGRAM_URL = process.env.WHATSAPP_BOT_INSTAGRAM_URL || 'https://www.instagram.com/falisha.manpower';
const TIKTOK_URL = process.env.WHATSAPP_BOT_TIKTOK_URL || 'https://www.tiktok.com/@falishamanpower';
const YOUTUBE_URL = process.env.WHATSAPP_BOT_YOUTUBE_URL || 'https://youtube.com/@falishamanpower897?si=-sKB5_wZdoICyLbj';
const WA_CHANNEL_URL = process.env.WHATSAPP_BOT_CHANNEL_URL || '';
function generateTrackingToken() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const prefix = chars[Math.floor(Math.random() * chars.length)] + chars[Math.floor(Math.random() * chars.length)];
    const numbers = Math.floor(100000 + Math.random() * 900000);
    return `${prefix}${numbers}`;
}
function generateTemporaryPassword() {
    return `Falisha!${crypto_1.default.randomBytes(4).toString('hex')}`;
}
function buildSocialLinks() {
    return {
        linkedin: LINKEDIN_URL,
        facebook: FACEBOOK_URL,
        instagram: INSTAGRAM_URL,
        tiktok: TIKTOK_URL,
        youtube: YOUTUBE_URL,
        whatsappChannel: WA_CHANNEL_URL || null,
    };
}
function buildSocialLinksMessage() {
    const links = buildSocialLinks();
    const lines = [
        '🌐 *Stay connected with Falisha Manpower:*',
        '',
        `💼 LinkedIn: ${links.linkedin}`,
        `📘 Facebook: ${links.facebook}`,
        `📸 Instagram: ${links.instagram}`,
        `🎵 TikTok: ${links.tiktok}`,
        `▶️ YouTube: ${links.youtube}`,
    ];
    if (links.whatsappChannel) {
        lines.push(`💬 WhatsApp Channel: ${links.whatsappChannel}`);
    }
    lines.push('');
    lines.push('_Follow us for job updates, success stories, and more!_');
    return lines.join('\n');
}
function buildCandidateAdditionalInfo(input) {
    const parts = [input.additionalInfo?.trim(), input.comments?.trim()]
        .filter((value) => Boolean(value));
    if (parts.length === 0) {
        return undefined;
    }
    return Array.from(new Set(parts)).join('\n\n');
}
async function enqueueSocialLinks(phone) {
    if (!phone)
        return;
    const DELAY_MS = 3 * 60 * 1000; // 3 minutes
    try {
        await queue_1.whatsappSocialLinksQueue.add('send-social-links', { phone, message: buildSocialLinksMessage(), recipientRole: 'candidate' }, { delay: DELAY_MS, attempts: 2, backoff: { type: 'fixed', delay: 30000 } });
    }
    catch {
        // Non-critical — don't block the main response
    }
}
function toWhatsAppRecipient(phone) {
    const normalized = (0, candidateService_1.normalizePhoneE164)(String(phone || '').trim()) || String(phone || '').trim();
    const digits = normalized.replace(/\D/g, '');
    return digits || null;
}
async function findExistingAuthUserByEmail(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
        return null;
    }
    const supabase = (0, database_1.supabaseAdminClient)();
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) {
        throw error;
    }
    return data.users.find((user) => String(user.email || '').trim().toLowerCase() === normalizedEmail) || null;
}
async function ensureCandidateOnboardingLink(candidateId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data: candidate, error } = await db
        .from('candidates')
        .select('id, email_tracking_token')
        .eq('id', candidateId)
        .maybeSingle();
    if (error || !candidate) {
        return null;
    }
    let trackingToken = String(candidate.email_tracking_token || '').trim().toUpperCase();
    if (!trackingToken) {
        trackingToken = generateTrackingToken();
        const { error: updateError } = await db
            .from('candidates')
            .update({ email_tracking_token: trackingToken })
            .eq('id', candidateId);
        if (updateError) {
            throw updateError;
        }
    }
    return `${FRONTEND_URL}/onboarding?token=${trackingToken}`;
}
async function sendWhatsAppLines(phone, lines) {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const recipient = toWhatsAppRecipient(phone);
    if (!phoneNumberId || !accessToken || !recipient) {
        return false;
    }
    for (const line of lines.filter(Boolean)) {
        await (0, whatsappInteractiveService_1.sendText)(phoneNumberId, accessToken, recipient, line);
    }
    return true;
}
async function ensurePortalAccount(args) {
    const supabase = (0, database_1.supabaseAdminClient)();
    const existingAuthUser = await findExistingAuthUserByEmail(args.email);
    const password = existingAuthUser ? null : generateTemporaryPassword();
    const authUser = existingAuthUser || (await (async () => {
        const { data: created, error } = await supabase.auth.admin.createUser({
            email: args.email,
            password: password,
            email_confirm: true,
            user_metadata: {
                name: args.name || args.companyName || null,
                phone: args.phone || null,
                role: args.role,
                company_name: args.companyName || null,
            },
        });
        if (error) {
            throw error;
        }
        return created.user;
    })());
    await (0, userService_1.upsertAppUserProfile)({
        id: authUser.id,
        email: authUser.email || args.email,
        role: args.role,
        name: args.name || args.companyName || null,
        phone: args.phone || null,
        status: 'Active',
    });
    if (args.partnerApplicationId) {
        await supabase
            .from('partner_applications')
            .update({ user_id: authUser.id, updated_at: new Date().toISOString() })
            .eq('id', args.partnerApplicationId);
    }
    if (args.employerLeadId) {
        await supabase
            .from('employer_leads')
            .update({ user_id: authUser.id, updated_at: new Date().toISOString() })
            .eq('id', args.employerLeadId);
    }
    return {
        created: !existingAuthUser,
        password,
        userId: authUser.id,
        dashboardUrl: `${FRONTEND_URL}/${args.role}/dashboard`,
    };
}
async function submitCandidatePublicIntake(input, cvFile) {
    const additionalInfo = buildCandidateAdditionalInfo(input);
    const candidatePayload = {
        name: input.fullName.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        nationality: input.nationality?.trim() || undefined,
        address: input.currentLocation?.trim() || undefined,
        country_of_interest: input.countryOfInterest?.trim() || undefined,
        position: input.position?.trim() || undefined,
        source: 'Form',
        status: 'Applied',
        cv_received: !!cvFile,
        needs_review: true,
        auto_extracted: false,
        skills: input.skills?.trim() || undefined,
        languages: input.languages?.trim() || undefined,
        professional_summary: additionalInfo,
        experience_years: input.experience ? Number.parseInt(input.experience, 10) || undefined : undefined,
    };
    const candidate = await (0, candidateService_1.createCandidate)(candidatePayload);
    if (cvFile) {
        await (0, candidateDocumentService_1.uploadCandidateDocument)({
            candidate_id: candidate.id,
            file_name: cvFile.originalname,
            mime_type: cvFile.mimetype,
            buffer: cvFile.buffer,
            source: 'web',
            document_type: 'cv',
        });
    }
    const onboardingLink = await ensureCandidateOnboardingLink(candidate.id);
    const socialLinks = buildSocialLinks();
    // Immediate: confirmation + profile link only
    const whatsappNotified = await sendWhatsAppLines(input.phone, [
        `✅ *Thank you, ${input.fullName.split(' ')[0]}!* Your application has been received by *Falisha Manpower*.`,
        onboardingLink ? `🔗 Complete your profile here:\n${onboardingLink}` : '',
    ]).catch(() => false);
    // Delayed: social links 3 minutes later, but only for completed candidate applications
    await enqueueSocialLinks(input.phone);
    return {
        candidateId: candidate.id,
        reference: candidate.candidate_code || candidate.id,
        onboardingLink,
        socialLinks,
        whatsappNotified,
    };
}
async function submitEmployerPublicIntake(input) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('employer_leads')
        .insert({
        phone_number: input.phone.trim(),
        contact_name: input.contactName.trim(),
        company_name: input.companyName.trim(),
        email: input.email.trim().toLowerCase(),
        country: input.country?.trim() || null,
        city: input.city?.trim() || null,
        professions: input.professions?.trim() || null,
        quantity: input.quantity?.trim() || null,
        salary_range: input.salaryRange?.trim() || null,
        duty_hours: input.dutyHours?.trim() || null,
        contract_duration: input.contractDuration?.trim() || null,
        benefits_included: input.benefitsIncluded?.trim() || null,
        comments: input.comments?.trim() || null,
        payload: input,
        status: 'new',
    })
        .select('*')
        .single();
    if (error) {
        throw error;
    }
    const account = await ensurePortalAccount({
        email: input.email.trim().toLowerCase(),
        role: 'employer',
        name: input.contactName.trim(),
        phone: input.phone.trim(),
        companyName: input.companyName.trim(),
        employerLeadId: data.id,
    });
    const socialLinks = buildSocialLinks();
    // Immediate: portal access + credentials
    const immediateLines = [
        `✅ *Welcome, ${input.contactName.trim().split(' ')[0]}!* Your Falisha employer portal is ready.`,
        '',
        `🔗 *Dashboard:* ${account.dashboardUrl}`,
        `📧 *Login Email:* ${input.email.trim().toLowerCase()}`,
        account.password
            ? `🔑 *Temporary Password:* ${account.password}\n_Please change this after your first login._`
            : '🔓 Use your existing password to log in.',
    ];
    const whatsappNotified = await sendWhatsAppLines(input.phone, immediateLines).catch(() => false);
    return {
        leadId: data.id,
        dashboardUrl: account.dashboardUrl,
        email: input.email.trim().toLowerCase(),
        password: account.password,
        createdNewAccount: account.created,
        socialLinks,
        whatsappNotified,
    };
}
async function submitPartnerPublicIntake(input) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('partner_applications')
        .insert({
        applicant_name: input.applicantName.trim(),
        phone_number: input.phone.trim(),
        email: input.email.trim().toLowerCase(),
        company_name: input.companyName?.trim() || null,
        city_country: input.cityCountry?.trim() || null,
        district: input.district?.trim() || null,
        cnic: input.cnic?.trim() || null,
        partner_type: input.partnerType?.trim() || 'partner',
        payload: input,
        status: 'new',
    })
        .select('*')
        .single();
    if (error) {
        throw error;
    }
    const account = await ensurePortalAccount({
        email: input.email.trim().toLowerCase(),
        role: 'partner',
        name: input.applicantName.trim(),
        phone: input.phone.trim(),
        companyName: input.companyName?.trim() || null,
        partnerApplicationId: data.id,
    });
    const socialLinks = buildSocialLinks();
    // Immediate: portal access + credentials
    const immediateLines = [
        `✅ *Welcome, ${input.applicantName.trim().split(' ')[0]}!* Your Falisha partner portal is ready.`,
        '',
        `🔗 *Dashboard:* ${account.dashboardUrl}`,
        `📧 *Login Email:* ${input.email.trim().toLowerCase()}`,
        account.password
            ? `🔑 *Temporary Password:* ${account.password}\n_Please change this after your first login._`
            : '🔓 Use your existing password to log in.',
    ];
    const whatsappNotified = await sendWhatsAppLines(input.phone, immediateLines).catch(() => false);
    return {
        applicationId: data.id,
        dashboardUrl: account.dashboardUrl,
        email: input.email.trim().toLowerCase(),
        password: account.password,
        createdNewAccount: account.created,
        socialLinks,
        whatsappNotified,
    };
}
