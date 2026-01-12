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
    const { data, error } = await db
      .from('parsing_jobs')
      .insert({
        inbox_attachment_id: input.attachmentId,
        status: 'queued',
        created_at: now,
      })
      .select()
      .single();
    if (error) {
      logger.error('Failed to create parsing job', error);
      throw new AppError('Failed to create parsing job', ErrorType.DATABASE, 500);
    }
    return data;
  }

  async setStatus(jobId: string, status: JobStatus, extra?: Record<string, any>) {
    const db = supabaseAdminClient();
    // Only update status and output (existing columns)
    const payload: any = { status };
    if (extra && extra.result_json) {
      payload.output = extra.result_json;
    }
    const { data, error } = await db
      .from('parsing_jobs')
      .update(payload)
      .eq('id', jobId)
      .select()
      .single();
    if (error) {
      throw new AppError('Failed to update parsing job', ErrorType.DATABASE, 500);
    }
    return data;
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
    let query = db
      .from('parsing_jobs')
      .select('*')
      .eq('inbox_attachment_id', attachmentId)
      .eq('status', 'extracted' as JobStatus)
      .order('created_at', { ascending: false })
      .limit(1);
    // Note: file_hash column doesn't exist in current schema
    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) && data.length ? data[0] : null;
  }
}
