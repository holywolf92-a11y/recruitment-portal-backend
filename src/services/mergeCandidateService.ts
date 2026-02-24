/**
 * mergeCandidateService.ts
 *
 * Merges two candidate records: the "winner" survives, the "loser" is soft-deleted.
 *
 * What gets transferred from loser → winner:
 *   • candidate_documents      (only those not already on winner)
 *   • inbox_attachments        (candidate_id pointer re-targeted)
 *   • parsing_jobs             (n/a — linked via inbox_attachments, not candidate directly)
 *
 * An immutable row is written to candidate_merges for auditability.
 *
 * Usage:
 *   await mergeCandidates(winnerId, loserId, 'admin', 'winner_wins');
 */

import { supabaseAdminClient } from '../config/database';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('MergeCandidateService');

export type MergeStrategy = 'winner_wins' | 'loser_wins' | 'manual';

export interface MergeOptions {
  /** How to resolve fields the winner is missing vs the loser has. Default: 'winner_wins' (loser fills gaps). */
  strategy?: MergeStrategy;
  /** Caller-supplied explicit field values overriding both sides (only used with strategy='manual'). */
  fieldOverrides?: Record<string, any>;
  /** Why this merge was triggered (review reasons from CandidateMatcher, or admin note). */
  reviewReasons?: string[];
  /** Identifier of who triggered the merge. Defaults to 'system'. */
  mergedBy?: string;
}

export interface MergeResult {
  winnerId: string;
  loserId: string;
  mergeAuditId: string;
  documentsMoved: number;
  attachmentsRelinked: number;
  fieldsFilledIn: string[];
}

/**
 * Merge loser candidate into winner candidate.
 *
 * @param winnerId  The candidate that survives.
 * @param loserId   The candidate to be soft-deleted. Its documents are moved to winner.
 */
export async function mergeCandidates(
  winnerId: string,
  loserId: string,
  options: MergeOptions = {}
): Promise<MergeResult> {
  const db = supabaseAdminClient();
  const strategy = options.strategy ?? 'winner_wins';
  const mergedBy = options.mergedBy ?? 'system';

  if (winnerId === loserId) {
    throw new Error('Cannot merge a candidate with itself');
  }

  // ── Fetch both candidates ────────────────────────────────────────────────
  const [{ data: winner, error: winnerErr }, { data: loser, error: loserErr }] = await Promise.all([
    db.from('candidates').select('*').eq('id', winnerId).neq('status', 'Deleted').single(),
    db.from('candidates').select('*').eq('id', loserId).neq('status', 'Deleted').single(),
  ]);

  if (winnerErr || !winner) throw new Error(`Winner candidate not found: ${winnerId}`);
  if (loserErr || !loser) throw new Error(`Loser candidate not found: ${loserId}`);

  // ── Step 1: Fill in missing fields on winner from loser ──────────────────
  const FILLABLE_FIELDS = [
    'father_name', 'date_of_birth', 'cnic', 'cnic_normalized', 'passport', 'passport_normalized',
    'passport_expiry', 'nationality', 'gender', 'marital_status', 'address', 'phone',
    'email', 'position', 'experience_years', 'country_of_interest', 'education',
    'skills', 'languages', 'certifications', 'previous_employment', 'professional_summary',
    'profile_photo_url', 'profile_photo_bucket', 'profile_photo_path',
  ];

  const updates: Record<string, any> = {};
  const fieldsFilledIn: string[] = [];

  if (strategy === 'loser_wins') {
    // Loser's non-null fields overwrite winner's fields
    for (const field of FILLABLE_FIELDS) {
      if (loser[field] !== null && loser[field] !== undefined && loser[field] !== '') {
        updates[field] = loser[field];
        fieldsFilledIn.push(field);
      }
    }
  } else if (strategy === 'winner_wins') {
    // Fill in winner's empty fields from loser
    for (const field of FILLABLE_FIELDS) {
      const winnerEmpty = winner[field] === null || winner[field] === undefined || winner[field] === '';
      const loserHas = loser[field] !== null && loser[field] !== undefined && loser[field] !== '';
      if (winnerEmpty && loserHas) {
        updates[field] = loser[field];
        fieldsFilledIn.push(field);
      }
    }
  } else if (strategy === 'manual' && options.fieldOverrides) {
    Object.assign(updates, options.fieldOverrides);
    fieldsFilledIn.push(...Object.keys(options.fieldOverrides));
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateErr } = await db
      .from('candidates')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', winnerId);
    if (updateErr) {
      logger.warn('Failed to fill in winner fields from loser', { message: updateErr.message });
      // Non-fatal — continue with merge
    }
  }

  // ── Step 2: Re-point inbox_attachments from loser → winner ──────────────
  const { data: relinkData, error: relinkErr } = await db
    .from('inbox_attachments')
    .update({ candidate_id: winnerId })
    .eq('candidate_id', loserId)
    .select('id');

  const attachmentsRelinked = relinkData?.length ?? 0;
  if (relinkErr) {
    logger.warn('Failed to relink inbox_attachments', { message: relinkErr.message });
  }

  // ── Step 3: Move candidate_documents from loser → winner ─────────────────
  // Avoid duplicating documents the winner already has (same file_name + document_type).
  const { data: winnerDocs } = await db
    .from('candidate_documents')
    .select('file_name, document_type')
    .eq('candidate_id', winnerId);

  const winnerDocKeys = new Set(
    (winnerDocs || []).map((d: any) => `${d.document_type}::${d.file_name}`)
  );

  const { data: loserDocs } = await db
    .from('candidate_documents')
    .select('id, file_name, document_type')
    .eq('candidate_id', loserId);

  const docsToMove = (loserDocs || []).filter(
    (d: any) => !winnerDocKeys.has(`${d.document_type}::${d.file_name}`)
  );

  let documentsMoved = 0;
  if (docsToMove.length > 0) {
    const docIds = docsToMove.map((d: any) => d.id);
    const { error: moveErr } = await db
      .from('candidate_documents')
      .update({ candidate_id: winnerId })
      .in('id', docIds);
    if (moveErr) {
      logger.warn('Failed to move some candidate_documents', { message: moveErr.message });
    } else {
      documentsMoved = docIds.length;
    }
  }

  // Soft-delete remaining loser documents (duplicates of what winner already had)
  const docsToDelete = (loserDocs || [])
    .filter((d: any) => !docsToMove.some((m: any) => m.id === d.id))
    .map((d: any) => d.id);

  if (docsToDelete.length > 0) {
    await db.from('candidate_documents').delete().in('id', docsToDelete);
  }

  // ── Step 4: Soft-delete the loser ────────────────────────────────────────
  const { error: deleteErr } = await db
    .from('candidates')
    .update({ status: 'Deleted', updated_at: new Date().toISOString() })
    .eq('id', loserId);

  if (deleteErr) {
    throw new Error(`Failed to soft-delete loser candidate: ${deleteErr.message}`);
  }

  // ── Step 5: Write audit record ───────────────────────────────────────────
  const { data: auditRow, error: auditErr } = await db
    .from('candidate_merges')
    .insert({
      winner_id: winnerId,
      loser_id: loserId,
      merged_by: mergedBy,
      merge_strategy: strategy,
      field_overrides: fieldsFilledIn.length > 0
        ? Object.fromEntries(fieldsFilledIn.map(f => [f, { from: loser[f], to: updates[f] ?? winner[f] }]))
        : null,
      review_reasons: options.reviewReasons ?? null,
    })
    .select('id')
    .single();

  if (auditErr) {
    // Non-fatal: merge succeeded, audit write failed. Log but don't roll back.
    logger.error('Failed to write candidate_merges audit row', { message: auditErr.message });
  }

  const result: MergeResult = {
    winnerId,
    loserId,
    mergeAuditId: auditRow?.id ?? 'audit-write-failed',
    documentsMoved,
    attachmentsRelinked,
    fieldsFilledIn,
  };

  logger.info('Candidate merge complete', result);
  return result;
}

/**
 * Fetch merge history for a candidate (either as winner or loser).
 */
export async function getCandidateMergeHistory(candidateId: string) {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('candidate_merges')
    .select('*')
    .or(`winner_id.eq.${candidateId},loser_id.eq.${candidateId}`)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch merge history: ${error.message}`);
  return data ?? [];
}
