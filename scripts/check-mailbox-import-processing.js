require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchAll(table, select, filterBuilder, pageSize = 1000) {
  const rows = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    query = filterBuilder(query);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function fetchParsingJobsForAttachments(attachmentIds) {
  const byAttachment = new Map();
  if (!attachmentIds.length) return byAttachment;

  for (let index = 0; index < attachmentIds.length; index += 100) {
    const chunk = attachmentIds.slice(index, index + 100);

    let data = null;
    let error = null;

    const attempt1 = await supabase
      .from('parsing_jobs')
      .select('id,status,created_at,inbox_attachment_id')
      .in('inbox_attachment_id', chunk)
      .order('created_at', { ascending: false });

    if (!attempt1.error) {
      data = attempt1.data || [];
    } else if (/inbox_attachment_id/i.test(String(attempt1.error.message || ''))) {
      const attempt2 = await supabase
        .from('parsing_jobs')
        .select('id,status,created_at,attachment_id')
        .in('attachment_id', chunk)
        .order('created_at', { ascending: false });

      data = attempt2.data || [];
      error = attempt2.error;
    } else {
      error = attempt1.error;
    }

    if (error) throw error;

    for (const row of data) {
      const attachmentId = row.inbox_attachment_id || row.attachment_id;
      if (!attachmentId) continue;
      if (!byAttachment.has(attachmentId)) {
        byAttachment.set(attachmentId, row);
      }
    }
  }

  return byAttachment;
}

async function main() {
  const inboxMessages = await fetchAll(
    'inbox_messages',
    'id,external_message_id,source,created_at',
    (query) => query
      .eq('source', 'email')
      .like('external_message_id', 'mailbox_import_%')
      .order('created_at', { ascending: true })
  );

  const messageIds = inboxMessages.map((row) => row.id);
  const attachments = [];

  for (let index = 0; index < messageIds.length; index += 100) {
    const chunk = messageIds.slice(index, index + 100);
    const chunkRows = await fetchAll(
      'inbox_attachments',
      'id,file_name,candidate_id,linked_candidate_id,storage_path,created_at,attachment_type,inbox_message_id',
      (query) => query
        .eq('attachment_type', 'cv')
        .in('inbox_message_id', chunk)
        .order('created_at', { ascending: true })
    , 1000);
    attachments.push(...chunkRows);
  }

  const pathBuckets = attachments.reduce((acc, row) => {
    const path = String(row.storage_path || '');
    const key = path.startsWith('mailbox-import/')
      ? 'mailbox-import'
      : path.startsWith('unmatched_documents/')
        ? 'unmatched_documents'
        : 'other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const attachmentIds = attachments.map((row) => row.id);
  const parsingJobsByAttachment = await fetchParsingJobsForAttachments(attachmentIds);

  const totals = {
    importedMessages: inboxMessages.length,
    submittedAttachments: attachments.length,
    pathBuckets,
    parsedExtracted: 0,
    parsedQueued: 0,
    parsedProcessing: 0,
    parsedFailed: 0,
    parsedMissingJob: 0,
    linkedToCandidate: 0,
    extractedAndLinked: 0,
    extractedNotLinked: 0,
  };

  const samples = {
    missingJob: [],
    failed: [],
    extractedNotLinked: [],
  };

  for (const attachment of attachments) {
    const latestJob = parsingJobsByAttachment.get(attachment.id);
    const linkedCandidateId = attachment.candidate_id || attachment.linked_candidate_id || null;
    if (linkedCandidateId) {
      totals.linkedToCandidate += 1;
    }

    if (!latestJob) {
      totals.parsedMissingJob += 1;
      if (samples.missingJob.length < 10) {
        samples.missingJob.push({ id: attachment.id, file_name: attachment.file_name });
      }
      continue;
    }

    if (latestJob.status === 'extracted') totals.parsedExtracted += 1;
    if (latestJob.status === 'queued') totals.parsedQueued += 1;
    if (latestJob.status === 'processing') totals.parsedProcessing += 1;
    if (latestJob.status === 'failed') totals.parsedFailed += 1;

    if (latestJob.status === 'failed' && samples.failed.length < 10) {
      samples.failed.push({ id: attachment.id, file_name: attachment.file_name, job_id: latestJob.id });
    }

    if (latestJob.status === 'extracted' && linkedCandidateId) {
      totals.extractedAndLinked += 1;
    }

    if (latestJob.status === 'extracted' && !linkedCandidateId) {
      totals.extractedNotLinked += 1;
      if (samples.extractedNotLinked.length < 10) {
        samples.extractedNotLinked.push({ id: attachment.id, file_name: attachment.file_name, job_id: latestJob.id });
      }
    }
  }

  console.log(JSON.stringify({ totals, samples }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ message: error.message || String(error), stack: error.stack || null }, null, 2));
  process.exit(1);
});