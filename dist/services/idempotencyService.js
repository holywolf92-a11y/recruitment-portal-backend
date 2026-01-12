"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateKeyHash = generateKeyHash;
exports.checkIdempotency = checkIdempotency;
exports.createIdempotencyKey = createIdempotencyKey;
exports.markIdempotencyComplete = markIdempotencyComplete;
exports.markIdempotencyFailed = markIdempotencyFailed;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const hashing_1 = require("../utils/hashing");
const logger = (0, errorHandling_1.createLogger)('IdempotencyService');
const TABLE = 'idempotency_keys';
function ensureKey(key) {
    if (!key) {
        throw new errorHandling_1.AppError('Missing idempotency key', errorHandling_1.ErrorType.VALIDATION, 400);
    }
    return key.trim();
}
function generateKeyHash(key) {
    return (0, hashing_1.hashString)(ensureKey(key));
}
async function checkIdempotency(keyHash, requestHash) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from(TABLE)
        .select('key_hash, request_hash, status, response_body, response_status, error')
        .eq('key_hash', keyHash)
        .limit(1);
    if (error) {
        logger.error('Failed to query idempotency key', error);
        throw new errorHandling_1.AppError('Failed to query idempotency key', errorHandling_1.ErrorType.DATABASE, 500);
    }
    const record = data?.[0];
    if (!record) {
        return { exists: false };
    }
    if (record.request_hash !== requestHash) {
        throw new errorHandling_1.AppError('Idempotency key already used with different payload', errorHandling_1.ErrorType.VALIDATION, 409);
    }
    return {
        exists: true,
        status: record.status,
        responseBody: record.response_body,
        responseStatus: record.response_status ?? 200,
        error: record.error,
    };
}
async function createIdempotencyKey(keyHash, resourceType, requestHash, attachmentHash) {
    const db = (0, database_1.supabaseAdminClient)();
    const now = new Date().toISOString();
    const { data, error } = await db
        .from(TABLE)
        .upsert({
        key_hash: keyHash,
        resource_type: resourceType,
        request_hash: requestHash,
        attachment_hash: attachmentHash ?? null,
        status: 'pending',
        updated_at: now,
    }, { onConflict: 'key_hash' })
        .select('key_hash, request_hash, status')
        .single();
    if (error) {
        logger.error('Failed to create idempotency key', error);
        throw new errorHandling_1.AppError('Failed to create idempotency key', errorHandling_1.ErrorType.DATABASE, 500);
    }
    if (data.request_hash !== requestHash) {
        throw new errorHandling_1.AppError('Idempotency key already used with different payload', errorHandling_1.ErrorType.VALIDATION, 409);
    }
    return data;
}
async function markIdempotencyComplete(keyHash, responseBody, responseStatus = 200) {
    const db = (0, database_1.supabaseAdminClient)();
    const { error } = await db
        .from(TABLE)
        .update({
        status: 'completed',
        response_body: responseBody ?? {},
        response_status: responseStatus,
        updated_at: new Date().toISOString(),
    })
        .eq('key_hash', keyHash);
    if (error) {
        logger.error('Failed to mark idempotency complete', error);
        throw new errorHandling_1.AppError('Failed to mark idempotency complete', errorHandling_1.ErrorType.DATABASE, 500);
    }
}
async function markIdempotencyFailed(keyHash, errorPayload) {
    const db = (0, database_1.supabaseAdminClient)();
    const { error } = await db
        .from(TABLE)
        .update({
        status: 'failed',
        error: serializeError(errorPayload),
        updated_at: new Date().toISOString(),
    })
        .eq('key_hash', keyHash);
    if (error) {
        logger.error('Failed to mark idempotency failed', error);
        throw new errorHandling_1.AppError('Failed to mark idempotency failed', errorHandling_1.ErrorType.DATABASE, 500);
    }
}
function serializeError(err) {
    if (!err)
        return null;
    if (err instanceof Error) {
        return { message: err.message, stack: err.stack };
    }
    if (typeof err === 'object')
        return err;
    return { message: String(err) };
}
