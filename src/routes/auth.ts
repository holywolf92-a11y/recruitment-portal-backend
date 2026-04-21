import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import { authenticate, AuthRequest } from '../middleware/auth';
import { bootstrapCandidateProfileForAuthUser, deleteAppUserProfile, getLatestPartnerApplicationForUser, getPortalProfile, getUserById, getUserProfile, listAppUsers, normalizeAppRole, updateAppUserProfile, upsertAppUserProfile } from '../services/userService';
import { type CreateCandidateData } from '../services/candidateService';
import { isGovernmentEmail } from '../services/progressiveDataCompletionService';
import { supabaseAdminClient } from '../config/database';
import { ingestPartnerBulkAttachment, upsertPartnerCandidate, uploadPartnerManualDocument } from '../services/partnerCandidateService';
import { emailService } from '../services/emailService';
import { sendMessage } from '../services/whatsappService';

const bulkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

const VALID_STATUSES = ['Active', 'Inactive', 'Suspended'];

function getBearerToken(req: AuthRequest) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }

  return auth.replace('Bearer ', '').trim();
}

function buildDisplayName(firstName?: string, lastName?: string) {
  return [firstName, lastName].map((value) => value?.trim()).filter(Boolean).join(' ') || null;
}

function splitDisplayName(name?: string | null) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return { firstName: undefined, lastName: undefined };
  }

  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ') || undefined,
  };
}

function isMissingColumnError(error: any, columnName: string) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes(columnName.toLowerCase()) && message.includes('column');
}

function mapCandidateIdentityFields<T extends Record<string, any>>(candidate: T) {
  return {
    ...candidate,
    cnic: candidate.cnic_normalized || candidate.cnic || null,
    passport: candidate.passport_normalized || candidate.passport || null,
  };
}

/** Normalize a phone number to WhatsApp format: digits only, no leading '+'. */
function toWhatsAppPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Send welcome credentials to a newly created (or password-reset) user via
 * email and, if a phone number is present, via WhatsApp.
 */
async function dispatchWelcomeCredentials(user: {
  name: string | null;
  email: string;
  phone?: string | null;
  role: string;
}, password: string) {
  const portalUrl = process.env.FRONTEND_URL || 'https://falishajobs.up.railway.app';
  const displayName = user.name || user.email;
  const roleLabel = user.role.charAt(0).toUpperCase() + user.role.slice(1);

  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1d4ed8">Welcome to Falisha Jobs Portal</h2>
      <p>Hi <strong>${displayName}</strong>,</p>
      <p>Your <strong>${roleLabel}</strong> account has been created. Here are your login credentials:</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:8px;background:#f3f4f6;font-weight:bold;width:120px">Login URL</td><td style="padding:8px"><a href="${portalUrl}">${portalUrl}</a></td></tr>
        <tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">Email</td><td style="padding:8px">${user.email}</td></tr>
        <tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">Password</td><td style="padding:8px"><strong>${password}</strong></td></tr>
      </table>
      <p style="color:#6b7280;font-size:13px">Please log in and change your password after your first sign-in.</p>
      <p>Regards,<br/>Falisha Jobs Team</p>
    </div>
  `;

  try {
    await emailService.sendEmail({
      to: user.email,
      subject: 'Your Falisha Jobs Portal Login Credentials',
      html: emailHtml,
      text: `Welcome to Falisha Jobs Portal!\n\nLogin URL: ${portalUrl}\nEmail: ${user.email}\nPassword: ${password}\n\nPlease change your password after first sign-in.`,
    });
    console.log(`[Auth] ✅ Credentials email sent to ${user.email}`);
  } catch (err: any) {
    console.error(`[Auth] ⚠️ Failed to send credentials email to ${user.email}:`, err?.message);
  }

  if (user.phone) {
    const waPhone = toWhatsAppPhone(user.phone);
    const waText = `Welcome to Falisha Jobs Portal! 🎉\n\nHi ${displayName}, your ${roleLabel} account is ready.\n\n🔗 Login: ${portalUrl}\n📧 Email: ${user.email}\n🔑 Password: ${password}\n\nPlease change your password after first login.`;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (phoneNumberId && accessToken && waPhone) {
      try {
        await sendMessage(phoneNumberId, accessToken, waPhone, waText);
        console.log(`[Auth] ✅ Credentials WhatsApp sent to ${waPhone}`);
      } catch (err: any) {
        console.error(`[Auth] ⚠️ Failed to send credentials WhatsApp to ${waPhone}:`, err?.message);
      }
    }
  }
}

router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const profile = await getUserProfile(user.id);
  res.json({ user: profile });
});

router.get('/portal-profile', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const profile = await getPortalProfile(user.id);
    return res.json({
      role: user.role,
      linkedCandidateId: profile.linkedCandidate?.id || user.linkedCandidateId || null,
      profile,
    });
  } catch (error: any) {
    console.error('Error fetching portal profile:', error);
    return res.status(500).json({ error: error.message || 'Failed to load portal profile' });
  }
});

router.patch('/portal-profile', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      name,
      email,
      phone,
      company_name,
      city_country,
      partner_type,
      contact_name,
      country,
      city,
      professions,
      quantity,
      salary_range,
      duty_hours,
      contract_duration,
      benefits_included,
      comments,
    } = req.body ?? {};

    const nextName = name === undefined ? undefined : String(name || '').trim();
    const nextEmail = email === undefined ? undefined : String(email || '').trim().toLowerCase();
    const nextPhone = phone === undefined ? undefined : String(phone || '').trim();
    const nextCompanyName = company_name === undefined ? undefined : String(company_name || '').trim();
    const nextCityCountry = city_country === undefined ? undefined : String(city_country || '').trim();
    const nextPartnerType = partner_type === undefined ? undefined : String(partner_type || '').trim();
    const nextContactName = contact_name === undefined ? undefined : String(contact_name || '').trim();
    const nextCountry = country === undefined ? undefined : String(country || '').trim();
    const nextCity = city === undefined ? undefined : String(city || '').trim();
    const nextProfessions = professions === undefined ? undefined : String(professions || '').trim();
    const nextQuantity = quantity === undefined ? undefined : String(quantity || '').trim();
    const nextSalaryRange = salary_range === undefined ? undefined : String(salary_range || '').trim();
    const nextDutyHours = duty_hours === undefined ? undefined : String(duty_hours || '').trim();
    const nextContractDuration = contract_duration === undefined ? undefined : String(contract_duration || '').trim();
    const nextBenefitsIncluded = benefits_included === undefined ? undefined : String(benefits_included || '').trim();
    const nextComments = comments === undefined ? undefined : String(comments || '').trim();

    if (nextEmail !== undefined && !nextEmail) {
      return res.status(400).json({ error: 'Email cannot be empty' });
    }

    if (nextName !== undefined && !nextName) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }

    const existingUser = await getUserById(user.id);
    const currentEmail = existingUser?.email || user.email || null;
    const currentRole = existingUser?.role || user.role || 'candidate';
    const currentStatus = existingUser?.status || 'Active';

    const updatedUser = existingUser
      ? await updateAppUserProfile(user.id, {
          email: nextEmail,
          name: nextName,
          phone: nextPhone,
        })
      : await upsertAppUserProfile({
          id: user.id,
          email: nextEmail || currentEmail || `${user.id}@portal.local`,
          role: currentRole,
          name: nextName || null,
          phone: nextPhone || null,
          status: currentStatus,
        });

    const supabase = supabaseAdminClient();
    const { data: authUserResult } = await supabase.auth.admin.getUserById(user.id);
    const currentMetadata = authUserResult?.user?.user_metadata || {};

    await supabase.auth.admin.updateUserById(user.id, {
      email: nextEmail || undefined,
      user_metadata: {
        ...currentMetadata,
        name: updatedUser.name,
        phone: updatedUser.phone,
        role: updatedUser.role,
      },
    });

    if (updatedUser.role === 'partner') {
      const portalProfile = await getPortalProfile(user.id);
      const fallbackPartnerApplication = portalProfile.partnerApplication?.id
        ? portalProfile.partnerApplication
        : await getLatestPartnerApplicationForUser(
            user.id,
            nextEmail || currentEmail,
            nextPhone !== undefined ? nextPhone : updatedUser.phone,
          );
      const partnerApplicationId = fallbackPartnerApplication?.id;

      if (partnerApplicationId) {
        const partnerUpdates: Record<string, any> = {
          updated_at: new Date().toISOString(),
          user_id: user.id,
        };

        if (nextCompanyName !== undefined) partnerUpdates.company_name = nextCompanyName || null;
        if (nextCityCountry !== undefined) partnerUpdates.city_country = nextCityCountry || null;
        if (nextPartnerType !== undefined) partnerUpdates.partner_type = nextPartnerType || null;
        if (nextPhone !== undefined) partnerUpdates.phone_number = nextPhone || null;
        if (nextEmail !== undefined) partnerUpdates.email = nextEmail || null;

        if (Object.keys(partnerUpdates).length > 1) {
          let { error: partnerUpdateError } = await supabase
            .from('partner_applications')
            .update(partnerUpdates)
            .eq('id', partnerApplicationId);

          if (partnerUpdateError && isMissingColumnError(partnerUpdateError, 'user_id')) {
            delete partnerUpdates.user_id;
            ({ error: partnerUpdateError } = await supabase
              .from('partner_applications')
              .update(partnerUpdates)
              .eq('id', partnerApplicationId));
          }

          if (partnerUpdateError) {
            throw partnerUpdateError;
          }
        }
      }
    }

    if (updatedUser.role === 'employer') {
      const portalProfile = await getPortalProfile(user.id);
      const employerLeadId = portalProfile.employerLead?.id || null;

      const employerUpdates: Record<string, any> = {
        updated_at: new Date().toISOString(),
        user_id: user.id,
      };

      if (nextCompanyName !== undefined) employerUpdates.company_name = nextCompanyName || null;
      if (nextContactName !== undefined) employerUpdates.contact_name = nextContactName || null;
      if (nextPhone !== undefined) employerUpdates.phone_number = nextPhone || null;
      if (nextEmail !== undefined) employerUpdates.email = nextEmail || null;
      if (nextCountry !== undefined) employerUpdates.country = nextCountry || null;
      if (nextCity !== undefined) employerUpdates.city = nextCity || null;
      if (nextProfessions !== undefined) employerUpdates.professions = nextProfessions || null;
      if (nextQuantity !== undefined) employerUpdates.quantity = nextQuantity || null;
      if (nextSalaryRange !== undefined) employerUpdates.salary_range = nextSalaryRange || null;
      if (nextDutyHours !== undefined) employerUpdates.duty_hours = nextDutyHours || null;
      if (nextContractDuration !== undefined) employerUpdates.contract_duration = nextContractDuration || null;
      if (nextBenefitsIncluded !== undefined) employerUpdates.benefits_included = nextBenefitsIncluded || null;
      if (nextComments !== undefined) employerUpdates.comments = nextComments || null;

      if (employerLeadId) {
        let { error: employerUpdateError } = await supabase
          .from('employer_leads')
          .update(employerUpdates)
          .eq('id', employerLeadId);

        if (employerUpdateError && isMissingColumnError(employerUpdateError, 'user_id')) {
          delete employerUpdates.user_id;
          ({ error: employerUpdateError } = await supabase
            .from('employer_leads')
            .update(employerUpdates)
            .eq('id', employerLeadId));
        }

        if (employerUpdateError) {
          throw employerUpdateError;
        }
      } else {
        // No employer_lead yet — create a shell record so Company Profile and requirements work
        const createPayload: Record<string, any> = {
          user_id: user.id,
          email: employerUpdates.email || updatedUser.email || user.email || null,
          phone_number: employerUpdates.phone_number || null,
          company_name: employerUpdates.company_name || null,
          contact_name: employerUpdates.contact_name || updatedUser.name || null,
          country: employerUpdates.country || null,
          city: employerUpdates.city || null,
          status: 'New',
        };
        const { error: createError } = await supabase.from('employer_leads').insert(createPayload);
        if (createError) {
          console.error('Failed to create employer_lead shell:', createError.message);
          // non-fatal — profile update still succeeded
        }
      }
    }

    const refreshedProfile = await getPortalProfile(user.id);
    return res.json({
      role: updatedUser.role,
      linkedCandidateId: refreshedProfile.linkedCandidate?.id || user.linkedCandidateId || null,
      profile: refreshedProfile,
    });
  } catch (error: any) {
    console.error('Error updating portal profile:', error);
    return res.status(500).json({ error: error.message || 'Failed to update portal profile' });
  }
});

// ── Employer: list all requirements ──────────────────────────────────────────
router.get('/portal-requirements', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== 'employer') return res.status(403).json({ error: 'Only employer accounts can access requirements' });

    const db = supabaseAdminClient();

    const { data: userData } = await db.from('users').select('email').eq('id', user.id).single();
    const email = userData?.email || '';

    const query = db
      .from('employer_leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (email) {
      query.or(`user_id.eq.${user.id},email.eq.${email}`);
    } else {
      query.eq('user_id', user.id);
    }

    const { data: requirements, error } = await query;
    if (error) throw error;

    return res.json({ requirements: requirements || [] });
  } catch (error: any) {
    console.error('Error listing employer requirements:', error);
    return res.status(500).json({ error: error.message || 'Failed to list requirements' });
  }
});

// ── Employer: post new requirement ───────────────────────────────────────────
router.post('/portal-requirements', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== 'employer') return res.status(403).json({ error: 'Only employer accounts can post requirements' });

    const db = supabaseAdminClient();

    const { data: userData } = await db.from('users').select('email, name, phone').eq('id', user.id).single();

    // Look up employer_lead by user_id first, then fall back to email match
    let lead: { company_name: string | null; contact_name: string | null; email: string | null; phone_number: string | null } | null = null;
    const { data: leadByUserId } = await db
      .from('employer_leads')
      .select('company_name, contact_name, email, phone_number')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (leadByUserId) {
      lead = leadByUserId;
    } else if (userData?.email) {
      const { data: leadByEmail } = await db
        .from('employer_leads')
        .select('company_name, contact_name, email, phone_number')
        .eq('email', userData.email)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      lead = leadByEmail || null;
    }

    const { professions, quantity, country, city, salary_range, duty_hours, contract_duration, benefits_included, comments } = req.body;

    if (!professions || !String(professions).trim()) {
      return res.status(400).json({ error: 'Role / professions required is required' });
    }

    const { data: requirement, error } = await db
      .from('employer_leads')
      .insert({
        company_name: lead?.company_name || null,
        contact_name: lead?.contact_name || userData?.name || null,
        email: lead?.email || userData?.email || null,
        phone_number: lead?.phone_number || userData?.phone || null,
        user_id: user.id,
        country: country ? String(country).trim() : null,
        city: city ? String(city).trim() : null,
        professions: String(professions).trim(),
        quantity: quantity ? String(quantity).trim() : null,
        salary_range: salary_range ? String(salary_range).trim() : null,
        duty_hours: duty_hours ? String(duty_hours).trim() : null,
        contract_duration: contract_duration ? String(contract_duration).trim() : null,
        benefits_included: benefits_included ? String(benefits_included).trim() : null,
        comments: comments ? String(comments).trim() : null,
        status: 'New',
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ requirement });
  } catch (error: any) {
    console.error('Error creating employer requirement:', error);
    return res.status(500).json({ error: error.message || 'Failed to create requirement' });
  }
});

router.post('/candidate-profile/bootstrap', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (user.role !== 'candidate') {
      return res.status(403).json({ error: 'Only candidate users can bootstrap a candidate profile' });
    }

    const supabase = supabaseAdminClient();
    const { data: authUserResult, error: authUserError } = await supabase.auth.admin.getUserById(user.id);
    if (authUserError || !authUserResult.user) {
      return res.status(404).json({ error: authUserError?.message || 'Authenticated user not found' });
    }

    const candidate = await bootstrapCandidateProfileForAuthUser({
      id: authUserResult.user.id,
      email: authUserResult.user.email || null,
      user_metadata: authUserResult.user.user_metadata || null,
    });

    return res.json({ candidate });
  } catch (error: any) {
    console.error('Error bootstrapping candidate profile:', error);
    return res.status(500).json({ error: error.message || 'Failed to bootstrap candidate profile' });
  }
});

router.get('/partner/candidates', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (user.role !== 'partner') {
      return res.status(403).json({ error: 'Only partner users can view partner submissions' });
    }

    const db = supabaseAdminClient();
    const { data: taggedData, error: taggedError } = await db
      .from('candidates')
      .select('id,candidate_code,name,status,source,email,phone,cnic_normalized,passport_normalized,position,country_of_interest,partner_id,partner_name,is_partner_candidate,created_at')
      .eq('partner_id', user.id)
      .neq('status', 'Deleted')
      .order('created_at', { ascending: false })
      .limit(20);

    if (taggedError) {
      throw taggedError;
    }

    const { data: legacyData, error: legacyError } = await db
      .from('candidates')
      .select('id,candidate_code,name,status,source,email,phone,cnic_normalized,passport_normalized,position,country_of_interest,partner_id,partner_name,is_partner_candidate,created_at')
      .ilike('source', `Partner|${user.id}|%`)
      .neq('status', 'Deleted')
      .order('created_at', { ascending: false })
      .limit(20);

    if (legacyError) {
      throw legacyError;
    }

    const uniqueCandidates = Array.from(new Map([...(taggedData || []), ...(legacyData || [])].map((candidate: any) => [candidate.id, mapCandidateIdentityFields(candidate)])).values());

    return res.json({ candidates: uniqueCandidates.slice(0, 20) });
  } catch (error: any) {
    console.error('Error fetching partner candidates:', error);
    return res.status(500).json({ error: error.message || 'Failed to load partner candidates' });
  }
});

router.post('/partner/candidates', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (user.role !== 'partner') {
      return res.status(403).json({ error: 'Only partner users can submit candidates' });
    }

    const payload = (req.body ?? {}) as Partial<CreateCandidateData>;
    const name = String(payload.name || '').trim();
    const email = String(payload.email || '').trim();
    const phone = String(payload.phone || '').trim();

    if (!name) {
      return res.status(400).json({ error: 'Candidate name is required' });
    }

    if (!String(payload.cnic || payload.passport || '').trim()) {
      return res.status(400).json({ error: 'CNIC / Passport is required' });
    }

    if (!phone) {
      return res.status(400).json({ error: 'Phone is required' });
    }

    const portalProfile = await getPortalProfile(user.id);
    const partnerName = portalProfile.user?.name || user.email || 'Partner';
    const partnerCompany = portalProfile.partnerApplication?.company_name || null;

    const result = await upsertPartnerCandidate(
      {
        name,
        email: email && !isGovernmentEmail(email) ? email : undefined,
        phone: phone || undefined,
        cnic: String(payload.cnic || '').trim() || undefined,
        passport: String(payload.passport || '').trim() || undefined,
        position: typeof payload.position === 'string' ? payload.position : undefined,
        country_of_interest: typeof payload.country_of_interest === 'string' ? payload.country_of_interest : undefined,
        nationality: typeof payload.nationality === 'string' ? payload.nationality : undefined,
        address: typeof payload.address === 'string' ? payload.address : undefined,
      },
      {
        partnerId: user.id,
        partnerName,
        partnerCompany,
      },
    );

    return res.status(result.created ? 201 : 200).json({
      candidate: mapCandidateIdentityFields(result.candidate),
      created: result.created,
      matchedBy: result.matchedBy,
      updatedFields: result.updatedFields,
    });
  } catch (error: any) {
    console.error('Error creating partner candidate:', error);
    return res.status(400).json({ error: error.message || 'Failed to submit partner candidate' });
  }
});

router.post(
  '/partner/candidates/:candidateId/documents',
  authenticate,
  bulkUpload.single('file'),
  async (req: AuthRequest, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (user.role !== 'partner') return res.status(403).json({ error: 'Only partner users can upload partner documents' });
      if (!req.file) return res.status(400).json({ error: 'File is required' });

      const portalProfile = await getPortalProfile(user.id);
      const partnerName = portalProfile.user?.name || user.email || 'Partner';
      const partnerCompany = portalProfile.partnerApplication?.company_name || null;
      const document = await uploadPartnerManualDocument({
        candidateId: req.params.candidateId,
        partner: {
          partnerId: user.id,
          partnerName,
          partnerCompany,
        },
        requestedType: String(req.body?.document_type || '').trim() || undefined,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });

      return res.status(201).json({
        success: true,
        document,
        message: 'Document uploaded successfully.',
      });
    } catch (error: any) {
      console.error('Error uploading partner candidate document:', error);
      return res.status(400).json({ error: error.message || 'Failed to upload partner document' });
    }
  },
);

router.post(
  '/partner/candidates/bulk',
  authenticate,
  bulkUpload.fields([{ name: 'excel', maxCount: 1 }, { name: 'zip', maxCount: 1 }]),
  async (req: AuthRequest, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (user.role !== 'partner') return res.status(403).json({ error: 'Only partner users can bulk upload candidates' });

      const files = req.files as Record<string, Express.Multer.File[]>;
      const excelFile = files?.excel?.[0];
      if (!excelFile) return res.status(400).json({ error: 'Excel file is required' });

      // Parse Excel
      const workbook = XLSX.read(excelFile.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });

      if (rows.length === 0) return res.status(400).json({ error: 'Excel file contains no data rows' });
      if (rows.length > 500) return res.status(400).json({ error: 'Maximum 500 candidates per bulk upload' });

      const zipFile = files?.zip?.[0];
      const zipEntries = zipFile
        ? new AdmZip(zipFile.buffer).getEntries().filter((entry) => !entry.isDirectory).map((entry) => ({
            entry,
            token: entry.entryName
              .split('/')
              .pop()
              ?.replace(/\.[^.]+$/, '')
              .replace(/[^0-9a-z]/gi, '')
              .toLowerCase() || '',
          }))
        : [];

      const portalProfile = await getPortalProfile(user.id);
      const partnerName = portalProfile.user?.name || user.email || 'Partner';
      const partnerCompany = portalProfile.partnerApplication?.company_name || null;
      const partnerContext = {
        partnerId: user.id,
        partnerName,
        partnerCompany,
      };

      const created: any[] = [];
      let updated = 0;
      const errors: Array<{ row: number; name?: string; cnic?: string; error: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row['Name'] || row['name'] || row['NAME'] || '').trim();
        const cnic = String(row['CNIC/Passport'] || row['CNIC'] || row['cnic'] || row['Passport'] || '').trim();
        const phone = String(row['Phone'] || row['phone'] || row['PHONE'] || '').trim();
        const email = String(row['Email'] || row['email'] || row['EMAIL'] || '').trim();

        if (!name) { errors.push({ row: i + 2, error: 'Name is required' }); continue; }
        if (!cnic) { errors.push({ row: i + 2, name, error: 'CNIC/Passport is required' }); continue; }
        if (!phone) { errors.push({ row: i + 2, name, error: 'Phone is required' }); continue; }

        try {
          const result = await upsertPartnerCandidate(
            {
              name,
              cnic: cnic || undefined,
              phone: phone || undefined,
              email: (email && !isGovernmentEmail(email)) ? email : undefined,
            },
            partnerContext,
          );
          if (!result.created) {
            updated += 1;
          }
          created.push(result.candidate);

          if (zipEntries.length > 0 && cnic) {
            const identityToken = cnic.replace(/[^0-9a-z]/gi, '').toLowerCase();
            const matchedFiles = zipEntries.filter(({ token }) => token && (token.includes(identityToken) || identityToken.includes(token)));
            for (const { entry } of matchedFiles) {
              try {
                await ingestPartnerBulkAttachment({
                  candidateId: result.candidate.id,
                  partner: partnerContext,
                  fileName: entry.entryName.split('/').pop() || entry.entryName,
                  buffer: entry.getData(),
                });
              } catch (fileErr: any) {
                console.warn(`Failed to ingest ZIP file ${entry.entryName} for candidate ${result.candidate.id}:`, fileErr.message);
              }
            }
          }
        } catch (rowErr: any) {
          errors.push({ row: i + 2, name, cnic: cnic || undefined, error: rowErr.message || 'Failed to create candidate' });
        }
      }

      return res.status(201).json({
        total: rows.length,
        created: created.length - updated,
        updated,
        errors,
        candidates: created,
      });
    } catch (error: any) {
      console.error('Bulk partner upload error:', error);
      return res.status(500).json({ error: error.message || 'Bulk upload failed' });
    }
  },
);

router.get('/users', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can view users' });
    }

    const users = await listAppUsers();
    const stats = {
      total: users.length,
      active: users.filter((user) => String(user.status || '').toLowerCase() === 'active').length,
      admins: users.filter((user) => user.role === 'admin').length,
      workers: users.filter((user) => user.role === 'worker').length,
      candidates: users.filter((user) => user.role === 'candidate').length,
      partners: users.filter((user) => user.role === 'partner').length,
      employers: users.filter((user) => user.role === 'employer').length,
    };

    return res.json({ users, stats });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch users' });
  }
});

router.patch('/users/:userId', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update users' });
    }

    const { userId } = req.params;
    const { role, status, name, phone, department, email } = req.body ?? {};

    const existingUser = await getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (role !== undefined && !['admin', 'worker', 'candidate', 'partner', 'employer'].includes(normalizeAppRole(role))) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    if (status !== undefined && !VALID_STATUSES.includes(String(status))) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updatedUser = await updateAppUserProfile(userId, {
      email,
      role,
      status,
      name,
      phone,
      department,
    });

    const supabase = supabaseAdminClient();
    const token = getBearerToken(req);

    if (token) {
      try {
        const { data: authUserResult } = await supabase.auth.admin.getUserById(userId);
        const currentMetadata = authUserResult?.user?.user_metadata || {};

        await supabase.auth.admin.updateUserById(userId, {
          email: email || undefined,
          user_metadata: {
            ...currentMetadata,
            name: updatedUser.name,
            phone: updatedUser.phone,
            department: updatedUser.department,
            role: updatedUser.role,
          },
        });
      } catch (metadataError) {
        console.warn('Failed to sync auth metadata for updated user:', metadataError);
      }
    }

    return res.json({ user: updatedUser });
  } catch (error: any) {
    console.error('Error updating user:', error);
    return res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

router.post('/users', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create users' });
    }

    const {
      email,
      password,
      role,
      name,
      phone,
      department,
      status,
      candidateId,
    } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedRole = normalizeAppRole(role);
    if (!['admin', 'worker', 'candidate', 'partner', 'employer'].includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    if (normalizedRole === 'candidate' && !candidateId) {
      return res.status(400).json({ error: 'candidateId is required when creating a candidate account' });
    }

    if (status !== undefined && !VALID_STATUSES.includes(String(status))) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const supabase = supabaseAdminClient();
    const { firstName, lastName } = splitDisplayName(name);

    let linkedCandidate: any = null;
    if (normalizedRole === 'candidate' && candidateId) {
      const { data: candidate, error: candidateError } = await supabase
        .from('candidates')
        .select('id,name,email,phone,user_id')
        .eq('id', candidateId)
        .maybeSingle();

      if (candidateError) {
        return res.status(400).json({ error: candidateError.message });
      }

      if (!candidate) {
        return res.status(404).json({ error: 'Linked candidate not found' });
      }

      if (candidate.user_id) {
        return res.status(409).json({ error: 'That candidate is already linked to another user' });
      }

      linkedCandidate = candidate;
    }

    const createEmail = linkedCandidate?.email || email;
    const createName = name || linkedCandidate?.name || null;
    const createPhone = phone || linkedCandidate?.phone || null;

    const { data, error } = await supabase.auth.admin.createUser({
      email: createEmail,
      password,
      email_confirm: true,
      user_metadata: {
        firstName,
        lastName,
        name: createName,
        phone: createPhone,
        department: department || null,
        role: normalizedRole,
        linkedCandidateId: linkedCandidate?.id || null,
      },
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const userRecord = await upsertAppUserProfile({
      id: data.user.id,
      email: data.user.email || createEmail,
      role: normalizedRole,
      name: createName,
      phone: createPhone,
      department: department || null,
      status: status || 'Active',
    });

    if (normalizedRole === 'candidate' && linkedCandidate?.id) {
      const { error: linkError } = await supabase
        .from('candidates')
        .update({ user_id: data.user.id })
        .eq('id', linkedCandidate.id)
        .is('user_id', null);

      if (linkError) {
        await supabase.auth.admin.deleteUser(data.user.id).catch(() => undefined);
        await deleteAppUserProfile(data.user.id).catch(() => undefined);
        return res.status(400).json({ error: linkError.message || 'Failed to link candidate account' });
      }
    }

    // Fire-and-forget credential notification (non-blocking)
    dispatchWelcomeCredentials({
      name: createName,
      email: createEmail,
      phone: createPhone,
      role: normalizedRole,
    }, password).catch((err: any) => console.error('[Auth] dispatchWelcomeCredentials failed:', err?.message));

    return res.status(201).json({
      message: 'User created successfully',
      user: userRecord,
    });
  } catch (error: any) {
    console.error('Error creating user:', error);
    return res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

// ── Resend / reset credentials for an existing user ──────────────────────────
router.post('/users/:userId/send-credentials', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can send credentials' });
    }

    const { userId } = req.params;
    const existingUser = await getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate a new temporary password and reset it via Supabase Auth
    const tempPassword = 'Falisha@' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const supabase = supabaseAdminClient();
    const { error: resetError } = await supabase.auth.admin.updateUserById(userId, {
      password: tempPassword,
    });
    if (resetError) {
      return res.status(400).json({ error: resetError.message || 'Failed to reset password' });
    }

    await dispatchWelcomeCredentials({
      name: existingUser.name,
      email: existingUser.email,
      phone: existingUser.phone,
      role: existingUser.role,
    }, tempPassword);

    return res.json({
      message: 'Credentials sent successfully',
      sentTo: {
        email: existingUser.email,
        whatsapp: existingUser.phone ? toWhatsAppPhone(existingUser.phone) : null,
      },
    });
  } catch (error: any) {
    console.error('Error sending credentials:', error);
    return res.status(500).json({ error: error.message || 'Failed to send credentials' });
  }
});

router.delete('/users/:userId', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete users' });
    }

    const { userId } = req.params;

    if (req.user.id === userId) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const existingUser = await getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const supabase = supabaseAdminClient();

    const { error: unlinkError } = await supabase
      .from('candidates')
      .update({ user_id: null })
      .eq('user_id', userId);

    if (unlinkError) {
      return res.status(400).json({ error: unlinkError.message || 'Failed to unlink candidate account' });
    }

    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      return res.status(400).json({ error: deleteAuthError.message });
    }

    await deleteAppUserProfile(userId);

    return res.json({
      message: 'User deleted successfully',
      deletedUserId: userId,
    });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    return res.status(500).json({ error: error.message || 'Failed to delete user' });
  }
});

// Register/Create worker account (legacy route name kept for compatibility)
router.post('/register-employee', async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const supabase = supabaseAdminClient();

    // Create user in Supabase with worker role
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        firstName,
        lastName,
        phone,
        role: 'worker'
      }
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    await upsertAppUserProfile({
      id: data.user.id,
      email: data.user.email || email,
      role: 'worker',
      name: buildDisplayName(firstName, lastName),
      phone,
      status: 'Active',
    });

    // Return created user info
    res.status(201).json({
      message: 'Worker account created successfully',
      user: {
        id: data.user.id,
        email: data.user.email,
        role: 'worker'
      }
    });
  } catch (error: any) {
    console.error('Error creating employee account:', error);
    res.status(500).json({ error: 'Failed to create employee account' });
  }
});

// Seed demo employee accounts
router.post('/seed-demo-employees', async (req, res) => {
  try {
    const demoEmployees = [
      {
        email: 'employee1@falisha.com',
        password: 'employee123',
        firstName: 'Ahmed',
        lastName: 'Khan',
        phone: '+971501234567'
      },
      {
        email: 'employee2@falisha.com',
        password: 'employee123',
        firstName: 'Fatima',
        lastName: 'Ali',
        phone: '+971502345678'
      },
      {
        email: 'employee3@falisha.com',
        password: 'employee123',
        firstName: 'Mohammad',
        lastName: 'Hassan',
        phone: '+971503456789'
      }
    ];

    const supabase = supabaseAdminClient();
    const results = [];

    for (const employee of demoEmployees) {
      try {
        const { data, error } = await supabase.auth.admin.createUser({
          email: employee.email,
          password: employee.password,
          email_confirm: true,
          user_metadata: {
            firstName: employee.firstName,
            lastName: employee.lastName,
            phone: employee.phone,
            role: 'worker'
          }
        });

        if (error) {
          results.push({
            email: employee.email,
            success: false,
            message: error.message
          });
        } else {
          await upsertAppUserProfile({
            id: data.user.id,
            email: data.user.email || employee.email,
            role: 'worker',
            name: buildDisplayName(employee.firstName, employee.lastName),
            phone: employee.phone,
            status: 'Active',
          });

          results.push({
            email: employee.email,
            success: true,
            userId: data.user.id
          });
        }
      } catch (err: any) {
        results.push({
          email: employee.email,
          success: false,
          message: err.message
        });
      }
    }

    res.json({ message: 'Demo employees seeding complete', results });
  } catch (error: any) {
    console.error('Error seeding demo employees:', error);
    res.status(500).json({ error: 'Failed to seed demo employees' });
  }
});

// Change employee password (admin only)
router.post('/change-employee-password', authenticate, async (req: AuthRequest, res) => {
  try {
    const { employeeId, newPassword } = req.body;

    if (!employeeId || !newPassword) {
      return res.status(400).json({ error: 'Employee ID and new password are required' });
    }

    // Verify requester is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change employee passwords' });
    }

    const supabase = supabaseAdminClient();

    // Update user password via admin API
    const { error } = await supabase.auth.admin.updateUserById(employeeId, {
      password: newPassword
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Employee password updated successfully'
    });
  } catch (error: any) {
    console.error('Error changing employee password:', error);
    res.status(500).json({ error: 'Failed to change employee password' });
  }
});

// Delete employee account (admin only)
router.post('/delete-employee', authenticate, async (req: AuthRequest, res) => {
  try {
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    // Verify requester is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete employees' });
    }

    const supabase = supabaseAdminClient();

    // Delete user via admin API
    const { error } = await supabase.auth.admin.deleteUser(employeeId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Employee account deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// Get all employees (admin only)
router.get('/employees', authenticate, async (req: AuthRequest, res) => {
  try {
    // Verify requester is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can view all employees' });
    }

    const supabase = supabaseAdminClient();

    const { data: users, error } = await supabase.from('users').select('*');

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const employees = (users || [])
      .filter((user) => normalizeAppRole(user.role) === 'worker')
      .map((user) => ({
        id: user.id,
        email: user.email,
        firstName: String(user.name || '').split(' ').slice(0, 1).join(' '),
        lastName: String(user.name || '').split(' ').slice(1).join(' '),
        phone: user.phone || '',
        role: normalizeAppRole(user.role),
        status: user.status || 'Active',
        createdAt: user.created_at
      }));

    res.json({
      count: employees.length,
      employees
    });
  } catch (error: any) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// Seed/initialize admin user with proper role metadata
router.post('/seed-admin', async (req, res) => {
  try {
    const adminEmail = 'admin@falisha.com';
    const adminPassword = 'admin123';

    const supabase = supabaseAdminClient();

    // First, check if admin user already exists
    const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) {
      return res.status(400).json({ error: listError.message });
    }

    const adminUser = existingUsers.users.find(u => u.email === adminEmail);

    if (adminUser) {
      // Update existing admin user with role metadata
      const { error: updateError } = await supabase.auth.admin.updateUserById(adminUser.id, {
        user_metadata: {
          ...adminUser.user_metadata,
          role: 'admin'
        }
      });

      if (updateError) {
        return res.status(400).json({ error: updateError.message });
      }

      await upsertAppUserProfile({
        id: adminUser.id,
        email: adminUser.email || adminEmail,
        role: 'admin',
        name: buildDisplayName(adminUser.user_metadata?.firstName, adminUser.user_metadata?.lastName) || adminUser.user_metadata?.name || null,
        phone: adminUser.user_metadata?.phone || null,
        status: 'Active',
      });

      return res.json({
        message: 'Admin user updated with admin role',
        user: {
          id: adminUser.id,
          email: adminUser.email,
          role: 'admin'
        }
      });
    } else {
      // Create new admin user
      const { data, error: createError } = await supabase.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
        user_metadata: {
          role: 'admin'
        }
      });

      if (createError) {
        return res.status(400).json({ error: createError.message });
      }

      await upsertAppUserProfile({
        id: data.user.id,
        email: data.user.email || adminEmail,
        role: 'admin',
        name: buildDisplayName(data.user.user_metadata?.firstName, data.user.user_metadata?.lastName) || data.user.user_metadata?.name || null,
        phone: data.user.user_metadata?.phone || null,
        status: 'Active',
      });

      return res.status(201).json({
        message: 'Admin account created successfully',
        user: {
          id: data.user.id,
          email: data.user.email,
          role: 'admin'
        }
      });
    }
  } catch (error: any) {
    console.error('Error seeding admin user:', error);
    res.status(500).json({ error: 'Failed to seed admin user' });
  }
});

// ── Mobile app: update agent online status ──────────────────────────────────
router.patch('/agent-status', authenticate, async (req: AuthRequest, res) => {
  try {
    const { is_online } = req.body ?? {};
    if (typeof is_online !== 'boolean') {
      return res.status(400).json({ error: 'is_online (boolean) is required' });
    }
    const supabase = supabaseAdminClient();
    const { error } = await supabase.auth.admin.updateUserById(req.user!.id, {
      user_metadata: { ...req.user, is_online },
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true, is_online });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to update agent status' });
  }
});

// ── Mobile app: register Expo push token ───────────────────────────────────
router.post('/push-token', authenticate, async (req: AuthRequest, res) => {
  try {
    const { token } = req.body ?? {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token (string) is required' });
    }
    const supabase = supabaseAdminClient();
    const { error } = await supabase.auth.admin.updateUserById(req.user!.id, {
      user_metadata: { ...req.user, expo_push_token: token },
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to register push token' });
  }
});

export default router;
