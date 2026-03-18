"use strict";
/**
 * mergeCandidateService.ts
 *
 * Merges two candidate records: the "winner" survives, the "loser" is soft-deleted.
 *
 * Enterprise-grade guarantees:
 *   ✔ Full DB transaction via merge_candidates_atomic() PL/pgSQL function
 *   ✔ SELECT FOR UPDATE row-level locking prevents concurrent merges
 *   ✔ Pre-merge JSON snapshot stored in candidate_merges.pre_merge_snapshot
 *   ✔ Immutable audit row written atomically with all other changes
 *   ✔ Any failure rolls back ALL steps — no partial merges
 *
 * What gets transferred from loser → winner (computed in TS, applied atomically in PG):
 *   • Field-filling: winner's NULL fields filled from loser (or overwritten for loser_wins)
 *   • inbox_attachments  — candidate_id pointer re-targeted
 *   • candidate_documents — moved to winner; duplicates deleted
 *   • candidate_merges   — immutable audit row + pre-merge snapshot
 *
 * Usage:
 *   await mergeCandidates(winnerId, loserId, { mergedBy: 'admin', strategy: 'winner_wins' });
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeCandidates = mergeCandidates;
exports.getCandidateMergeHistory = getCandidateMergeHistory;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('MergeCandidateService');
/**
 * Merge loser candidate into winner candidate.
 *
 * All destructive writes are delegated to merge_candidates_atomic() which
 * wraps them in a single Postgres transaction with SELECT FOR UPDATE locking.
 *
 * @param winnerId  The candidate that survives (keeps its candidate_code).
 * @param loserId   The candidate to be soft-deleted.
 */
async function mergeCandidates(winnerId, loserId, options = {}) {
    const db = (0, database_1.supabaseAdminClient)();
    const strategy = options.strategy ?? 'winner_wins';
    const mergedBy = options.mergedBy ?? 'system';
    if (winnerId === loserId) {
        throw new Error('Cannot merge a candidate with itself');
    }
    // ── Phase 1 (read-only): Fetch both records and compute all changes ───────
    //    Nothing is written in this phase — if RPC fails, nothing is committed.
    const [{ data: winner, error: winnerErr }, { data: loser, error: loserErr }] = await Promise.all([
        db.from('candidates').select('*').eq('id', winnerId).neq('status', 'Deleted').single(),
        db.from('candidates').select('*').eq('id', loserId).neq('status', 'Deleted').single(),
    ]);
    if (winnerErr || !winner)
        throw new Error(`Winner candidate not found: ${winnerId}`);
    if (loserErr || !loser)
        throw new Error(`Loser candidate not found: ${loserId}`);
    // ── Pre-merge snapshot: captures both records BEFORE any write ────────────
    //    Stored in candidate_merges.pre_merge_snapshot for forensic audit.
    const preMergeSnapshot = {
        winner_before: { ...winner },
        loser_before: { ...loser },
        captured_at: new Date().toISOString(),
    };
    // ── Compute winner field updates ─────────────────────────────────────────
    const FILLABLE_FIELDS = [
        'father_name', 'date_of_birth', 'cnic', 'cnic_normalized', 'passport', 'passport_normalized',
        'passport_expiry', 'nationality', 'gender', 'marital_status', 'address', 'phone',
        'email', 'position', 'experience_years', 'country_of_interest', 'education',
        'skills', 'languages', 'certifications', 'previous_employment', 'professional_summary',
        'profile_photo_url', 'profile_photo_bucket', 'profile_photo_path',
    ];
    const updates = {};
    const fieldsFilledIn = [];
    if (strategy === 'loser_wins') {
        for (const field of FILLABLE_FIELDS) {
            if (loser[field] !== null && loser[field] !== undefined && loser[field] !== '') {
                updates[field] = loser[field];
                fieldsFilledIn.push(field);
            }
        }
    }
    else if (strategy === 'winner_wins') {
        for (const field of FILLABLE_FIELDS) {
            const winnerEmpty = winner[field] === null || winner[field] === undefined || winner[field] === '';
            const loserHas = loser[field] !== null && loser[field] !== undefined && loser[field] !== '';
            if (winnerEmpty && loserHas) {
                updates[field] = loser[field];
                fieldsFilledIn.push(field);
            }
        }
    }
    else if (strategy === 'manual' && options.fieldOverrides) {
        Object.assign(updates, options.fieldOverrides);
        fieldsFilledIn.push(...Object.keys(options.fieldOverrides));
    }
    // ── Compute document split (move vs delete) ──────────────────────────────
    const [{ data: winnerDocs }, { data: loserDocs }] = await Promise.all([
        db.from('candidate_documents').select('id, file_name, document_type').eq('candidate_id', winnerId),
        db.from('candidate_documents').select('id, file_name, document_type').eq('candidate_id', loserId),
    ]);
    const winnerDocKeys = new Set((winnerDocs || []).map((d) => `${d.document_type}::${d.file_name}`));
    const docsToMoveIds = [];
    const docsToDeleteIds = [];
    for (const d of (loserDocs || [])) {
        if (winnerDocKeys.has(`${d.document_type}::${d.file_name}`)) {
            docsToDeleteIds.push(d.id);
        }
        else {
            docsToMoveIds.push(d.id);
        }
    }
    // ── Build field diff for audit log ───────────────────────────────────────
    const fieldOverridesDiff = fieldsFilledIn.length > 0
        ? Object.fromEntries(fieldsFilledIn.map(f => [f, { from: loser[f], to: updates[f] ?? winner[f] }]))
        : null;
    // ── Phase 2 (atomic write): Single PG transaction via RPC ────────────────
    //    merge_candidates_atomic() does SELECT FOR UPDATE on both rows first,
    //    preventing concurrent merges. Any failure auto-rolls back all steps.
    const { data: rpcResult, error: rpcError } = await db.rpc('merge_candidates_atomic', {
        p_winner_id: winnerId,
        p_loser_id: loserId,
        p_winner_updates: Object.keys(updates).length > 0 ? updates : {},
        p_docs_to_move: docsToMoveIds.length > 0 ? docsToMoveIds : null,
        p_docs_to_delete: docsToDeleteIds.length > 0 ? docsToDeleteIds : null,
        p_merged_by: mergedBy,
        p_strategy: strategy,
        p_pre_merge_snapshot: preMergeSnapshot,
        p_field_overrides: fieldOverridesDiff,
        p_review_reasons: options.reviewReasons ?? null,
    });
    if (rpcError) {
        // Postgres automatically rolled back — no partial state exists
        logger.error('merge_candidates_atomic RPC failed — full rollback guaranteed', rpcError);
        throw new Error(`Merge failed (rolled back): ${rpcError.message}`);
    }
    const result = {
        winnerId,
        loserId,
        mergeAuditId: rpcResult?.audit_id ?? 'unknown',
        documentsMoved: rpcResult?.docs_moved ?? docsToMoveIds.length,
        attachmentsRelinked: rpcResult?.attachments_relinked ?? 0,
        fieldsFilledIn,
    };
    logger.info('Candidate merge complete (atomic, locked)', result);
    return result;
}
/**
 * Fetch merge history for a candidate (either as winner or loser).
 */
async function getCandidateMergeHistory(candidateId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidate_merges')
        .select('*')
        .or(`winner_id.eq.${candidateId},loser_id.eq.${candidateId}`)
        .order('created_at', { ascending: false });
    if (error)
        throw new Error(`Failed to fetch merge history: ${error.message}`);
    return data ?? [];
}
