"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureCandidateLinkForAuthUser = ensureCandidateLinkForAuthUser;
exports.bootstrapCandidateProfileForAuthUser = bootstrapCandidateProfileForAuthUser;
exports.normalizeAppRole = normalizeAppRole;
exports.getLatestEmployerLeadForUser = getLatestEmployerLeadForUser;
exports.getUserById = getUserById;
exports.getUserProfile = getUserProfile;
exports.upsertAppUserProfile = upsertAppUserProfile;
exports.updateAppUserProfile = updateAppUserProfile;
exports.deleteAppUserProfile = deleteAppUserProfile;
exports.listAppUsers = listAppUsers;
exports.getLatestPartnerApplicationForUser = getLatestPartnerApplicationForUser;
exports.getPortalProfile = getPortalProfile;
exports.resolveAuthenticatedUserProfile = resolveAuthenticatedUserProfile;
const database_1 = require("../config/database");
const candidateService_1 = require("./candidateService");
function buildName(firstName, lastName) {
    const parts = [firstName, lastName].map((value) => value?.trim()).filter(Boolean);
    return parts.length ? parts.join(' ') : null;
}
function normalizeEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    return normalized || null;
}
function isMissingColumnError(error, columnName) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes(columnName.toLowerCase()) && message.includes('column');
}
async function findUnlinkedCandidateByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        return null;
    }
    const db = (0, database_1.supabaseAdminClient)();
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
    return data[0];
}
async function ensureCandidateLinkForAuthUser(authUser) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data: linkedCandidate, error: linkedCandidateError } = await db
        .from('candidates')
        .select('*')
        .eq('user_id', authUser.id)
        .maybeSingle();
    if (linkedCandidateError) {
        throw linkedCandidateError;
    }
    if (linkedCandidate) {
        return linkedCandidate;
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
        return refetchedCandidate;
    }
    await upsertAppUserProfile({
        id: authUser.id,
        email: normalizeEmail(authUser.email) || updatedCandidate.email || `${authUser.id}@candidate.local`,
        role: 'candidate',
        name: buildName(authUser.user_metadata?.firstName, authUser.user_metadata?.lastName) || authUser.user_metadata?.name || updatedCandidate.name || null,
        phone: authUser.user_metadata?.phone || updatedCandidate.phone || null,
        status: 'Active',
    });
    return updatedCandidate;
}
async function bootstrapCandidateProfileForAuthUser(authUser) {
    const linkedCandidate = await ensureCandidateLinkForAuthUser(authUser);
    if (linkedCandidate) {
        return linkedCandidate;
    }
    const email = normalizeEmail(authUser.email);
    const name = buildName(authUser.user_metadata?.firstName, authUser.user_metadata?.lastName) || authUser.user_metadata?.name || email?.split('@')[0] || 'Candidate';
    const phone = authUser.user_metadata?.phone || undefined;
    const createdCandidate = await (0, candidateService_1.createCandidate)({
        name,
        email: email || undefined,
        phone,
        source: 'Form',
        status: 'Pending',
    }, authUser.id);
    const db = (0, database_1.supabaseAdminClient)();
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
    return linkedCreatedCandidate;
}
function normalizeAppRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    if (normalized === 'admin' || normalized === 'super_admin') {
        return 'admin';
    }
    if (normalized === 'partner') {
        return 'partner';
    }
    if (normalized === 'employer' || normalized === 'client') {
        return 'employer';
    }
    if (normalized === 'candidate') {
        return 'candidate';
    }
    if (['worker', 'employee', 'manager', 'recruiter', 'viewer', 'staff'].includes(normalized)) {
        return 'worker';
    }
    return 'candidate';
}
async function tryLinkEmployerLeadToUser(employerLeadId, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    let updateError = null;
    let data = null;
    ({ data, error: updateError } = await db
        .from('employer_leads')
        .update({ user_id: userId, updated_at: new Date().toISOString() })
        .eq('id', employerLeadId)
        .is('user_id', null)
        .select('*')
        .maybeSingle());
    if (updateError && isMissingColumnError(updateError, 'user_id')) {
        return null;
    }
    if (updateError) {
        throw updateError;
    }
    if (data) {
        return data;
    }
    const { data: refreshed, error: refreshError } = await db
        .from('employer_leads')
        .select('*')
        .eq('id', employerLeadId)
        .maybeSingle();
    if (refreshError) {
        throw refreshError;
    }
    return refreshed || null;
}
async function findLatestEmployerLeadByIdentity(email, phone) {
    const db = (0, database_1.supabaseAdminClient)();
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = String(phone || '').trim();
    if (normalizedEmail) {
        const { data, error } = await db
            .from('employer_leads')
            .select('*')
            .ilike('email', normalizedEmail)
            .order('updated_at', { ascending: false })
            .limit(1);
        if (error) {
            throw error;
        }
        if (data?.[0]) {
            return data[0];
        }
    }
    if (normalizedPhone) {
        const { data, error } = await db
            .from('employer_leads')
            .select('*')
            .eq('phone_number', normalizedPhone)
            .order('updated_at', { ascending: false })
            .limit(1);
        if (error) {
            throw error;
        }
        if (data?.[0]) {
            return data[0];
        }
    }
    return null;
}
async function getLatestEmployerLeadForUser(userId, email, phone) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data: directMatch, error: directError } = await db
        .from('employer_leads')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1);
    if (directError && !isMissingColumnError(directError, 'user_id')) {
        throw directError;
    }
    if (directMatch?.[0]) {
        return directMatch[0];
    }
    const matchedLead = await findLatestEmployerLeadByIdentity(email, phone);
    if (matchedLead && userId) {
        const linkedLead = await tryLinkEmployerLeadToUser(matchedLead.id, userId);
        if (linkedLead) {
            return linkedLead;
        }
        return {
            ...matchedLead,
            user_id: userId,
        };
    }
    return matchedLead;
}
async function getUserById(userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db.from('users').select('*').eq('id', userId).maybeSingle();
    if (error)
        throw error;
    return data;
}
async function getUserProfile(userId) {
    return getPortalProfile(userId);
}
async function upsertAppUserProfile(input) {
    const db = (0, database_1.supabaseAdminClient)();
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
    if (error)
        throw error;
    return data;
}
async function updateAppUserProfile(userId, updates) {
    const db = (0, database_1.supabaseAdminClient)();
    const payload = {
        updated_at: new Date().toISOString(),
    };
    if (updates.email !== undefined)
        payload.email = updates.email;
    if (updates.name !== undefined)
        payload.name = updates.name || null;
    if (updates.role !== undefined)
        payload.role = normalizeAppRole(updates.role);
    if (updates.phone !== undefined)
        payload.phone = updates.phone || null;
    if (updates.department !== undefined)
        payload.department = updates.department || null;
    if (updates.status !== undefined)
        payload.status = updates.status || 'Active';
    const { data, error } = await db.from('users').update(payload).eq('id', userId).select('*').single();
    if (error)
        throw error;
    return data;
}
async function deleteAppUserProfile(userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { error } = await db.from('users').delete().eq('id', userId);
    if (error)
        throw error;
}
async function listAppUsers() {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('users')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('email', { ascending: true });
    if (error)
        throw error;
    return (data || []).map((user) => ({
        ...user,
        role: normalizeAppRole(user.role),
    }));
}
async function findLatestPartnerApplicationByIdentity(email, phone) {
    const db = (0, database_1.supabaseAdminClient)();
    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail) {
        const { data, error } = await db
            .from('partner_applications')
            .select('*')
            .ilike('email', normalizedEmail)
            .order('created_at', { ascending: false })
            .limit(1);
        if (error)
            throw error;
        if (data?.[0]) {
            return data[0];
        }
    }
    if (phone) {
        const { data, error } = await db
            .from('partner_applications')
            .select('*')
            .eq('phone_number', phone)
            .order('created_at', { ascending: false })
            .limit(1);
        if (error)
            throw error;
        if (data?.[0]) {
            return data[0];
        }
    }
    return null;
}
async function tryLinkPartnerApplicationToUser(applicationId, userId) {
    const db = (0, database_1.supabaseAdminClient)();
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
    return data;
}
async function getLatestPartnerApplicationForUser(userId, email, phone) {
    const db = (0, database_1.supabaseAdminClient)();
    if (userId) {
        const { data, error } = await db
            .from('partner_applications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1);
        if (!error && data?.[0]) {
            return data[0];
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
        };
    }
    return matchedApplication;
}
async function getPortalProfile(userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const user = await getUserById(userId);
    let linkedCandidate = null;
    const { data: existingLinkedCandidate, error: linkedCandidateError } = await db
        .from('candidates')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
    if (linkedCandidateError) {
        throw linkedCandidateError;
    }
    linkedCandidate = existingLinkedCandidate || null;
    if (!linkedCandidate && (!user?.role || normalizeAppRole(user.role) === 'candidate')) {
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
    const partnerApplication = await getLatestPartnerApplicationForUser(userId, user?.email || candidateRecord?.email || null, user?.phone || null);
    const employerLead = await getLatestEmployerLeadForUser(userId, user?.email || null, user?.phone || null);
    return {
        user,
        linkedCandidate: candidateRecord,
        partnerApplication,
        employerLead,
    };
}
async function resolveAuthenticatedUserProfile(authUser) {
    const db = (0, database_1.supabaseAdminClient)();
    const [{ data: appUser, error: appUserError }, linkedCandidate] = await Promise.all([
        db.from('users').select('*').eq('id', authUser.id).maybeSingle(),
        ensureCandidateLinkForAuthUser(authUser),
    ]);
    if (appUserError) {
        throw appUserError;
    }
    const metadataRole = authUser.user_metadata?.role;
    let role = 'candidate';
    let source = 'default';
    if (appUser?.role) {
        role = normalizeAppRole(appUser.role);
        source = 'users-table';
    }
    else if (linkedCandidate?.id) {
        role = 'candidate';
        source = 'candidate-link';
    }
    else if (metadataRole) {
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
