import { supabaseAdminClient } from '../config/database';
import { createCandidate } from './candidateService';

export type AppRole = 'admin' | 'worker' | 'candidate' | 'partner';

export type AppUserStatus = 'Active' | 'Inactive' | 'Suspended';

export type AppUserRecord = {
  id: string;
  email: string;
  name: string | null;
  role: AppRole;
  phone: string | null;
  department: string | null;
  status: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_active?: string | null;
};

export type PartnerApplicationRecord = {
  id: string;
  user_id?: string | null;
  phone_number: string | null;
  company_name: string | null;
  city_country: string | null;
  partner_type: string | null;
  email: string | null;
  status: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PortalProfile = {
  user: AppUserRecord | null;
  linkedCandidate: Record<string, any> | null;
  partnerApplication: PartnerApplicationRecord | null;
};

type AuthUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, any> | null;
};

type UpsertAppUserProfileInput = {
  id: string;
  email: string;
  role: string;
  name?: string | null;
  phone?: string | null;
  department?: string | null;
  status?: string | null;
};

type UpdateAppUserProfileInput = {
  email?: string | null;
  role?: string | null;
  name?: string | null;
  phone?: string | null;
  department?: string | null;
  status?: string | null;
};

function buildName(firstName?: string | null, lastName?: string | null) {
  const parts = [firstName, lastName].map((value) => value?.trim()).filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function normalizeEmail(email?: string | null) {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized || null;
}

function isMissingColumnError(error: any, columnName: string) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes(columnName.toLowerCase()) && message.includes('column');
}

async function findUnlinkedCandidateByEmail(email?: string | null) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('candidates')
    .select('*')
    .ilike('email', normalizedEmail)
    .is('user_id', null)
    .order('updated_at', { ascending: false })
    .limit(2);

  if (error) {
    throw error;
  }

  if (!data || data.length !== 1) {
    return null;
  }

  return data[0] as Record<string, any>;
}

export async function ensureCandidateLinkForAuthUser(authUser: AuthUserLike) {
  const db = supabaseAdminClient();
  const { data: linkedCandidate, error: linkedCandidateError } = await db
    .from('candidates')
    .select('*')
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (linkedCandidateError) {
    throw linkedCandidateError;
  }

  if (linkedCandidate) {
    return linkedCandidate as Record<string, any>;
  }

  const emailMatch = await findUnlinkedCandidateByEmail(authUser.email);
  if (!emailMatch?.id) {
    return null;
  }

  const { data: updatedCandidate, error: updateError } = await db
    .from('candidates')
    .update({ user_id: authUser.id })
    .eq('id', emailMatch.id)
    .is('user_id', null)
    .select('*')
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  if (!updatedCandidate) {
    const { data: refetchedCandidate, error: refetchError } = await db
      .from('candidates')
      .select('*')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (refetchError) {
      throw refetchError;
    }

    return refetchedCandidate as Record<string, any> | null;
  }

  await upsertAppUserProfile({
    id: authUser.id,
    email: normalizeEmail(authUser.email) || updatedCandidate.email || `${authUser.id}@candidate.local`,
    role: 'candidate',
    name: buildName(authUser.user_metadata?.firstName, authUser.user_metadata?.lastName) || authUser.user_metadata?.name || updatedCandidate.name || null,
    phone: authUser.user_metadata?.phone || updatedCandidate.phone || null,
    status: 'Active',
  });

  return updatedCandidate as Record<string, any>;
}

export async function bootstrapCandidateProfileForAuthUser(authUser: AuthUserLike) {
  const linkedCandidate = await ensureCandidateLinkForAuthUser(authUser);
  if (linkedCandidate) {
    return linkedCandidate;
  }

  const email = normalizeEmail(authUser.email);
  const name = buildName(authUser.user_metadata?.firstName, authUser.user_metadata?.lastName) || authUser.user_metadata?.name || email?.split('@')[0] || 'Candidate';
  const phone = authUser.user_metadata?.phone || undefined;

  const createdCandidate = await createCandidate({
    name,
    email: email || undefined,
    phone,
    source: 'Form',
    status: 'Pending',
  }, authUser.id);

  const db = supabaseAdminClient();
  const { data: linkedCreatedCandidate, error: linkError } = await db
    .from('candidates')
    .update({ user_id: authUser.id })
    .eq('id', createdCandidate.id)
    .select('*')
    .single();

  if (linkError) {
    throw linkError;
  }

  await upsertAppUserProfile({
    id: authUser.id,
    email: email || createdCandidate.email || `${authUser.id}@candidate.local`,
    role: 'candidate',
    name,
    phone: phone || createdCandidate.phone || null,
    status: 'Active',
  });

  return linkedCreatedCandidate as Record<string, any>;
}

export function normalizeAppRole(role?: string | null): AppRole {
  const normalized = String(role || '').trim().toLowerCase();

  if (normalized === 'admin' || normalized === 'super_admin') {
    return 'admin';
  }

  if (normalized === 'partner') {
    return 'partner';
  }

  if (normalized === 'candidate') {
    return 'candidate';
  }

  if (['worker', 'employee', 'manager', 'recruiter', 'viewer', 'staff'].includes(normalized)) {
    return 'worker';
  }

  return 'candidate';
}

export async function getUserById(userId: string) {
  const db = supabaseAdminClient();
  const { data, error } = await db.from('users').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data as AppUserRecord | null;
}

export async function getUserProfile(userId: string) {
  return getPortalProfile(userId);
}

export async function upsertAppUserProfile(input: UpsertAppUserProfileInput) {
  const db = supabaseAdminClient();
  const payload = {
    id: input.id,
    email: input.email,
    name: input.name || null,
    role: normalizeAppRole(input.role),
    phone: input.phone || null,
    department: input.department || null,
    status: input.status || 'Active',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db.from('users').upsert(payload, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  return data as AppUserRecord;
}

export async function updateAppUserProfile(userId: string, updates: UpdateAppUserProfileInput) {
  const db = supabaseAdminClient();
  const payload: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.email !== undefined) payload.email = updates.email;
  if (updates.name !== undefined) payload.name = updates.name || null;
  if (updates.role !== undefined) payload.role = normalizeAppRole(updates.role);
  if (updates.phone !== undefined) payload.phone = updates.phone || null;
  if (updates.department !== undefined) payload.department = updates.department || null;
  if (updates.status !== undefined) payload.status = updates.status || 'Active';

  const { data, error } = await db.from('users').update(payload).eq('id', userId).select('*').single();
  if (error) throw error;
  return data as AppUserRecord;
}

export async function deleteAppUserProfile(userId: string) {
  const db = supabaseAdminClient();
  const { error } = await db.from('users').delete().eq('id', userId);
  if (error) throw error;
}

export async function listAppUsers() {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('users')
    .select('*')
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('email', { ascending: true });

  if (error) throw error;
  return (data || []).map((user) => ({
    ...user,
    role: normalizeAppRole(user.role),
  })) as AppUserRecord[];
}

async function findLatestPartnerApplicationByIdentity(email?: string | null, phone?: string | null) {
  const db = supabaseAdminClient();
  const normalizedEmail = normalizeEmail(email);

  if (normalizedEmail) {
    const { data, error } = await db
      .from('partner_applications')
      .select('*')
      .ilike('email', normalizedEmail)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    if (data?.[0]) {
      return data[0] as PartnerApplicationRecord;
    }
  }

  if (phone) {
    const { data, error } = await db
      .from('partner_applications')
      .select('*')
      .eq('phone_number', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    if (data?.[0]) {
      return data[0] as PartnerApplicationRecord;
    }
  }

  return null;
}

async function tryLinkPartnerApplicationToUser(applicationId: string, userId: string) {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('partner_applications')
    .update({ user_id: userId, updated_at: new Date().toISOString() })
    .eq('id', applicationId)
    .select('*')
    .single();

  if (error) {
    if (isMissingColumnError(error, 'user_id')) {
      return null;
    }
    throw error;
  }

  return data as PartnerApplicationRecord;
}

export async function getLatestPartnerApplicationForUser(userId?: string | null, email?: string | null, phone?: string | null) {
  const db = supabaseAdminClient();

  if (userId) {
    const { data, error } = await db
      .from('partner_applications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!error && data?.[0]) {
      return data[0] as PartnerApplicationRecord;
    }

    if (error && !isMissingColumnError(error, 'user_id')) {
      throw error;
    }
  }

  const matchedApplication = await findLatestPartnerApplicationByIdentity(email, phone);

  if (matchedApplication && userId) {
    const linkedApplication = await tryLinkPartnerApplicationToUser(matchedApplication.id, userId);
    if (linkedApplication) {
      return linkedApplication;
    }

    return {
      ...matchedApplication,
      user_id: userId,
    } as PartnerApplicationRecord;
  }

  return matchedApplication;
}

export async function getPortalProfile(userId: string): Promise<PortalProfile> {
  const db = supabaseAdminClient();
  const user = await getUserById(userId);
  let linkedCandidate: Record<string, any> | null = null;

  const { data: existingLinkedCandidate, error: linkedCandidateError } = await db
    .from('candidates')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (linkedCandidateError) {
    throw linkedCandidateError;
  }

  linkedCandidate = (existingLinkedCandidate as Record<string, any> | null) || null;

  if (!linkedCandidate) {
    const { data: authUserResult, error: authUserError } = await db.auth.admin.getUserById(userId);
    if (authUserError) {
      throw authUserError;
    }

    linkedCandidate = await ensureCandidateLinkForAuthUser({
      id: userId,
      email: authUserResult.user?.email || null,
      user_metadata: authUserResult.user?.user_metadata || null,
    });
  }

  const candidateRecord = linkedCandidate || null;
  const partnerApplication = await getLatestPartnerApplicationForUser(
    userId,
    user?.email || candidateRecord?.email || null,
    user?.phone || null,
  );

  return {
    user,
    linkedCandidate: candidateRecord,
    partnerApplication,
  };
}

export async function resolveAuthenticatedUserProfile(authUser: AuthUserLike) {
  const db = supabaseAdminClient();
  const [{ data: appUser, error: appUserError }, linkedCandidate] = await Promise.all([
    db.from('users').select('*').eq('id', authUser.id).maybeSingle(),
    ensureCandidateLinkForAuthUser(authUser),
  ]);

  if (appUserError) {
    throw appUserError;
  }

  const metadataRole = authUser.user_metadata?.role;
  let role: AppRole = 'candidate';
  let source: 'users-table' | 'candidate-link' | 'user-metadata' | 'default' = 'default';

  if (appUser?.role) {
    role = normalizeAppRole(appUser.role);
    source = 'users-table';
  } else if (linkedCandidate?.id) {
    role = 'candidate';
    source = 'candidate-link';
  } else if (metadataRole) {
    role = normalizeAppRole(metadataRole);
    source = 'user-metadata';
  }

  if (!appUser && authUser.email && source === 'user-metadata' && role !== 'candidate') {
    await upsertAppUserProfile({
      id: authUser.id,
      email: authUser.email,
      role,
      name: buildName(authUser.user_metadata?.firstName, authUser.user_metadata?.lastName) || authUser.user_metadata?.name || null,
      phone: authUser.user_metadata?.phone || null,
      status: 'Active',
    });
  }

  return {
    id: authUser.id,
    email: authUser.email || appUser?.email || linkedCandidate?.email || undefined,
    role,
    linkedCandidateId: linkedCandidate?.id || null,
    isActive: appUser ? !['inactive', 'suspended', 'disabled'].includes(String(appUser.status || '').toLowerCase()) : true,
    source,
    profile: appUser,
  };
}
