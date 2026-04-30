import { supabaseAdminClient } from '../config/database';
import { createCandidate, normalizePhoneE164, type CreateCandidateData } from './candidateService';
import { uploadCandidateDocument } from './candidateDocumentService';
import { sendText } from './whatsappInteractiveService';
import { dispatchPortalAccessLink, ensurePortalAccount } from './portalAccessService';
import { resolveFrontendUrl } from '../utils/publicUrl';
import { whatsappSocialLinksQueue } from '../config/queue';
import { SOCIAL_LINKS } from '../config/socialLinks';

const FRONTEND_URL = resolveFrontendUrl(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || undefined);

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
  comments?: string;
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

function buildSocialLinks() {
  return {
    linkedin: SOCIAL_LINKS.linkedin,
    facebook: SOCIAL_LINKS.facebook,
    instagram: SOCIAL_LINKS.instagram,
    tiktok: SOCIAL_LINKS.tiktok,
    x: SOCIAL_LINKS.x,
    youtube: SOCIAL_LINKS.youtube,
    whatsappChannel: SOCIAL_LINKS.whatsappChannel || null,
  };
}

function buildSocialLinksMessage(): string {
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

function buildCandidateAdditionalInfo(input: CandidatePublicIntakeInput): string | undefined {
  const parts = [input.additionalInfo?.trim(), input.comments?.trim()]
    .filter((value): value is string => Boolean(value));

  if (parts.length === 0) {
    return undefined;
  }

  return Array.from(new Set(parts)).join('\n\n');
}

async function enqueueSocialLinks(phone: string | undefined | null) {
  if (!phone) return;
  const DELAY_MS = 3 * 60 * 1000; // 3 minutes
  try {
    await whatsappSocialLinksQueue.add(
      'send-social-links',
      { phone, message: buildSocialLinksMessage(), recipientRole: 'candidate' },
      { delay: DELAY_MS, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } }
    );
  } catch {
    // Non-critical — don't block the main response
  }
}

function toWhatsAppRecipient(phone?: string | null) {
  const normalized = normalizePhoneE164(String(phone || '').trim()) || String(phone || '').trim();
  const digits = normalized.replace(/\D/g, '');
  return digits || null;
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

export async function submitCandidatePublicIntake(input: CandidatePublicIntakeInput, cvFile?: Express.Multer.File | null) {
  const additionalInfo = buildCandidateAdditionalInfo(input);

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
    needs_review: false,
    auto_extracted: false,
    skills: input.skills?.trim() || undefined,
    languages: input.languages?.trim() || undefined,
    professional_summary: additionalInfo,
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

  const accessDelivery = await dispatchPortalAccessLink({
    name: input.contactName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    role: 'employer',
    autoLoginUrl: account.autoLoginUrl,
  });

  return {
    leadId: data.id,
    dashboardUrl: account.dashboardUrl,
    email: input.email.trim().toLowerCase(),
    password: account.password,
    createdNewAccount: account.created,
    socialLinks,
    whatsappNotified: accessDelivery.whatsapp.sent,
    emailNotified: accessDelivery.email.sent,
    autoLoginUrl: accessDelivery.autoLoginUrl,
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

  const accessDelivery = await dispatchPortalAccessLink({
    name: input.applicantName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    role: 'partner',
    autoLoginUrl: account.autoLoginUrl,
  });

  return {
    applicationId: data.id,
    dashboardUrl: account.dashboardUrl,
    email: input.email.trim().toLowerCase(),
    password: account.password,
    createdNewAccount: account.created,
    socialLinks,
    whatsappNotified: accessDelivery.whatsapp.sent,
    emailNotified: accessDelivery.email.sent,
    autoLoginUrl: accessDelivery.autoLoginUrl,
  };
}