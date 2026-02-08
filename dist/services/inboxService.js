"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInboxMessage = createInboxMessage;
exports.listInboxMessages = listInboxMessages;
exports.getInboxMessageById = getInboxMessageById;
exports.updateInboxMessage = updateInboxMessage;
exports.deleteInboxMessage = deleteInboxMessage;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const inboxMemory_1 = require("./inboxMemory");
const logger = (0, errorHandling_1.createLogger)('InboxService');
async function createInboxMessage(input) {
    if (!input.source) {
        throw new errorHandling_1.AppError('source is required', errorHandling_1.ErrorType.VALIDATION, 400);
    }
    if (!input.externalMessageId) {
        throw new errorHandling_1.AppError('externalMessageId is required', errorHandling_1.ErrorType.VALIDATION, 400);
    }
    try {
        const db = (0, database_1.supabaseAdminClient)();
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
                throw new errorHandling_1.AppError('external_message_id already exists', errorHandling_1.ErrorType.DUPLICATE, 409);
            }
            throw error;
        }
        return data;
    }
    catch (err) {
        // Do not fall back to memory for expected/semantic errors (e.g. duplicates).
        // Callers rely on these errors to safely skip re-processing.
        if (err instanceof errorHandling_1.AppError) {
            throw err;
        }
        logger.warn('Falling back to memory createInboxMessage due to DB error');
        return (0, inboxMemory_1.memCreateMessage)({
            source: input.source,
            externalMessageId: input.externalMessageId,
            payload: input.payload,
            status: input.status,
            receivedAt: input.receivedAt,
        });
    }
}
async function listInboxMessages(filters = {}) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        let query = db.from('inbox_messages').select('*', { count: 'exact' });
        if (filters.source) {
            query = query.eq('source', filters.source);
        }
        if (filters.status) {
            query = query.eq('status', filters.status);
        }
        if (filters.limit !== undefined && filters.offset !== undefined) {
            query = query.range(filters.offset, filters.offset + filters.limit - 1);
        }
        else if (filters.limit !== undefined) {
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
    }
    catch (err) {
        logger.warn('Falling back to memory listInboxMessages due to DB error');
        return (0, inboxMemory_1.memListMessages)(filters);
    }
}
async function getInboxMessageById(id) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { data, error } = await db
            .from('inbox_messages')
            .select('*')
            .eq('id', id)
            .single();
        if (error) {
            if (error.code === 'PGRST116' || error.details?.includes('Results contain 0 rows')) {
                throw new errorHandling_1.NotFoundError('Inbox message');
            }
            throw error;
        }
        return data;
    }
    catch (err) {
        logger.warn('Falling back to memory getInboxMessageById due to DB error');
        return (0, inboxMemory_1.memGetMessage)(id);
    }
}
async function updateInboxMessage(id, input) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const payload = {};
        if (input.status !== undefined)
            payload.status = input.status;
        if (input.payload !== undefined)
            payload.payload = input.payload;
        const { data, error } = await db
            .from('inbox_messages')
            .update(payload)
            .eq('id', id)
            .select()
            .single();
        if (error) {
            if (error.code === 'PGRST116' || error.details?.includes('Results contain 0 rows')) {
                throw new errorHandling_1.NotFoundError('Inbox message');
            }
            throw error;
        }
        return data;
    }
    catch (err) {
        logger.warn('Falling back to memory updateInboxMessage due to DB error');
        return (0, inboxMemory_1.memUpdateMessage)(id, input);
    }
}
async function deleteInboxMessage(id) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { data, error } = await db
            .from('inbox_messages')
            .delete()
            .eq('id', id)
            .select()
            .single();
        if (error) {
            if (error.code === 'PGRST116' || error.details?.includes('Results contain 0 rows')) {
                throw new errorHandling_1.NotFoundError('Inbox message');
            }
            throw error;
        }
        return data;
    }
    catch (err) {
        logger.warn('Falling back to memory deleteInboxMessage due to DB error');
        return (0, inboxMemory_1.memDeleteMessage)(id);
    }
}
