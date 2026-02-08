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
            throw new errorHandling_1.AppError('Failed to create parsing job', errorHandling_1.ErrorType.DATABASE, 500);
        }
        return data;
    }
    async setStatus(jobId, status, extra) {
        const db = (0, database_1.supabaseAdminClient)();
        // Only update status and output (existing columns)
        const payload = { status };
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
            throw new errorHandling_1.AppError('Failed to update parsing job', errorHandling_1.ErrorType.DATABASE, 500);
        }
        return data;
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
        let query = db
            .from('parsing_jobs')
            .select('*')
            .eq('inbox_attachment_id', attachmentId)
            .eq('status', 'extracted')
            .order('created_at', { ascending: false })
            .limit(1);
        // Note: file_hash column doesn't exist in current schema
        const { data, error } = await query;
        if (error)
            throw error;
        return Array.isArray(data) && data.length ? data[0] : null;
    }
    async findLatestForAttachment(attachmentId) {
        const db = (0, database_1.supabaseAdminClient)();
        const { data, error } = await db
            .from('parsing_jobs')
            .select('*')
            .eq('inbox_attachment_id', attachmentId)
            .order('created_at', { ascending: false })
            .limit(1);
        if (error)
            throw error;
        return Array.isArray(data) && data.length ? data[0] : null;
    }
}
exports.ParsingJobsService = ParsingJobsService;
