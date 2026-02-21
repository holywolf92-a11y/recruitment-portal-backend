import { supabaseAdminClient } from '../config/database';
import { AppError, ErrorType, NotFoundError, createLogger } from '../utils/errorHandling';

const logger = createLogger('WhatsAppInboxService');

export type ReplyMode = 'ai' | 'human';
export type MessageDirection = 'inbound' | 'outbound' | 'ai';

export interface WhatsAppConversation {
  id: string;
  phone_number: string;
  display_name: string | null;
  candidate_id: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  unread_count: number;
  reply_mode: ReplyMode;
  taken_over_by: string | null;
  taken_over_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppConversationView extends WhatsAppConversation {
  candidate_name?: string | null;
  taken_over_by_name?: string | null;
}

export interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  message_type: string;
  from_number: string | null;
  to_number: string | null;
  body: string | null;
  meta_message_id: string | null;
  status: string;
  is_template: boolean;
  template_name: string | null;
  media_id: string | null;
  mime_type: string | null;
  file_name: string | null;
  raw: any;
  sent_by_user_id: string | null;
  created_at: string;
}

function isDuplicateKeyError(error: any): boolean {
  const msg = String(error?.message || '');
  return msg.toLowerCase().includes('duplicate key') || String(error?.code || '') === '23505';
}

function normalizePhoneDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

async function findCandidateByPhone(phoneNumber: string): Promise<{ id: string; name: string; phone: string | null } | null> {
  const digits = normalizePhoneDigits(phoneNumber);
  if (!digits || digits.length < 7) return null;

  const key = digits.length > 10 ? digits.slice(-10) : digits;

  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('candidates')
    .select('id,name,phone')
    .ilike('phone', `%${key}%`)
    .limit(1);

  if (error) return null;
  const row = (data ?? [])[0] as any;
  if (!row?.id) return null;
  return { id: String(row.id), name: String(row.name), phone: row.phone ?? null };
}

async function hydrateConversations(conversations: WhatsAppConversation[]): Promise<WhatsAppConversationView[]> {
  if (!conversations.length) return [];

  const candidateIds = Array.from(new Set(conversations.map((c) => c.candidate_id).filter(Boolean) as string[]));
  const userIds = Array.from(new Set(conversations.map((c) => c.taken_over_by).filter(Boolean) as string[]));

  const db = supabaseAdminClient();

  const [candidatesRes, usersRes] = await Promise.all([
    candidateIds.length ? db.from('candidates').select('id,name').in('id', candidateIds) : Promise.resolve({ data: [], error: null } as any),
    userIds.length ? db.from('users').select('id,name,email').in('id', userIds) : Promise.resolve({ data: [], error: null } as any),
  ]);

  const candidateNameById = new Map<string, string>();
  if (!candidatesRes.error) {
    for (const row of candidatesRes.data ?? []) {
      if (row?.id && row?.name) candidateNameById.set(String(row.id), String(row.name));
    }
  }

  const userNameById = new Map<string, string>();
  if (!usersRes.error) {
    for (const row of usersRes.data ?? []) {
      const id = row?.id ? String(row.id) : null;
      if (!id) continue;
      const name = (row?.name && String(row.name).trim()) || (row?.email && String(row.email).trim()) || '';
      if (name) userNameById.set(id, name);
    }
  }

  return conversations.map((c) => ({
    ...c,
    candidate_name: c.candidate_id ? candidateNameById.get(c.candidate_id) ?? null : null,
    taken_over_by_name: c.taken_over_by ? userNameById.get(c.taken_over_by) ?? null : null,
  }));
}

export async function listConversations(params?: { limit?: number; offset?: number }) {
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;

  const db = supabaseAdminClient();
  const { data, error, count } = await db
    .from('whatsapp_conversations')
    .select('*', { count: 'exact' })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to list conversations', error);
    throw new AppError('Failed to list conversations', ErrorType.DATABASE, 500);
  }

  const hydrated = await hydrateConversations((data ?? []) as WhatsAppConversation[]);
  return { conversations: hydrated, total: count ?? 0, limit, offset };
}

export async function getConversation(conversationId: string) {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('whatsapp_conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (error || !data) {
    throw new NotFoundError('Conversation');
  }

  const [hydrated] = await hydrateConversations([data as WhatsAppConversation]);
  return (hydrated ?? (data as WhatsAppConversation)) as WhatsAppConversationView;
}

export async function listMessages(conversationId: string, params?: { limit?: number }) {
  const limit = params?.limit ?? 200;

  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('whatsapp_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    logger.error('Failed to list messages', error);
    throw new AppError('Failed to list messages', ErrorType.DATABASE, 500);
  }

  return { messages: (data ?? []) as WhatsAppMessage[] };
}

export async function markConversationRead(conversationId: string) {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('whatsapp_conversations')
    .update({ unread_count: 0 })
    .eq('id', conversationId)
    .select('*')
    .single();

  if (error || !data) {
    throw new AppError('Failed to mark read', ErrorType.DATABASE, 500);
  }

  return data as WhatsAppConversation;
}

export async function takeOverConversation(conversationId: string, userId: string) {
  const conversation = await getConversation(conversationId);

  if (conversation.reply_mode === 'human' && conversation.taken_over_by && conversation.taken_over_by !== userId) {
    throw new AppError('Conversation already taken over by another admin', ErrorType.FORBIDDEN, 409);
  }

  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('whatsapp_conversations')
    .update({ reply_mode: 'human', taken_over_by: userId, taken_over_at: new Date().toISOString() })
    .eq('id', conversationId)
    .select('*')
    .single();

  if (error || !data) {
    throw new AppError('Failed to take over conversation', ErrorType.DATABASE, 500);
  }

  return data as WhatsAppConversation;
}

export async function returnConversationToAI(conversationId: string) {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('whatsapp_conversations')
    .update({ reply_mode: 'ai', taken_over_by: null, taken_over_at: null })
    .eq('id', conversationId)
    .select('*')
    .single();

  if (error || !data) {
    throw new AppError('Failed to return conversation to AI', ErrorType.DATABASE, 500);
  }

  return data as WhatsAppConversation;
}

export async function ensureConversationForPhone(phoneNumber: string) {
  const db = supabaseAdminClient();

  const { data: existing, error: existingError } = await db
    .from('whatsapp_conversations')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  if (existingError) {
    throw new AppError('Failed to load conversation', ErrorType.DATABASE, 500);
  }

  if (existing) {
    const existingConversation = existing as WhatsAppConversation;
    if (!existingConversation.candidate_id) {
      const candidate = await findCandidateByPhone(phoneNumber);
      if (candidate) {
        const { data: updated } = await db
          .from('whatsapp_conversations')
          .update({ candidate_id: candidate.id, display_name: existingConversation.display_name ?? candidate.name })
          .eq('id', existingConversation.id)
          .select('*')
          .single();
        if (updated) return updated as WhatsAppConversation;
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
    throw new AppError('Failed to create conversation', ErrorType.DATABASE, 500);
  }

  const createdConversation = created as WhatsAppConversation;
  const candidate = await findCandidateByPhone(phoneNumber);
  if (candidate) {
    const { data: updated } = await db
      .from('whatsapp_conversations')
      .update({ candidate_id: candidate.id, display_name: createdConversation.display_name ?? candidate.name })
      .eq('id', createdConversation.id)
      .select('*')
      .single();
    if (updated) return updated as WhatsAppConversation;
  }

  return createdConversation;
}

export async function recordInboundMessage(params: {
  phoneNumber: string;
  toPhoneNumberId?: string;
  metaMessageId?: string;
  bodyPreview?: string;
  messageType?: string;
  raw?: any;
  media?: { mediaId?: string; mimeType?: string; fileName?: string };
  receivedAt?: Date;
}) {
  const receivedAtIso = (params.receivedAt ?? new Date()).toISOString();

  const conversation = await ensureConversationForPhone(params.phoneNumber);

  const db = supabaseAdminClient();

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
      return { conversation, message: null, duplicated: true as const };
    }
    logger.error('Failed to insert inbound message', insertError);
    throw new AppError('Failed to record inbound message', ErrorType.DATABASE, 500);
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
    return { conversation, message: inserted as WhatsAppMessage, duplicated: false as const };
  }

  return {
    conversation: updatedConversation as WhatsAppConversation,
    message: inserted as WhatsAppMessage,
    duplicated: false as const,
  };
}

export async function recordOutboundMessage(params: {
  conversationId: string;
  direction: 'outbound' | 'ai';
  fromNumberId?: string;
  toPhoneNumber: string;
  body: string;
  metaMessageId?: string;
  status?: string;
  raw?: any;
  sentByUserId?: string;
  sentAt?: Date;
}) {
  const sentAtIso = (params.sentAt ?? new Date()).toISOString();
  const db = supabaseAdminClient();

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
      return { message: null, duplicated: true as const };
    }
    logger.error('Failed to insert outbound message', insertError);
    throw new AppError('Failed to record outbound message', ErrorType.DATABASE, 500);
  }

  // Update conversation last message
  await db
    .from('whatsapp_conversations')
    .update({ last_message_preview: params.body, last_message_at: sentAtIso })
    .eq('id', params.conversationId);

  return { message: inserted as WhatsAppMessage, duplicated: false as const };
}

export async function recordTemplateMessage(params: {
  conversationId: string;
  fromNumberId?: string;
  toPhoneNumber: string;
  templateName: string;
  language: string;
  metaMessageId?: string;
  status?: string;
  raw?: any;
  sentByUserId?: string;
  sentAt?: Date;
}) {
  const sentAtIso = (params.sentAt ?? new Date()).toISOString();
  const db = supabaseAdminClient();

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
      return { message: null, duplicated: true as const };
    }
    logger.error('Failed to insert template message', insertError);
    throw new AppError('Failed to record template message', ErrorType.DATABASE, 500);
  }

  await db
    .from('whatsapp_conversations')
    .update({ last_message_preview: body, last_message_at: sentAtIso })
    .eq('id', params.conversationId);

  return { message: inserted as WhatsAppMessage, duplicated: false as const };
}

export async function updateMessageStatus(metaMessageId: string, status: string) {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('whatsapp_messages')
    .update({ status })
    .eq('meta_message_id', metaMessageId)
    .select('*')
    .maybeSingle();

  if (error) {
    logger.error('Failed to update message status', error);
    throw new AppError('Failed to update status', ErrorType.DATABASE, 500);
  }

  return data as WhatsAppMessage | null;
}

export async function isWithin24HourWindow(conversationId: string) {
  const db = supabaseAdminClient();
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
    throw new AppError('Failed to check messaging window', ErrorType.DATABASE, 500);
  }

  if (!data?.created_at) return false;

  const lastInboundMs = new Date(data.created_at).getTime();
  const nowMs = Date.now();
  return nowMs - lastInboundMs <= 24 * 60 * 60 * 1000;
}

export async function ensureHumanModeForSending(conversationId: string, userId: string) {
  const conversation = await getConversation(conversationId);

  if (conversation.reply_mode === 'human') {
    if (conversation.taken_over_by && conversation.taken_over_by !== userId) {
      throw new AppError('Conversation already taken over by another admin', ErrorType.FORBIDDEN, 409);
    }
    if (!conversation.taken_over_by) {
      return takeOverConversation(conversationId, userId);
    }
    return conversation;
  }

  // If admin sends while AI mode is active: switch to human mode automatically
  return takeOverConversation(conversationId, userId);
}
