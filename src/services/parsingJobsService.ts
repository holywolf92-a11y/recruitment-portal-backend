import { supabaseAdminClient } from '../config/database';
import { AppError, ErrorType, createLogger } from '../utils/errorHandling';

export type JobStatus = 'queued' | 'processing' | 'extracted' | 'failed';

export interface CreateParsingJobInput {
  attachmentId: string;
  fileHash?: string | null;
}

const logger = createLogger('ParsingJobsService');

export class ParsingJobsService {
  async createJob(input: CreateParsingJobInput) {
    const db = supabaseAdminClient();
    const now = new Date().toISOString();
    // NOTE: parsing_jobs schema has diverged across deployments.
    // Some environments use inbox_attachment_id + output, others use attachment_id + result_json.
    // We try inbox_attachment_id first (current codebase expectation), then fall back.
    const attempt1 = await db
      .from('parsing_jobs')
      .insert({
        inbox_attachment_id: input.attachmentId,
        status: 'queued',
        created_at: now,
      } as any)
      .select()
      .single();

    if (!attempt1.error) return attempt1.data;

    const msg1 = String((attempt1.error as any)?.message || attempt1.error);
    const shouldFallback =
      /column.*inbox_attachment_id.*does\s+not\s+exist/i.test(msg1) ||
      /does\s+not\s+exist.*inbox_attachment_id/i.test(msg1) ||
      /null value in column.*attachment_id.*violates\s+not-null\s+constraint/i.test(msg1);

    if (!shouldFallback) {
      logger.error('Failed to create parsing job', attempt1.error);
      throw new AppError('Failed to create parsing job', ErrorType.DATABASE, 500);
    }

    const attempt2 = await db
      .from('parsing_jobs')
      .insert({
        attachment_id: input.attachmentId,
        file_hash: input.fileHash ?? null,
        status: 'queued',
        attempts: 0,
        created_at: now,
      } as any)
      .select()
      .single();

    if (attempt2.error) {
      logger.error('Failed to create parsing job (fallback)', attempt2.error);
      throw new AppError('Failed to create parsing job', ErrorType.DATABASE, 500);
    }
    return attempt2.data;
  }

  async setStatus(jobId: string, status: JobStatus, extra?: Record<string, any>) {
    const db = supabaseAdminClient();

    // Progressive payloads: try most-complete first, fall back to minimal on schema errors.
    // Production table (migration 002) has: id, inbox_attachment_id, status, output, created_at
    // Newer migrations add: finished_at, error_code, error_message, result_json, etc.
    const payloads: Record<string, any>[] = [
      // Full modern schema
      {
        status,
        ...(extra?.finished_at  != null && { finished_at:  extra.finished_at }),
        ...(extra?.error_code   != null && { error_code:   extra.error_code }),
        ...(extra?.error_message != null && { error_message: extra.error_message }),
        ...(extra?.result_json  !== undefined && { output: extra.result_json }),
      },
      // Minimal: status + output (migration 002 schema)
      {
        status,
        ...(extra?.result_json !== undefined && { output: extra.result_json }),
      },
      // Absolute minimum
      { status },
    ];

    for (const payload of payloads) {
      const { error } = await db.from('parsing_jobs').update(payload).eq('id', jobId);
      if (!error) return null;

      const msg  = String((error as any)?.message || error);
      const code = String((error as any)?.code    || '');

      console.error('[ParsingJobsService] setStatus error:', JSON.stringify(error), '| jobId:', jobId, '| status:', status);

      // Schema mismatch — try next, simpler payload
      const isSchemaError =
        /could not find.*column/i.test(msg) ||
        /column.*does\s+not\s+exist/i.test(msg) ||
        code === 'PGRST204';

      if (isSchemaError) continue;

      // Non-schema error: stop retrying
      logger.error('Failed to update parsing job status', { jobId, status, error: msg });
      throw new AppError('Failed to update parsing job', ErrorType.DATABASE, 500);
    }

    return null;
  }

  async getJob(jobId: string) {
    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('parsing_jobs')
      .select('*')
      .eq('id', jobId)
      .single();
    if (error) {
      if ((error as any).code === 'PGRST116') return null;
      throw error;
    }
    return data;
  }

  async findLatestExtractedForAttachment(attachmentId: string, fileHash?: string | null) {
    const db = supabaseAdminClient();
    // Try inbox_attachment_id first, then fall back to attachment_id.
    const attempt1 = await db
      .from('parsing_jobs')
      .select('*')
      .eq('inbox_attachment_id', attachmentId)
      .eq('status', 'extracted' as JobStatus)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!attempt1.error) {
      return Array.isArray(attempt1.data) && attempt1.data.length ? attempt1.data[0] : null;
    }

    const msg1 = String((attempt1.error as any)?.message || attempt1.error);
    const shouldFallback = /column\s+"?inbox_attachment_id"?\s+does\s+not\s+exist/i.test(msg1);
    if (!shouldFallback) throw attempt1.error;

    const attempt2 = await db
      .from('parsing_jobs')
      .select('*')
      .eq('attachment_id', attachmentId)
      .eq('status', 'extracted' as JobStatus)
      .order('created_at', { ascending: false })
      .limit(1);
    if (attempt2.error) throw attempt2.error;
    return Array.isArray(attempt2.data) && attempt2.data.length ? attempt2.data[0] : null;
  }

  async findLatestForAttachment(attachmentId: string) {
    const db = supabaseAdminClient();
    const attempt1 = await db
      .from('parsing_jobs')
      .select('*')
      .eq('inbox_attachment_id', attachmentId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!attempt1.error) {
      return Array.isArray(attempt1.data) && attempt1.data.length ? attempt1.data[0] : null;
    }

    const msg1 = String((attempt1.error as any)?.message || attempt1.error);
    const shouldFallback = /column\s+"?inbox_attachment_id"?\s+does\s+not\s+exist/i.test(msg1);
    if (!shouldFallback) throw attempt1.error;

    const attempt2 = await db
      .from('parsing_jobs')
      .select('*')
      .eq('attachment_id', attachmentId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (attempt2.error) throw attempt2.error;
    return Array.isArray(attempt2.data) && attempt2.data.length ? attempt2.data[0] : null;
  }
}
