"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.linkExistingCVFromInbox = linkExistingCVFromInbox;
const database_1 = require("../config/database");
const documentCategories_1 = require("../config/documentCategories");
const errorHandling_1 = require("../utils/errorHandling");
const STORAGE_BUCKET = 'documents';
/**
 * Link existing CV from inbox_attachments to candidate_documents without re-uploading
 * This prevents duplicate CVs in the database
 */
async function linkExistingCVFromInbox(candidateId) {
    const db = (0, database_1.supabaseAdminClient)();
    // Check if CV already exists in candidate_documents
    const { data: existingCV } = await db
        .from('candidate_documents')
        .select('*')
        .eq('candidate_id', candidateId)
        .or('category.ilike.cv,category.ilike.cv_resume')
        .maybeSingle();
    if (existingCV) {
        console.log(`[LinkCV] CV already exists in candidate_documents for candidate ${candidateId}`);
        return existingCV;
    }
    // Find CV in inbox_attachments
    const { data: inboxCVs, error: inboxError } = await db
        .from('inbox_attachments')
        .select('*')
        .or(`candidate_id.eq.${candidateId},linked_candidate_id.eq.${candidateId}`)
        .or('attachment_kind.ilike.cv,document_type.ilike.cv')
        .order('created_at', { ascending: false })
        .limit(1);
    if (inboxError || !inboxCVs || inboxCVs.length === 0) {
        throw new errorHandling_1.AppError('No CV found in inbox attachments for this candidate', errorHandling_1.ErrorType.NOT_FOUND, 404);
    }
    const inboxCV = inboxCVs[0];
    // Get inbox message for source info
    const { data: message } = await db
        .from('inbox_messages')
        .select('source')
        .eq('id', inboxCV.inbox_message_id)
        .maybeSingle();
    const source = message?.source || 'gmail'; // Default to gmail if not found
    const storagePath = inboxCV.storage_path;
    const storageBucket = inboxCV.storage_bucket || STORAGE_BUCKET;
    // Create candidate_documents record linking to existing inbox attachment
    const { data: newDocument, error: insertError } = await db
        .from('candidate_documents')
        .insert({
        candidate_id: candidateId,
        category: 'cv_resume',
        storage_bucket: storageBucket,
        storage_path: storagePath,
        file_name: inboxCV.file_name || 'CV.pdf',
        mime_type: inboxCV.mime_type || 'application/pdf',
        source: source === 'gmail' ? 'gmail' : source === 'whatsapp' ? 'whatsapp' : 'web',
        verification_status: documentCategories_1.VERIFICATION_STATUS.VERIFIED, // CVs from inbox are already processed
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    })
        .select()
        .single();
    if (insertError || !newDocument) {
        console.error('[LinkCV] Failed to create candidate_documents record:', insertError);
        throw new errorHandling_1.AppError(`Failed to link CV: ${insertError?.message || 'Unknown error'}`, errorHandling_1.ErrorType.DATABASE, 500);
    }
    // Update inbox_attachment to link to candidate if not already linked
    if (!inboxCV.linked_candidate_id) {
        await db
            .from('inbox_attachments')
            .update({ linked_candidate_id: candidateId })
            .eq('id', inboxCV.id);
    }
    // Update candidate flags
    try {
        await db
            .from('candidates')
            .update({
            cv_received: true,
            cv_received_at: new Date().toISOString(),
        })
            .eq('id', candidateId);
    }
    catch (flagError) {
        console.error('[LinkCV] Failed to update candidate flags:', flagError);
        // Don't fail if flag update fails
    }
    console.log(`[LinkCV] Successfully linked CV from inbox_attachments to candidate_documents for candidate ${candidateId}`);
    return newDocument;
}
