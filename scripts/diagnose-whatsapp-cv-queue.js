/*
  Diagnose: WhatsApp CVs showing "Queued" in CV Inbox.

  CV Inbox UI logic (frontend):
  - If inbox_attachments.candidate_id exists => shows extracted
  - Else shows queued unless there is a parsing_jobs row and status is used

  This script queries Supabase (service role) to count WhatsApp CV attachments
  over a time window and classify why they're still queued.

  Usage:
    cd recruitment-portal-backend
    node -r dotenv/config scripts/diagnose-whatsapp-cv-queue.js

  Optional env vars:
    WHATSAPP_SINCE_HOURS=24
    WHATSAPP_SINCE_ISO=2026-02-23T00:00:00.000Z
    WHATSAPP_LIMIT=200
*/

const { createClient } = require('@supabase/supabase-js');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function pickSinceIso() {
  const sinceIso = process.env.WHATSAPP_SINCE_ISO;
  if (sinceIso) return new Date(sinceIso).toISOString();
  const hours = Number(process.env.WHATSAPP_SINCE_HOURS || '24');
  const ms = hours > 0 ? hours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

function toKey(v) {
  return v === null || v === undefined ? '' : String(v);
}

function chunkArray(items, chunkSize) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const size = Math.max(1, Number(chunkSize || 200));
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function looksLikeCvAttachment(att) {
  const attachmentKind = String(att.attachment_kind || att.attachment_type || '').toLowerCase();
  const documentType = String(att.document_type || '').toLowerCase();
  const fileName = String(att.file_name || '').toLowerCase();

  if (attachmentKind === 'cv') return true;
  if (documentType === 'cv' || documentType === 'resume') return true;
  if (fileName.includes('resume') || fileName.includes('cv')) return true;

  return false;
}

async function main() {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const since = pickSinceIso();
  const limit = Number(process.env.WHATSAPP_LIMIT || '500');

  console.log(JSON.stringify({ since, limit }, null, 2));

  // 1) Fetch WhatsApp inbox messages for window
  const msgRes = await supabase
    .from('inbox_messages')
    .select('id, received_at, status, source')
    .ilike('source', '%whatsapp%')
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(limit);

  if (msgRes.error) throw new Error(`inbox_messages query failed: ${msgRes.error.message}`);

  const messages = msgRes.data || [];
  const messageIds = messages.map((m) => m.id);

  const uniqueSources = Array.from(
    new Set(messages.map((m) => (m?.source ? String(m.source) : '')).filter(Boolean))
  ).slice(0, 20);
  console.log(
    JSON.stringify(
      { whatsapp_like_messages_found: messages.length, source_samples: uniqueSources },
      null,
      2
    )
  );

  if (messageIds.length === 0) {
    console.log('No WhatsApp-like messages found in window.');

    // Fallback: show what sources do exist in this time window.
    const fallbackRes = await supabase
      .from('inbox_messages')
      .select('source')
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(Math.min(limit, 2000));

    if (!fallbackRes.error) {
      const counts = {};
      for (const row of fallbackRes.data || []) {
        const key = toKey(row?.source || '');
        counts[key] = (counts[key] || 0) + 1;
      }
      console.log('\n=== SOURCE COUNTS (fallback) ===');
      console.log(JSON.stringify(counts, null, 2));
    }

    return;
  }

  // 2) Fetch attachments for those messages (CV type)
  // We keep selection tight to reduce payload.
  const attachmentSelect =
    'id, inbox_message_id, file_name, mime_type, storage_bucket, storage_path, attachment_type, attachment_kind, document_type, candidate_id, linked_candidate_id, created_at';
  const fallbackAttachmentSelect =
    'id, inbox_message_id, file_name, mime_type, storage_bucket, storage_path, attachment_type, document_type, candidate_id, linked_candidate_id, created_at';

  const attachmentsRaw = [];
  for (const messageIdsChunk of chunkArray(messageIds, 200)) {
    let res = await supabase
      .from('inbox_attachments')
      .select(attachmentSelect)
      .in('inbox_message_id', messageIdsChunk)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (res.error && String(res.error.message || '').toLowerCase().includes('attachment_kind')) {
      res = await supabase
        .from('inbox_attachments')
        .select(fallbackAttachmentSelect)
        .in('inbox_message_id', messageIdsChunk)
        .order('created_at', { ascending: false })
        .limit(limit);
    }

    if (res.error) throw new Error(`inbox_attachments query failed: ${res.error.message}`);
    attachmentsRaw.push(...(res.data || []));
  }

  console.log(
    JSON.stringify(
      {
        linked_attachments_found: attachmentsRaw.length,
        attachment_type_counts: (() => {
          const counts = {};
          for (const a of attachmentsRaw) {
            const key = toKey(a?.attachment_type || '');
            counts[key] = (counts[key] || 0) + 1;
          }
          return counts;
        })(),
        attachment_kind_counts: (() => {
          const counts = {};
          for (const a of attachmentsRaw) {
            const key = toKey(a?.attachment_kind || '');
            counts[key] = (counts[key] || 0) + 1;
          }
          return counts;
        })(),
        document_type_counts: (() => {
          const counts = {};
          for (const a of attachmentsRaw) {
            const key = toKey(a?.document_type || '');
            counts[key] = (counts[key] || 0) + 1;
          }
          return counts;
        })(),
        attachment_samples: attachmentsRaw.slice(0, 5).map((a) => ({
          id: a.id,
          inbox_message_id: a.inbox_message_id,
          file_name: a.file_name,
          mime_type: a.mime_type,
          attachment_kind: a.attachment_kind,
          attachment_type: a.attachment_type,
          document_type: a.document_type,
          candidate_id: a.candidate_id,
          created_at: a.created_at,
        })),
      },
      null,
      2
    )
  );

  // Mirror CVInbox behavior: it lists all attachments for WhatsApp messages
  // and then checks candidate_id / parsing job status per attachment.
  const attachments = attachmentsRaw;
  const cvLikeAttachments = attachmentsRaw.filter(looksLikeCvAttachment);

  console.log(
    JSON.stringify(
      {
        cv_like_attachments_found: cvLikeAttachments.length,
        cv_like_attachment_samples: cvLikeAttachments.slice(0, 5).map((a) => ({
          id: a.id,
          file_name: a.file_name,
          mime_type: a.mime_type,
          attachment_kind: a.attachment_kind,
          attachment_type: a.attachment_type,
          document_type: a.document_type,
          candidate_id: a.candidate_id,
          created_at: a.created_at,
        })),
      },
      null,
      2
    )
  );

  // Map msg info
  const messageById = new Map(messages.map((m) => [m.id, m]));

  // 3) Fetch parsing jobs for these attachments (schema might use inbox_attachment_id OR attachment_id)
  const attachmentIds = attachments.map((a) => a.id);

  const jobByAttachment = new Map();
  if (attachmentIds.length) {
    for (const attachmentIdsChunk of chunkArray(attachmentIds, 150)) {
      const jobsCombined = [];

      // Some deployments only have inbox_attachment_id; others used attachment_id.
      // Query each possible column separately and ignore missing-column errors.
      const resInbox = await supabase
        .from('parsing_jobs')
        .select('id, status, created_at, inbox_attachment_id')
        .in('inbox_attachment_id', attachmentIdsChunk)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (resInbox.error) {
        const msg = String(resInbox.error.message || '').toLowerCase();
        if (!msg.includes('inbox_attachment_id')) {
          throw new Error(`parsing_jobs query failed: ${resInbox.error.message}`);
        }
      } else {
        jobsCombined.push(...(resInbox.data || []));
      }

      const resAttachment = await supabase
        .from('parsing_jobs')
        .select('id, status, created_at, attachment_id')
        .in('attachment_id', attachmentIdsChunk)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (resAttachment.error) {
        const msg = String(resAttachment.error.message || '').toLowerCase();
        if (!msg.includes('attachment_id')) {
          throw new Error(`parsing_jobs query failed: ${resAttachment.error.message}`);
        }
      } else {
        jobsCombined.push(...(resAttachment.data || []));
      }

      jobsCombined.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      for (const job of jobsCombined) {
        const aid = job.inbox_attachment_id || job.attachment_id;
        if (!aid) continue;
        if (!jobByAttachment.has(aid)) {
          jobByAttachment.set(aid, job);
        }
      }
    }
  }

  // 4) Summarize
  const summary = {
    whatsapp_cvs_total: attachments.length,
    extracted_to_candidate: 0,
    showing_queued_in_cvinbox: 0,
    queued_missing_parsing_job: 0,
    queued_with_job_status_queued: 0,
    queued_with_job_status_processing: 0,
    queued_with_job_status_failed: 0,
    queued_with_job_status_extracted: 0,
    message_status_counts: {},
  };

  const queuedDetails = [];

  for (const att of attachments) {
    const msg = messageById.get(att.inbox_message_id);
    const msgStatus = toKey(msg?.status || '');
    summary.message_status_counts[msgStatus] = (summary.message_status_counts[msgStatus] || 0) + 1;

    if (att.candidate_id) {
      summary.extracted_to_candidate += 1;
      continue;
    }

    summary.showing_queued_in_cvinbox += 1;
    const job = jobByAttachment.get(att.id);

    if (!job) {
      summary.queued_missing_parsing_job += 1;
      queuedDetails.push({
        reason: 'missing_parsing_job',
        attachment_id: att.id,
        file_name: att.file_name,
        mime_type: att.mime_type,
        attachment_kind: att.attachment_kind,
        document_type: att.document_type,
        inbox_message_id: att.inbox_message_id,
        message_received_at: msg?.received_at,
        message_status: msg?.status,
        created_at: att.created_at,
      });
      continue;
    }

    const status = String(job.status || '').toLowerCase();
    if (status === 'queued') summary.queued_with_job_status_queued += 1;
    else if (status === 'processing') summary.queued_with_job_status_processing += 1;
    else if (status === 'failed') summary.queued_with_job_status_failed += 1;
    else if (status === 'extracted') summary.queued_with_job_status_extracted += 1;

    queuedDetails.push({
      reason: 'has_parsing_job',
      attachment_id: att.id,
      file_name: att.file_name,
      mime_type: att.mime_type,
      attachment_kind: att.attachment_kind,
      document_type: att.document_type,
      inbox_message_id: att.inbox_message_id,
      message_received_at: msg?.received_at,
      message_status: msg?.status,
      created_at: att.created_at,
      parsing_job_id: job.id,
      parsing_job_status: job.status,
      parsing_job_created_at: job.created_at,
    });
  }

  // Sort queued by received_at desc
  queuedDetails.sort((a, b) => {
    const at = new Date(a.message_received_at || a.created_at || 0).getTime();
    const bt = new Date(b.message_received_at || b.created_at || 0).getTime();
    return bt - at;
  });

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  const queuedMissingIds = queuedDetails
    .filter((q) => q.reason === 'missing_parsing_job')
    .map((q) => q.attachment_id);

  console.log('\n=== QUEUED_MISSING_PARSING_JOB_IDS ===');
  console.log(JSON.stringify(queuedMissingIds, null, 2));

  console.log('\n=== QUEUED (first 50) ===');
  console.log(JSON.stringify(queuedDetails.slice(0, 50), null, 2));

  // A quick diagnosis hint
  if (summary.queued_missing_parsing_job > 0) {
    console.log(
      `\nDIAGNOSIS: ${summary.queued_missing_parsing_job} WhatsApp CV(s) have no parsing job. These will show queued forever until a job is enqueued.`
    );
  }
  if (summary.queued_with_job_status_failed > 0) {
    console.log(
      `\nDIAGNOSIS: ${summary.queued_with_job_status_failed} WhatsApp CV(s) have failed parsing jobs. Check backend worker logs for the error messages (should now include stack/meta).`
    );
  }
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});
