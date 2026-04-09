import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import { authenticate, AuthRequest } from '../middleware/auth';
import { bootstrapCandidateProfileForAuthUser, deleteAppUserProfile, getPortalProfile, getUserById, getUserProfile, listAppUsers, normalizeAppRole, updateAppUserProfile, upsertAppUserProfile } from '../services/userService';
import { createCandidate, type CreateCandidateData } from '../services/candidateService';
import { isGovernmentEmail } from '../services/progressiveDataCompletionService';
import { supabaseAdminClient } from '../config/database';

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

function sanitizePartnerToken(value?: string | null) {
  return String(value || '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPartnerCandidateSource(userId: string, partnerName?: string | null, companyName?: string | null) {
  const safeName = sanitizePartnerToken(partnerName) || 'Partner';
  const safeCompany = sanitizePartnerToken(companyName);
  return `Partner|${userId}|${safeName}|${safeCompany}`;
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
    } = req.body ?? {};

    const nextName = name === undefined ? undefined : String(name || '').trim();
    const nextEmail = email === undefined ? undefined : String(email || '').trim().toLowerCase();
    const nextPhone = phone === undefined ? undefined : String(phone || '').trim();
    const nextCompanyName = company_name === undefined ? undefined : String(company_name || '').trim();
    const nextCityCountry = city_country === undefined ? undefined : String(city_country || '').trim();
    const nextPartnerType = partner_type === undefined ? undefined : String(partner_type || '').trim();

    if (nextEmail !== undefined && !nextEmail) {
      return res.status(400).json({ error: 'Email cannot be empty' });
    }

    if (nextName !== undefined && !nextName) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }

    const existingUser = await getUserById(user.id);
    const currentEmail = existingUser?.email || user.email || null;
    const currentRole = existingUser?.role || user.role;
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
      const partnerApplicationId = portalProfile.partnerApplication?.id;

      if (partnerApplicationId) {
        const partnerUpdates: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };

        if (nextCompanyName !== undefined) partnerUpdates.company_name = nextCompanyName || null;
        if (nextCityCountry !== undefined) partnerUpdates.city_country = nextCityCountry || null;
        if (nextPartnerType !== undefined) partnerUpdates.partner_type = nextPartnerType || null;
        if (nextPhone !== undefined) partnerUpdates.phone_number = nextPhone || null;
        if (nextEmail !== undefined) partnerUpdates.email = nextEmail || null;

        if (Object.keys(partnerUpdates).length > 1) {
          const { error: partnerUpdateError } = await supabase
            .from('partner_applications')
            .update(partnerUpdates)
            .eq('id', partnerApplicationId);

          if (partnerUpdateError) {
            throw partnerUpdateError;
          }
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
    const { data, error } = await db
      .from('candidates')
      .select('id,candidate_code,name,status,source,email,phone,cnic,passport,position,country_of_interest,created_at')
      .ilike('source', `Partner|${user.id}|%`)
      .neq('status', 'Deleted')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      throw error;
    }

    return res.json({ candidates: data || [] });
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

    if (!email && !phone) {
      return res.status(400).json({ error: 'Provide at least an email or phone number for the candidate' });
    }

    const portalProfile = await getPortalProfile(user.id);
    const partnerName = portalProfile.user?.name || user.email || 'Partner';
    const partnerCompany = portalProfile.partnerApplication?.company_name || null;

    const candidateData: CreateCandidateData = {
      name,
      email: email || undefined,
      phone: phone || undefined,
      cnic: String(payload.cnic || '').trim() || undefined,
      passport: String(payload.passport || '').trim() || undefined,
      position: payload.position,
      country_of_interest: payload.country_of_interest,
      nationality: payload.nationality,
      address: payload.address,
      status: 'Applied',
      source: buildPartnerCandidateSource(user.id, partnerName, partnerCompany),
    };

    if (candidateData.email && isGovernmentEmail(candidateData.email)) {
      candidateData.email = undefined;
    }

    const candidate = await createCandidate(candidateData, user.id);
    return res.status(201).json({ candidate });
  } catch (error: any) {
    console.error('Error creating partner candidate:', error);
    return res.status(400).json({ error: error.message || 'Failed to submit partner candidate' });
  }
});

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

      // Extract ZIP entries indexed by cnic prefix
      const zipEntries = new Map<string, { buffer: Buffer; filename: string }[]>();
      const zipFile = files?.zip?.[0];
      if (zipFile) {
        const zip = new AdmZip(zipFile.buffer);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const fname = entry.name.toLowerCase();
          // Find which CNIC this file belongs to by matching prefix
          // We'll resolve this per-row below; store all files by first 5 chars as a loose key
          const buf = entry.getData();
          const key = fname.replace(/[^0-9a-z]/g, '').slice(0, 13); // cnic digits prefix
          if (!zipEntries.has(key)) zipEntries.set(key, []);
          zipEntries.get(key)!.push({ buffer: buf, filename: entry.name });
        }
      }

      const portalProfile = await getPortalProfile(user.id);
      const partnerName = portalProfile.user?.name || user.email || 'Partner';
      const partnerCompany = portalProfile.partnerApplication?.company_name || null;
      const source = buildPartnerCandidateSource(user.id, partnerName, partnerCompany);
      const db = supabaseAdminClient();

      const created: any[] = [];
      const errors: Array<{ row: number; name?: string; cnic?: string; error: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row['Name'] || row['name'] || row['NAME'] || '').trim();
        const cnic = String(row['CNIC/Passport'] || row['CNIC'] || row['cnic'] || row['Passport'] || '').trim();
        const phone = String(row['Phone'] || row['phone'] || row['PHONE'] || '').trim();
        const email = String(row['Email'] || row['email'] || row['EMAIL'] || '').trim();

        if (!name) { errors.push({ row: i + 2, error: 'Name is required' }); continue; }
        if (!cnic && !phone && !email) { errors.push({ row: i + 2, name, error: 'Provide CNIC/Passport, phone, or email' }); continue; }

        try {
          const data: CreateCandidateData = {
            name,
            cnic: cnic || undefined,
            phone: phone || undefined,
            email: (email && !isGovernmentEmail(email)) ? email : undefined,
            status: 'Applied',
            source,
          };
          const candidate = await createCandidate(data, user.id);
          created.push(candidate);

          // Match ZIP files to this candidate by cnic digits
          if (zipFile && cnic) {
            const cnicKey = cnic.replace(/[^0-9a-z]/gi, '').toLowerCase().slice(0, 13);
            const matchedFiles = zipEntries.get(cnicKey) || [];
            for (const { buffer, filename } of matchedFiles) {
              const fLower = filename.toLowerCase();
              const isImage = /\.(jpg|jpeg|png)$/i.test(fLower);
              const isPhoto = isImage && (fLower.includes('photo') || fLower.includes('pic') || fLower.includes('image'));
              const isCNICDoc = fLower.includes('passport') || fLower.includes('cnic') || fLower.includes('id_');

              try {
                if (isPhoto) {
                  const ext = filename.split('.').pop() || 'jpg';
                  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
                  const { error: photoError } = await db.storage
                    .from('candidate-photos')
                    .upload(`${candidate.id}/photo.${ext}`, buffer, { contentType: mime, upsert: true });
                  if (photoError) console.warn(`ZIP photo upload for ${candidate.id}:`, photoError.message);
                } else {
                  const docType = isCNICDoc ? 'passport_cnic' : 'cv';
                  const ext = filename.split('.').pop() || 'pdf';
                  const mimeMap: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
                  const mime = mimeMap[ext.toLowerCase()] || 'application/octet-stream';
                  const { error: docError } = await db.storage
                    .from('candidate-documents')
                    .upload(`${candidate.id}/${docType}_${Date.now()}.${ext}`, buffer, { contentType: mime, upsert: false });
                  if (docError) console.warn(`ZIP doc upload for ${candidate.id}:`, docError.message);
                }
              } catch (fileErr: any) {
                console.warn(`Failed to store ZIP file ${filename} for candidate ${candidate.id}:`, fileErr.message);
              }
            }
          }
        } catch (rowErr: any) {
          errors.push({ row: i + 2, name, cnic: cnic || undefined, error: rowErr.message || 'Failed to create candidate' });
        }
      }

      return res.status(201).json({
        total: rows.length,
        created: created.length,
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

    if (role !== undefined && !['admin', 'worker', 'candidate', 'partner'].includes(normalizeAppRole(role))) {
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
    if (!['admin', 'worker', 'candidate', 'partner'].includes(normalizedRole)) {
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

    return res.status(201).json({
      message: 'User created successfully',
      user: userRecord,
    });
  } catch (error: any) {
    console.error('Error creating user:', error);
    return res.status(500).json({ error: error.message || 'Failed to create user' });
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
