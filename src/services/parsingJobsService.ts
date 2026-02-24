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

    // Build base payload — always include status + any error/timing metadata
    const payload1: any = { status };

    // Persist error details so failures are diagnosable (previously these were silently dropped)
    if (extra?.error_message != null) payload1.error_message = extra.error_message;
    if (extra?.error_code   != null) payload1.error_code   = extra.error_code;
    if (extra?.finished_at  != null) payload1.finished_at  = extra.finished_at;

    // Output column — try 'output' first, fall back to 'result_json' below
    if (extra && Object.prototype.hasOwnProperty.call(extra, 'result_json')) {
      payload1.output = extra.result_json;
    }

    const attempt1 = await db
      .from('parsing_jobs')
      .update(payload1)
      .eq('id', jobId)
      .select()
      .single();

    if (!attempt1.error) return attempt1.data;

    const msg1 = String((attempt1.error as any)?.message || attempt1.error);

    // If the failure is due to unknown columns (schema mismatch), retry with safe subset
    // PostgREST may use single quotes, double quotes, or no quotes around the column name
    const isColumnMismatch = /column.*does\s+not\s+exist/i.test(msg1);
    if (!isColumnMismatch) {
      logger.error('Failed to update parsing job status', { jobId, status, error: msg1 });
      throw new AppError('Failed to update parsing job', ErrorType.DATABASE, 500);
    }

    // Fallback: try an older schema (result_json instead of output, drop unknown cols)
    const payload2: any = { status };
    if (extra?.error_message != null) payload2.error_message = extra.error_message;
    if (extra?.error_code   != null) payload2.error_code    = extra.error_code;
    if (extra?.finished_at  != null) payload2.finished_at   = extra.finished_at;
    if (extra && Object.prototype.hasOwnProperty.call(extra, 'result_json')) {
      payload2.result_json = extra.result_json;
    }

    const attempt2 = await db
      .from('parsing_jobs')
      .update(payload2)
      .eq('id', jobId)
      .select()
      .single();

    if (attempt2.error) {
      logger.error('Failed to update parsing job status (fallback)', { jobId, status, error: attempt2.error });
      throw new AppError('Failed to update parsing job', ErrorType.DATABASE, 500);
    }
    return attempt2.data;
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
