import { supabaseAdminClient } from '../config/database';
import { AppError, ErrorType, NotFoundError, createLogger } from '../utils/errorHandling';
import { memCreateMessage, memListMessages, memGetMessage, memUpdateMessage, memDeleteMessage } from './inboxMemory';

const logger = createLogger('InboxService');

export interface InboxMessageCreateInput {
  source: string;
  externalMessageId: string;
  payload?: any;
  status?: string;
  receivedAt?: string;
}

export interface InboxMessageUpdateInput {
  status?: string;
  payload?: any;
}

export interface InboxMessageFilters {
  source?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function createInboxMessage(input: InboxMessageCreateInput) {
  if (!input.source) {
    throw new AppError('source is required', ErrorType.VALIDATION, 400);
  }
  if (!input.externalMessageId) {
    throw new AppError('externalMessageId is required', ErrorType.VALIDATION, 400);
  }

  try {
    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('inbox_messages')
      .insert({
        source: input.source,
        external_message_id: input.externalMessageId,
        payload: input.payload ?? null,
        status: input.status ?? 'pending',
        received_at: input.receivedAt ?? new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create inbox message (db)', error);
      if (String(error.message).includes('duplicate key')) {
        throw new AppError('external_message_id already exists', ErrorType.DUPLICATE, 409);
      }
      throw error;
    }
    return data;
  } catch (err) {
    // Do not fall back to memory for expected/semantic errors (e.g. duplicates).
    // Callers rely on these errors to safely skip re-processing.
    if (err instanceof AppError) {
      throw err;
    }
    logger.warn('Falling back to memory createInboxMessage due to DB error');
    return memCreateMessage({
      source: input.source,
      externalMessageId: input.externalMessageId,
      payload: input.payload,
      status: input.status,
      receivedAt: input.receivedAt,
    });
  }
}

export async function listInboxMessages(filters: InboxMessageFilters = {}) {
  try {
    const db = supabaseAdminClient();
    let query = db.from('inbox_messages').select('*', { count: 'exact' });

    if (filters.source) {
      query = query.eq('source', filters.source);
    }
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.limit !== undefined && filters.offset !== undefined) {
      query = query.range(filters.offset, filters.offset + filters.limit - 1);
    } else if (filters.limit !== undefined) {
      query = query.limit(filters.limit);
    }

    query = query.order('received_at', { ascending: false });

    const { data, error, count } = await query;
    if (error) {
      throw error;
    }

    return {
      messages: data,
      total: count ?? 0,
      limit: filters.limit,
      offset: filters.offset,
    };
  } catch (err) {
    logger.warn('Falling back to memory listInboxMessages due to DB error');
    return memListMessages(filters);
  }
}

export async function getInboxMessageById(id: string) {
  try {
    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('inbox_messages')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.details?.includes('Results contain 0 rows')) {
        throw new NotFoundError('Inbox message');
      }
      throw error;
    }
    return data;
  } catch (err) {
    logger.warn('Falling back to memory getInboxMessageById due to DB error');
    return memGetMessage(id);
  }
}

export async function updateInboxMessage(id: string, input: InboxMessageUpdateInput) {
  try {
    const db = supabaseAdminClient();
    const payload: any = {};
    if (input.status !== undefined) payload.status = input.status;
    if (input.payload !== undefined) payload.payload = input.payload;

    const { data, error } = await db
      .from('inbox_messages')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.details?.includes('Results contain 0 rows')) {
        throw new NotFoundError('Inbox message');
      }
      throw error;
    }
    return data;
  } catch (err) {
    logger.warn('Falling back to memory updateInboxMessage due to DB error');
    return memUpdateMessage(id, input);
  }
}

export async function deleteInboxMessage(id: string) {
  try {
    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('inbox_messages')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.details?.includes('Results contain 0 rows')) {
        throw new NotFoundError('Inbox message');
      }
      throw error;
    }
    return data;
  } catch (err) {
    logger.warn('Falling back to memory deleteInboxMessage due to DB error');
    return memDeleteMessage(id);
  }
}
