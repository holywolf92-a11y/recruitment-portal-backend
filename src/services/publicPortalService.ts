import crypto from 'crypto';
import { supabaseAdminClient } from '../config/database';
import { createCandidate, normalizePhoneE164, type CreateCandidateData } from './candidateService';
import { uploadCandidateDocument } from './candidateDocumentService';
import { sendText } from './whatsappInteractiveService';
import { upsertAppUserProfile } from './userService';
import { resolveFrontendUrl } from '../utils/publicUrl';

const FRONTEND_URL = resolveFrontendUrl(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || undefined);
const LINKEDIN_URL = process.env.WHATSAPP_BOT_LINKEDIN_URL || 'https://www.linkedin.com/company/falishaenterprises';
const FACEBOOK_URL = process.env.WHATSAPP_BOT_FACEBOOK_URL || 'https://www.facebook.com/falishaenterprises.pk/';
const INSTAGRAM_URL = process.env.WHATSAPP_BOT_INSTAGRAM_URL || 'https://www.instagram.com/falisha.manpower';
const TIKTOK_URL = process.env.WHATSAPP_BOT_TIKTOK_URL || 'https://www.tiktok.com/@falishamanpower';
const YOUTUBE_URL = process.env.WHATSAPP_BOT_YOUTUBE_URL || 'https://youtube.com/@falishamanpower897?si=-sKB5_wZdoICyLbj';
const WA_CHANNEL_URL = process.env.WHATSAPP_BOT_CHANNEL_URL || '';

type CandidatePublicIntakeInput = {
  fullName: string;
  email: string;
  phone: string;
  nationality?: string;
  currentLocation?: string;
  countryOfInterest?: string;
  position?: string;
  experience?: string;
  skills?: string;
  languages?: string;
  additionalInfo?: string;
};

type EmployerPublicIntakeInput = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  country?: string;
  city?: string;
  professions?: string;
  quantity?: string;
  salaryRange?: string;
  dutyHours?: string;
  contractDuration?: string;
  benefitsIncluded?: string;
  comments?: string;
};

type PartnerPublicIntakeInput = {
  applicantName: string;
  email: string;
  phone: string;
  companyName?: string;
  cityCountry?: string;
  district?: string;
  cnic?: string;
  partnerType?: string;
};

function generateTrackingToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const prefix = chars[Math.floor(Math.random() * chars.length)] + chars[Math.floor(Math.random() * chars.length)];
  const numbers = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}${numbers}`;
}

function generateTemporaryPassword(): string {
  return `Falisha!${crypto.randomBytes(4).toString('hex')}`;
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

function buildSocialLinksMessage(): string {
  const links = buildSocialLinks();
  return [
    'Follow Falisha on social media:',
    '',
    `LinkedIn: ${links.linkedin}`,
    `Facebook: ${links.facebook}`,
    `Instagram: ${links.instagram}`,
    `TikTok: ${links.tiktok}`,
    `YouTube: ${links.youtube}`,
    ...(links.whatsappChannel ? [`WhatsApp Channel: ${links.whatsappChannel}`] : []),
  ].join('\n');
}

function toWhatsAppRecipient(phone?: string | null) {
  const normalized = normalizePhoneE164(String(phone || '').trim()) || String(phone || '').trim();
  const digits = normalized.replace(/\D/g, '');
  return digits || null;
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
      throw updateError;
    }
  }

  return `${FRONTEND_URL}/onboarding?token=${trackingToken}`;
}

async function sendWhatsAppLines(phone: string | undefined, lines: string[]) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const recipient = toWhatsAppRecipient(phone);

  if (!phoneNumberId || !accessToken || !recipient) {
    return false;
  }

  for (const line of lines.filter(Boolean)) {
    await sendText(phoneNumberId, accessToken, recipient, line);
  }

  return true;
}

async function ensurePortalAccount(args: {
  email: string;
  role: 'partner' | 'employer';
  name?: string | null;
  phone?: string | null;
  companyName?: string | null;
  partnerApplicationId?: string | null;
  employerLeadId?: string | null;
}) {
  const supabase = supabaseAdminClient();
  const existingAuthUser = await findExistingAuthUserByEmail(args.email);
  const password = existingAuthUser ? null : generateTemporaryPassword();

  const authUser = existingAuthUser || (await (async () => {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: args.email,
      password: password!,
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

  await upsertAppUserProfile({
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

export async function submitCandidatePublicIntake(input: CandidatePublicIntakeInput, cvFile?: Express.Multer.File | null) {
  const candidatePayload: CreateCandidateData = {
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
    professional_summary: input.additionalInfo?.trim() || undefined,
    experience_years: input.experience ? Number.parseInt(input.experience, 10) || undefined : undefined,
  };

  const candidate = await createCandidate(candidatePayload);
  if (cvFile) {
    await uploadCandidateDocument({
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
  const whatsappNotified = await sendWhatsAppLines(input.phone, [
    'Thank you for applying with Falisha Enterprises.',
    onboardingLink ? `Profile Link: ${onboardingLink}` : '',
    buildSocialLinksMessage(),
  ]).catch(() => false);

  return {
    candidateId: candidate.id,
    reference: candidate.candidate_code || candidate.id,
    onboardingLink,
    socialLinks,
    whatsappNotified,
  };
}

export async function submitEmployerPublicIntake(input: EmployerPublicIntakeInput) {
  const db = supabaseAdminClient();
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
  const whatsappNotified = await sendWhatsAppLines(input.phone, [
    'Your employer portal is ready.',
    `Dashboard: ${account.dashboardUrl}`,
    `Login Email: ${input.email.trim().toLowerCase()}`,
    account.password ? `Temporary Password: ${account.password}` : 'Use your existing password to log in.',
    buildSocialLinksMessage(),
  ]).catch(() => false);

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

export async function submitPartnerPublicIntake(input: PartnerPublicIntakeInput) {
  const db = supabaseAdminClient();
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
  const whatsappNotified = await sendWhatsAppLines(input.phone, [
    'Your partner portal is ready.',
    `Dashboard: ${account.dashboardUrl}`,
    `Login Email: ${input.email.trim().toLowerCase()}`,
    account.password ? `Temporary Password: ${account.password}` : 'Use your existing password to log in.',
    buildSocialLinksMessage(),
  ]).catch(() => false);

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