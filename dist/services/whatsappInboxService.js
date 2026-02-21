"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listConversations = listConversations;
exports.getConversation = getConversation;
exports.listMessages = listMessages;
exports.markConversationRead = markConversationRead;
exports.takeOverConversation = takeOverConversation;
exports.returnConversationToAI = returnConversationToAI;
exports.ensureConversationForPhone = ensureConversationForPhone;
exports.recordInboundMessage = recordInboundMessage;
exports.recordOutboundMessage = recordOutboundMessage;
exports.recordTemplateMessage = recordTemplateMessage;
exports.updateMessageStatus = updateMessageStatus;
exports.isWithin24HourWindow = isWithin24HourWindow;
exports.ensureHumanModeForSending = ensureHumanModeForSending;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('WhatsAppInboxService');
function isDuplicateKeyError(error) {
    const msg = String(error?.message || '');
    return msg.toLowerCase().includes('duplicate key') || String(error?.code || '') === '23505';
}
function normalizePhoneDigits(value) {
    return String(value || '').replace(/\D/g, '');
}
async function findCandidateByPhone(phoneNumber) {
    const digits = normalizePhoneDigits(phoneNumber);
    if (!digits || digits.length < 7)
        return null;
    const key = digits.length > 10 ? digits.slice(-10) : digits;
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidates')
        .select('id,name,phone')
        .ilike('phone', `%${key}%`)
        .limit(1);
    if (error)
        return null;
    const row = (data ?? [])[0];
    if (!row?.id)
        return null;
    return { id: String(row.id), name: String(row.name), phone: row.phone ?? null };
}
async function hydrateConversations(conversations) {
    if (!conversations.length)
        return [];
    const candidateIds = Array.from(new Set(conversations.map((c) => c.candidate_id).filter(Boolean)));
    const userIds = Array.from(new Set(conversations.map((c) => c.taken_over_by).filter(Boolean)));
    const db = (0, database_1.supabaseAdminClient)();
    const [candidatesRes, usersRes] = await Promise.all([
        candidateIds.length ? db.from('candidates').select('id,name').in('id', candidateIds) : Promise.resolve({ data: [], error: null }),
        userIds.length ? db.from('users').select('id,name,email').in('id', userIds) : Promise.resolve({ data: [], error: null }),
    ]);
    const candidateNameById = new Map();
    if (!candidatesRes.error) {
        for (const row of candidatesRes.data ?? []) {
            if (row?.id && row?.name)
                candidateNameById.set(String(row.id), String(row.name));
        }
    }
    const userNameById = new Map();
    if (!usersRes.error) {
        for (const row of usersRes.data ?? []) {
            const id = row?.id ? String(row.id) : null;
            if (!id)
                continue;
            const name = (row?.name && String(row.name).trim()) || (row?.email && String(row.email).trim()) || '';
            if (name)
                userNameById.set(id, name);
        }
    }
    return conversations.map((c) => ({
        ...c,
        candidate_name: c.candidate_id ? candidateNameById.get(c.candidate_id) ?? null : null,
        taken_over_by_name: c.taken_over_by ? userNameById.get(c.taken_over_by) ?? null : null,
    }));
}
async function listConversations(params) {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error, count } = await db
        .from('whatsapp_conversations')
        .select('*', { count: 'exact' })
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1);
    if (error) {
        logger.error('Failed to list conversations', error);
        throw new errorHandling_1.AppError('Failed to list conversations', errorHandling_1.ErrorType.DATABASE, 500);
    }
    const hydrated = await hydrateConversations((data ?? []));
    return { conversations: hydrated, total: count ?? 0, limit, offset };
}
async function getConversation(conversationId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_conversations')
        .select('*')
        .eq('id', conversationId)
        .single();
    if (error || !data) {
        throw new errorHandling_1.NotFoundError('Conversation');
    }
    const [hydrated] = await hydrateConversations([data]);
    return (hydrated ?? data);
}
async function listMessages(conversationId, params) {
    const limit = params?.limit ?? 200;
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(limit);
    if (error) {
        logger.error('Failed to list messages', error);
        throw new errorHandling_1.AppError('Failed to list messages', errorHandling_1.ErrorType.DATABASE, 500);
    }
    return { messages: (data ?? []) };
}
async function markConversationRead(conversationId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_conversations')
        .update({ unread_count: 0 })
        .eq('id', conversationId)
        .select('*')
        .single();
    if (error || !data) {
        throw new errorHandling_1.AppError('Failed to mark read', errorHandling_1.ErrorType.DATABASE, 500);
    }
    return data;
}
async function takeOverConversation(conversationId, userId) {
    const conversation = await getConversation(conversationId);
    if (conversation.reply_mode === 'human' && conversation.taken_over_by && conversation.taken_over_by !== userId) {
        throw new errorHandling_1.AppError('Conversation already taken over by another admin', errorHandling_1.ErrorType.FORBIDDEN, 409);
    }
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_conversations')
        .update({ reply_mode: 'human', taken_over_by: userId, taken_over_at: new Date().toISOString() })
        .eq('id', conversationId)
        .select('*')
        .single();
    if (error || !data) {
        throw new errorHandling_1.AppError('Failed to take over conversation', errorHandling_1.ErrorType.DATABASE, 500);
    }
    return data;
}
async function returnConversationToAI(conversationId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_conversations')
        .update({ reply_mode: 'ai', taken_over_by: null, taken_over_at: null })
        .eq('id', conversationId)
        .select('*')
        .single();
    if (error || !data) {
        throw new errorHandling_1.AppError('Failed to return conversation to AI', errorHandling_1.ErrorType.DATABASE, 500);
    }
    return data;
}
async function ensureConversationForPhone(phoneNumber) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data: existing, error: existingError } = await db
        .from('whatsapp_conversations')
        .select('*')
        .eq('phone_number', phoneNumber)
        .maybeSingle();
    if (existingError) {
        throw new errorHandling_1.AppError('Failed to load conversation', errorHandling_1.ErrorType.DATABASE, 500);
    }
    if (existing) {
        const existingConversation = existing;
        if (!existingConversation.candidate_id) {
            const candidate = await findCandidateByPhone(phoneNumber);
            if (candidate) {
                const { data: updated } = await db
                    .from('whatsapp_conversations')
                    .update({ candidate_id: candidate.id, display_name: existingConversation.display_name ?? candidate.name })
                    .eq('id', existingConversation.id)
                    .select('*')
                    .single();
                if (updated)
                    return updated;
            }
        }
        return existingConversation;
    }
    const { data: created, error: createError } = await db
        .from('whatsapp_conversations')
        .insert({ phone_number: phoneNumber, unread_count: 0, reply_mode: 'ai' })
        .select('*')
        .single();
    if (createError || !created) {
        throw new errorHandling_1.AppError('Failed to create conversation', errorHandling_1.ErrorType.DATABASE, 500);
    }
    const createdConversation = created;
    const candidate = await findCandidateByPhone(phoneNumber);
    if (candidate) {
        const { data: updated } = await db
            .from('whatsapp_conversations')
            .update({ candidate_id: candidate.id, display_name: createdConversation.display_name ?? candidate.name })
            .eq('id', createdConversation.id)
            .select('*')
            .single();
        if (updated)
            return updated;
    }
    return createdConversation;
}
async function recordInboundMessage(params) {
    const receivedAtIso = (params.receivedAt ?? new Date()).toISOString();
    const conversation = await ensureConversationForPhone(params.phoneNumber);
    const db = (0, database_1.supabaseAdminClient)();
    // Insert message first (idempotency on meta_message_id)
    const { data: inserted, error: insertError } = await db
        .from('whatsapp_messages')
        .insert({
        conversation_id: conversation.id,
        direction: 'inbound',
        message_type: params.messageType ?? 'text',
        from_number: params.phoneNumber,
        to_number: params.toPhoneNumberId ?? null,
        body: params.bodyPreview ?? null,
        meta_message_id: params.metaMessageId ?? null,
        status: 'received',
        raw: params.raw ?? null,
        media_id: params.media?.mediaId ?? null,
        mime_type: params.media?.mimeType ?? null,
        file_name: params.media?.fileName ?? null,
        created_at: receivedAtIso,
    })
        .select('*')
        .single();
    if (insertError) {
        if (isDuplicateKeyError(insertError)) {
            return { conversation, message: null, duplicated: true };
        }
        logger.error('Failed to insert inbound message', insertError);
        throw new errorHandling_1.AppError('Failed to record inbound message', errorHandling_1.ErrorType.DATABASE, 500);
    }
    // Update conversation with incremented unread_count
    const nextUnread = (conversation.unread_count ?? 0) + 1;
    const { data: updatedConversation, error: updateError } = await db
        .from('whatsapp_conversations')
        .update({
        last_message_preview: params.bodyPreview ?? null,
        last_message_at: receivedAtIso,
        last_inbound_at: receivedAtIso,
        unread_count: nextUnread,
    })
        .eq('id', conversation.id)
        .select('*')
        .single();
    if (updateError || !updatedConversation) {
        logger.error('Failed to update conversation for inbound', updateError);
        // Fail open: message is stored; conversation update can be retried later
        return { conversation, message: inserted, duplicated: false };
    }
    return {
        conversation: updatedConversation,
        message: inserted,
        duplicated: false,
    };
}
async function recordOutboundMessage(params) {
    const sentAtIso = (params.sentAt ?? new Date()).toISOString();
    const db = (0, database_1.supabaseAdminClient)();
    const { data: inserted, error: insertError } = await db
        .from('whatsapp_messages')
        .insert({
        conversation_id: params.conversationId,
        direction: params.direction,
        message_type: 'text',
        from_number: params.fromNumberId ?? null,
        to_number: params.toPhoneNumber,
        body: params.body,
        meta_message_id: params.metaMessageId ?? null,
        status: params.status ?? 'sent',
        raw: params.raw ?? null,
        sent_by_user_id: params.sentByUserId ?? null,
        created_at: sentAtIso,
    })
        .select('*')
        .single();
    if (insertError) {
        if (isDuplicateKeyError(insertError)) {
            return { message: null, duplicated: true };
        }
        logger.error('Failed to insert outbound message', insertError);
        throw new errorHandling_1.AppError('Failed to record outbound message', errorHandling_1.ErrorType.DATABASE, 500);
    }
    // Update conversation last message
    await db
        .from('whatsapp_conversations')
        .update({ last_message_preview: params.body, last_message_at: sentAtIso })
        .eq('id', params.conversationId);
    return { message: inserted, duplicated: false };
}
async function recordTemplateMessage(params) {
    const sentAtIso = (params.sentAt ?? new Date()).toISOString();
    const db = (0, database_1.supabaseAdminClient)();
    const body = `[template:${params.templateName}]`;
    const { data: inserted, error: insertError } = await db
        .from('whatsapp_messages')
        .insert({
        conversation_id: params.conversationId,
        direction: 'outbound',
        message_type: 'template',
        from_number: params.fromNumberId ?? null,
        to_number: params.toPhoneNumber,
        body,
        meta_message_id: params.metaMessageId ?? null,
        status: params.status ?? 'sent',
        is_template: true,
        template_name: params.templateName,
        raw: params.raw ?? { language: params.language },
        sent_by_user_id: params.sentByUserId ?? null,
        created_at: sentAtIso,
    })
        .select('*')
        .single();
    if (insertError) {
        if (isDuplicateKeyError(insertError)) {
            return { message: null, duplicated: true };
        }
        logger.error('Failed to insert template message', insertError);
        throw new errorHandling_1.AppError('Failed to record template message', errorHandling_1.ErrorType.DATABASE, 500);
    }
    await db
        .from('whatsapp_conversations')
        .update({ last_message_preview: body, last_message_at: sentAtIso })
        .eq('id', params.conversationId);
    return { message: inserted, duplicated: false };
}
async function updateMessageStatus(metaMessageId, status) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_messages')
        .update({ status })
        .eq('meta_message_id', metaMessageId)
        .select('*')
        .maybeSingle();
    if (error) {
        logger.error('Failed to update message status', error);
        throw new errorHandling_1.AppError('Failed to update status', errorHandling_1.ErrorType.DATABASE, 500);
    }
    return data;
}
async function isWithin24HourWindow(conversationId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_messages')
        .select('created_at')
        .eq('conversation_id', conversationId)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) {
        logger.error('Failed to check 24h window', error);
        throw new errorHandling_1.AppError('Failed to check messaging window', errorHandling_1.ErrorType.DATABASE, 500);
    }
    if (!data?.created_at)
        return false;
    const lastInboundMs = new Date(data.created_at).getTime();
    const nowMs = Date.now();
    return nowMs - lastInboundMs <= 24 * 60 * 60 * 1000;
}
async function ensureHumanModeForSending(conversationId, userId) {
    const conversation = await getConversation(conversationId);
    if (conversation.reply_mode === 'human') {
        if (conversation.taken_over_by && conversation.taken_over_by !== userId) {
            throw new errorHandling_1.AppError('Conversation already taken over by another admin', errorHandling_1.ErrorType.FORBIDDEN, 409);
        }
        if (!conversation.taken_over_by) {
            return takeOverConversation(conversationId, userId);
        }
        return conversation;
    }
    // If admin sends while AI mode is active: switch to human mode automatically
    return takeOverConversation(conversationId, userId);
}
