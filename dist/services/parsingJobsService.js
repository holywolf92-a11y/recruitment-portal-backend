"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParsingJobsService = void 0;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('ParsingJobsService');
class ParsingJobsService {
    async createJob(input) {
        const db = (0, database_1.supabaseAdminClient)();
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
        })
            .select()
            .single();
        if (!attempt1.error)
            return attempt1.data;
        const msg1 = String(attempt1.error?.message || attempt1.error);
        const shouldFallback = /column\s+"?inbox_attachment_id"?\s+does\s+not\s+exist/i.test(msg1) ||
            /null value in column\s+"?attachment_id"?\s+violates\s+not-null constraint/i.test(msg1);
        if (!shouldFallback) {
            logger.error('Failed to create parsing job', attempt1.error);
            throw new errorHandling_1.AppError('Failed to create parsing job', errorHandling_1.ErrorType.DATABASE, 500);
        }
        const attempt2 = await db
            .from('parsing_jobs')
            .insert({
            attachment_id: input.attachmentId,
            file_hash: input.fileHash ?? null,
            status: 'queued',
            attempts: 0,
            created_at: now,
        })
            .select()
            .single();
        if (attempt2.error) {
            logger.error('Failed to create parsing job (fallback)', attempt2.error);
            throw new errorHandling_1.AppError('Failed to create parsing job', errorHandling_1.ErrorType.DATABASE, 500);
        }
        return attempt2.data;
    }
    async setStatus(jobId, status, extra) {
        const db = (0, database_1.supabaseAdminClient)();
        // Only update status + one output column.
        // We intentionally keep this minimal to avoid breaking on schema differences.
        const payload1 = { status };
        if (extra && Object.prototype.hasOwnProperty.call(extra, 'result_json')) {
            payload1.output = extra.result_json;
        }
        const attempt1 = await db
            .from('parsing_jobs')
            .update(payload1)
            .eq('id', jobId)
            .select()
            .single();
        if (!attempt1.error)
            return attempt1.data;
        const msg1 = String(attempt1.error?.message || attempt1.error);
        const shouldFallback = /column\s+"?output"?\s+does\s+not\s+exist/i.test(msg1);
        if (!shouldFallback) {
            throw new errorHandling_1.AppError('Failed to update parsing job', errorHandling_1.ErrorType.DATABASE, 500);
        }
        const payload2 = { status };
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
            throw new errorHandling_1.AppError('Failed to update parsing job', errorHandling_1.ErrorType.DATABASE, 500);
        }
        return attempt2.data;
    }
    async getJob(jobId) {
        const db = (0, database_1.supabaseAdminClient)();
        const { data, error } = await db
            .from('parsing_jobs')
            .select('*')
            .eq('id', jobId)
            .single();
        if (error) {
            if (error.code === 'PGRST116')
                return null;
            throw error;
        }
        return data;
    }
    async findLatestExtractedForAttachment(attachmentId, fileHash) {
        const db = (0, database_1.supabaseAdminClient)();
        // Try inbox_attachment_id first, then fall back to attachment_id.
        const attempt1 = await db
            .from('parsing_jobs')
            .select('*')
            .eq('inbox_attachment_id', attachmentId)
            .eq('status', 'extracted')
            .order('created_at', { ascending: false })
            .limit(1);
        if (!attempt1.error) {
            return Array.isArray(attempt1.data) && attempt1.data.length ? attempt1.data[0] : null;
        }
        const msg1 = String(attempt1.error?.message || attempt1.error);
        const shouldFallback = /column\s+"?inbox_attachment_id"?\s+does\s+not\s+exist/i.test(msg1);
        if (!shouldFallback)
            throw attempt1.error;
        const attempt2 = await db
            .from('parsing_jobs')
            .select('*')
            .eq('attachment_id', attachmentId)
            .eq('status', 'extracted')
            .order('created_at', { ascending: false })
            .limit(1);
        if (attempt2.error)
            throw attempt2.error;
        return Array.isArray(attempt2.data) && attempt2.data.length ? attempt2.data[0] : null;
    }
    async findLatestForAttachment(attachmentId) {
        const db = (0, database_1.supabaseAdminClient)();
        const attempt1 = await db
            .from('parsing_jobs')
            .select('*')
            .eq('inbox_attachment_id', attachmentId)
            .order('created_at', { ascending: false })
            .limit(1);
        if (!attempt1.error) {
            return Array.isArray(attempt1.data) && attempt1.data.length ? attempt1.data[0] : null;
        }
        const msg1 = String(attempt1.error?.message || attempt1.error);
        const shouldFallback = /column\s+"?inbox_attachment_id"?\s+does\s+not\s+exist/i.test(msg1);
        if (!shouldFallback)
            throw attempt1.error;
        const attempt2 = await db
            .from('parsing_jobs')
            .select('*')
            .eq('attachment_id', attachmentId)
            .order('created_at', { ascending: false })
            .limit(1);
        if (attempt2.error)
            throw attempt2.error;
        return Array.isArray(attempt2.data) && attempt2.data.length ? attempt2.data[0] : null;
    }
}
exports.ParsingJobsService = ParsingJobsService;
