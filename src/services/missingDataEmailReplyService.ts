import { supabaseAdminClient } from '../config/database';
import { createLogger } from '../utils/errorHandling';
import { openaiCreateJsonSchemaTextResponse } from './openaiResponsesService';
import { sendLinkedInFollowUp } from './linkedinFollowUpService';

const logger = createLogger('MissingDataEmailReplyService');

function stripQuotedReply(text: string): string {
  const lines = String(text || '').split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Common reply separators
    if (/^on\s.+wrote:$/i.test(trimmed)) break;
    if (/^from:\s/i.test(trimmed) && out.length > 0) break;
    if (/^sent:\s/i.test(trimmed) && out.length > 0) break;
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
    if (trimmed.startsWith('>')) continue;

    out.push(line);
  }

  return out.join('\n').trim();
}

function buildDynamicSchema(fields: string[]) {
  const properties: Record<string, any> = {};
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

export async function processMissingDataEmailReply(args: {
  candidateId: string;
  emailBodyText: string;
  hadAttachments?: boolean;
}) {
  const db = supabaseAdminClient();

  const now = new Date().toISOString();

  try {
    const { data: candidate, error } = await db
      .from('candidates')
      .select('*')
      .eq('id', args.candidateId)
      .maybeSingle();

    if (error || !candidate) {
      return { ok: false, reason: 'candidate_not_found' } as const;
    }

    // Detect first reply so we can send a LinkedIn follow-up only once.
    const isFirstReply = !candidate.missing_data_email_last_reply_processed_at;

    const { calculateMissingFields, EXCEL_BROWSER_FIELDS, enrichCandidateData, updateMissingFields } = await import(
      './progressiveDataCompletionService'
    );

    const missingFields: string[] = calculateMissingFields(candidate);
    if (missingFields.length === 0) {
      // Still record the reply time for audit/cooldown logic.
      await db
        .from('candidates')
        .update({ missing_data_email_last_reply_processed_at: now })
        .eq('id', args.candidateId);

      if (isFirstReply && candidate.email) {
        void sendLinkedInFollowUp({ candidateId: args.candidateId, candidateEmail: candidate.email, candidateName: candidate.name || null });
      }
      return { ok: true, updated: [], skipped: [], reason: 'nothing_missing' } as const;
    }

    const cleaned = stripQuotedReply(args.emailBodyText);
    if (!cleaned) {
      await db
        .from('candidates')
        .update({ missing_data_email_last_reply_processed_at: now })
        .eq('id', args.candidateId);

      if (isFirstReply && candidate.email) {
        void sendLinkedInFollowUp({ candidateId: args.candidateId, candidateEmail: candidate.email, candidateName: candidate.name || null });
      }
      return { ok: true, updated: [], skipped: missingFields, reason: 'empty_reply' } as const;
    }

    const labels: Record<string, string> = {};
    for (const f of missingFields) {
      labels[f] = (EXCEL_BROWSER_FIELDS as any)[f] || f;
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

    const extracted = await openaiCreateJsonSchemaTextResponse<Record<string, string | null>>({
      model,
      prompt,
      schemaName: 'missing_data_email_reply',
      schema: buildDynamicSchema(missingFields),
      timeoutMs: 20000,
    });

    const enrichmentResult = await enrichCandidateData(
      args.candidateId,
      extracted,
      'email_reply',
      undefined,
      'email_reply'
    );

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
      void sendLinkedInFollowUp({ candidateId: args.candidateId, candidateEmail: candidate.email, candidateName: candidate.name || null });
    }

    return { ok: true, updated: enrichmentResult.updated, skipped: enrichmentResult.skipped } as const;
  } catch (err) {
    logger.error('processMissingDataEmailReply failed', err, { candidateId: args.candidateId });
    return { ok: false, reason: 'error' } as const;
  }
}
