"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.processMissingDataEmailReply = processMissingDataEmailReply;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const openaiResponsesService_1 = require("./openaiResponsesService");
const linkedinFollowUpService_1 = require("./linkedinFollowUpService");
const logger = (0, errorHandling_1.createLogger)('MissingDataEmailReplyService');
function stripQuotedReply(text) {
    const lines = String(text || '').split(/\r?\n/);
    const out = [];
    for (const line of lines) {
        const trimmed = line.trim();
        // Common reply separators
        if (/^on\s.+wrote:$/i.test(trimmed))
            break;
        if (/^from:\s/i.test(trimmed) && out.length > 0)
            break;
        if (/^sent:\s/i.test(trimmed) && out.length > 0)
            break;
        if (/^begin_rap_missing_data_v1$/i.test(trimmed)) {
            // Legacy marker (older emails).
            break;
        }
        if (/^---\s*reference\s*\(please keep\)\s*---$/i.test(trimmed)) {
            // New marker (client-friendly emails).
            break;
        }
        if (/^rap_candidate_id\s*:/i.test(trimmed)) {
            break;
        }
        // Drop quoted lines
        if (trimmed.startsWith('>'))
            continue;
        out.push(line);
    }
    return out.join('\n').trim();
}
function buildDynamicSchema(fields) {
    const properties = {};
    for (const f of fields) {
        properties[f] = { anyOf: [{ type: 'string' }, { type: 'null' }] };
    }
    return {
        type: 'object',
        additionalProperties: false,
        properties,
        required: fields,
    };
}
async function processMissingDataEmailReply(args) {
    const db = (0, database_1.supabaseAdminClient)();
    const now = new Date().toISOString();
    try {
        const { data: candidate, error } = await db
            .from('candidates')
            .select('*')
            .eq('id', args.candidateId)
            .maybeSingle();
        if (error || !candidate) {
            return { ok: false, reason: 'candidate_not_found' };
        }
        // Detect first reply so we can send a LinkedIn follow-up only once.
        const isFirstReply = !candidate.missing_data_email_last_reply_processed_at;
        const { calculateMissingFields, EXCEL_BROWSER_FIELDS, enrichCandidateData, updateMissingFields } = await Promise.resolve().then(() => __importStar(require('./progressiveDataCompletionService')));
        const missingFields = calculateMissingFields(candidate);
        if (missingFields.length === 0) {
            // Still record the reply time for audit/cooldown logic.
            await db
                .from('candidates')
                .update({ missing_data_email_last_reply_processed_at: now })
                .eq('id', args.candidateId);
            if (isFirstReply && candidate.email) {
                void (0, linkedinFollowUpService_1.sendLinkedInFollowUp)({ candidateId: args.candidateId, candidateEmail: candidate.email, candidateName: candidate.name || null });
            }
            return { ok: true, updated: [], skipped: [], reason: 'nothing_missing' };
        }
        const cleaned = stripQuotedReply(args.emailBodyText);
        if (!cleaned) {
            await db
                .from('candidates')
                .update({ missing_data_email_last_reply_processed_at: now })
                .eq('id', args.candidateId);
            if (isFirstReply && candidate.email) {
                void (0, linkedinFollowUpService_1.sendLinkedInFollowUp)({ candidateId: args.candidateId, candidateEmail: candidate.email, candidateName: candidate.name || null });
            }
            return { ok: true, updated: [], skipped: missingFields, reason: 'empty_reply' };
        }
        const labels = {};
        for (const f of missingFields) {
            labels[f] = EXCEL_BROWSER_FIELDS[f] || f;
        }
        const prompt = [
            'You extract only explicitly provided values from a candidate\'s email reply.',
            'Return JSON ONLY matching the provided schema.',
            'Rules:',
            '- Do not guess or infer missing values.',
            '- If a field is not provided, return null for it.',
            '- Keep the value as the candidate wrote it (but remove surrounding quotes).',
            '',
            'Missing fields to extract:',
            ...missingFields.map((f) => `- ${f} (${labels[f]})`),
            '',
            'Candidate reply:',
            cleaned,
        ].join('\n');
        const model = process.env.OPENAI_MODEL || 'gpt-4o-mini-2024-07-18';
        const extracted = await (0, openaiResponsesService_1.openaiCreateJsonSchemaTextResponse)({
            model,
            prompt,
            schemaName: 'missing_data_email_reply',
            schema: buildDynamicSchema(missingFields),
            timeoutMs: 20000,
        });
        const enrichmentResult = await enrichCandidateData(args.candidateId, extracted, 'email_reply', undefined, 'email_reply');
        await updateMissingFields(args.candidateId);
        await db
            .from('candidates')
            .update({
            missing_data_email_last_reply_processed_at: now,
            ...(enrichmentResult.updated.length === 0 && args.hadAttachments === false
                ? { missing_data_email_status: 'stopped', missing_data_email_next_send_at: null }
                : {}),
        })
            .eq('id', args.candidateId);
        logger.info('Processed missing-data email reply', {
            candidateId: args.candidateId,
            updated: enrichmentResult.updated,
            skipped: enrichmentResult.skipped,
        });
        if (isFirstReply && candidate.email) {
            void (0, linkedinFollowUpService_1.sendLinkedInFollowUp)({ candidateId: args.candidateId, candidateEmail: candidate.email, candidateName: candidate.name || null });
        }
        return { ok: true, updated: enrichmentResult.updated, skipped: enrichmentResult.skipped };
    }
    catch (err) {
        logger.error('processMissingDataEmailReply failed', err, { candidateId: args.candidateId });
        return { ok: false, reason: 'error' };
    }
}
