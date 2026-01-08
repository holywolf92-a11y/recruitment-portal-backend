import { supabaseAdminClient } from '../config/database';
import { AppError, ErrorType, createLogger } from '../utils/errorHandling';
import { hashString } from '../utils/hashing';

const logger = createLogger('IdempotencyService');
const TABLE = 'idempotency_keys';

export type IdempotencyStatus = 'pending' | 'completed' | 'failed';

export interface IdempotencyCheckResult {
  exists: boolean;
  status?: IdempotencyStatus;
  responseBody?: any;
  responseStatus?: number;
  error?: any;
}

function ensureKey(key: string): string {
  if (!key) {
    throw new AppError('Missing idempotency key', ErrorType.VALIDATION, 400);
  }
  return key.trim();
}

export function generateKeyHash(key: string): string {
  return hashString(ensureKey(key));
}

export async function checkIdempotency(keyHash: string, requestHash: string): Promise<IdempotencyCheckResult> {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from(TABLE)
    .select('key_hash, request_hash, status, response_body, response_status, error')
    .eq('key_hash', keyHash)
    .limit(1);

  if (error) {
    logger.error('Failed to query idempotency key', error);
    throw new AppError('Failed to query idempotency key', ErrorType.DATABASE, 500);
  }

  const record = data?.[0];
  if (!record) {
    return { exists: false };
  }

  if (record.request_hash !== requestHash) {
    throw new AppError('Idempotency key already used with different payload', ErrorType.VALIDATION, 409);
  }

  return {
    exists: true,
    status: record.status as IdempotencyStatus,
    responseBody: record.response_body,
    responseStatus: record.response_status ?? 200,
    error: record.error,
  };
}

export async function createIdempotencyKey(
  keyHash: string,
  resourceType: string,
  requestHash: string,
  attachmentHash?: string
) {
  const db = supabaseAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        key_hash: keyHash,
        resource_type: resourceType,
        request_hash: requestHash,
        attachment_hash: attachmentHash ?? null,
        status: 'pending',
        updated_at: now,
      },
      { onConflict: 'key_hash' }
    )
    .select('key_hash, request_hash, status')
    .single();

  if (error) {
    logger.error('Failed to create idempotency key', error);
    throw new AppError('Failed to create idempotency key', ErrorType.DATABASE, 500);
  }

  if (data.request_hash !== requestHash) {
    throw new AppError('Idempotency key already used with different payload', ErrorType.VALIDATION, 409);
  }

  return data;
}

export async function markIdempotencyComplete(keyHash: string, responseBody: any, responseStatus = 200) {
  const db = supabaseAdminClient();

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
    throw new AppError('Failed to mark idempotency complete', ErrorType.DATABASE, 500);
  }
}

export async function markIdempotencyFailed(keyHash: string, errorPayload: any) {
  const db = supabaseAdminClient();

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
    throw new AppError('Failed to mark idempotency failed', ErrorType.DATABASE, 500);
  }
}

function serializeError(err: any) {
  if (!err) return null;
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  if (typeof err === 'object') return err;
  return { message: String(err) };
}
