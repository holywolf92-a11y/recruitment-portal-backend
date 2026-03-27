require('dotenv').config();

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const API_BASE = String(process.env.MAILBOX_API_BASE || 'https://glorious-flexibility-production.up.railway.app/api').replace(/\/$/, '');
const OUTPUT_ROOT = path.resolve(process.env.MAILBOX_OUTPUT_DIR || path.join(__dirname, 'output', 'mailbox-export'));
const SHOULD_REQUEUE = String(process.env.MAILBOX_REQUEUE_GENUINE_CVS || 'true').toLowerCase() !== 'false';

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

async function fetchLatestParsingJobs(attachmentIds) {
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

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function looksLikeFreeMail(email) {
  return /@(gmail\.com|outlook\.com|hotmail\.com|yahoo\.com|icloud\.com)$/i.test(String(email || ''));
}

function classifyFailure(row) {
  const fileName = String(row.file_name || '');
  const subject = String(row.subject || '');
  const sender = String(row.sender_contact || '');
  const mimeType = String(row.mime_type || '');
  const combined = `${fileName} ${subject}`.toLowerCase();
  const extension = path.extname(fileName).toLowerCase();

  const strongCvPattern = /\b(cv|cv[._ -]*resume|resume|résumé|curriculum vitae|bio[ _-]?data|europass)\b/i;
  const obviousNonCvPattern = /\b(outlook|image\d*|blocked|logo|company profile|brochure|proposal|agreement|contract|mou|demand|requirements?|job description|job order|job and responsibility|presentation|terms and conditions|license|licence|payment|invoice|quotation|offer letter|visa|permit|business card|appendix|flyer|report|questionnaire|agency questiona?ire|recruitment partner agreement|global deployment|project management|scope of work|introduction letter|rfq|services|profile of|company licence|commercial register|expo|partnership sales jd|workium|agency tie up)\b/i;
  const candidateIntentPattern = /\b(attached my cv|attached my resume|cv attached|resume attached|jobseeker|application for|apply for|seeking.*job|looking for.*job)\b/i;
  const docExtensions = new Set(['.pdf', '.doc', '.docx']);

  if (obviousNonCvPattern.test(combined)) {
    return { classification: 'obvious_non_cv', reason: 'obvious_non_cv_keyword' };
  }

  if (mimeType.startsWith('image/') && !strongCvPattern.test(combined)) {
    return { classification: 'obvious_non_cv', reason: 'image_without_cv_keywords' };
  }

  if (strongCvPattern.test(combined)) {
    return { classification: 'genuine_cv', reason: 'strong_cv_keyword' };
  }

  if (docExtensions.has(extension) && candidateIntentPattern.test(combined) && looksLikeFreeMail(sender)) {
    return { classification: 'ambiguous', reason: 'candidate_related_but_no_cv_keyword' };
  }

  return { classification: 'ambiguous', reason: 'needs_review' };
}

async function retryAttachment(attachmentId) {
  const response = await fetch(`${API_BASE}/cv-inbox/attachments/${attachmentId}/retry`, {
    method: 'POST',
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  const inboxMessages = await fetchAll(
    'inbox_messages',
    'id,external_message_id,payload,created_at',
    (query) => query
      .eq('source', 'email')
      .like('external_message_id', 'mailbox_import_%')
      .order('created_at', { ascending: true })
  );

  const messageMap = new Map(inboxMessages.map((row) => [row.id, row]));
  const messageIds = inboxMessages.map((row) => row.id);
  const attachments = [];

  for (let index = 0; index < messageIds.length; index += 100) {
    const chunk = messageIds.slice(index, index + 100);
    const rows = await fetchAll(
      'inbox_attachments',
      'id,file_name,mime_type,storage_path,inbox_message_id,attachment_type,candidate_id,linked_candidate_id',
      (query) => query
        .eq('attachment_type', 'cv')
        .in('inbox_message_id', chunk)
        .order('created_at', { ascending: true })
    );
    attachments.push(...rows);
  }

  const latestJobs = await fetchLatestParsingJobs(attachments.map((row) => row.id));
  const failedRows = [];

  for (const attachment of attachments) {
    const latestJob = latestJobs.get(attachment.id);
    if (!latestJob || latestJob.status !== 'failed') continue;

    const message = messageMap.get(attachment.inbox_message_id);
    const payload = message?.payload || {};
    const classified = classifyFailure({
      ...attachment,
      subject: payload.subject || '',
      sender_contact: payload.sender_contact || '',
    });

    failedRows.push({
      attachment_id: attachment.id,
      parsing_job_id: latestJob.id,
      file_name: attachment.file_name,
      mime_type: attachment.mime_type || '',
      storage_path: attachment.storage_path || '',
      subject: payload.subject || '',
      sender_contact: payload.sender_contact || '',
      classification: classified.classification,
      reason: classified.reason,
      linked_candidate_id: attachment.candidate_id || attachment.linked_candidate_id || '',
    });
  }

  const genuine = failedRows.filter((row) => row.classification === 'genuine_cv');
  const ambiguous = failedRows.filter((row) => row.classification === 'ambiguous');
  const nonCv = failedRows.filter((row) => row.classification === 'obvious_non_cv');

  const requeueResults = [];
  if (SHOULD_REQUEUE) {
    for (const row of genuine) {
      try {
        const result = await retryAttachment(row.attachment_id);
        requeueResults.push({ attachment_id: row.attachment_id, ok: true, job_id: result.job_id || '' });
      } catch (error) {
        requeueResults.push({ attachment_id: row.attachment_id, ok: false, error: String(error.message || error) });
      }
    }
  }

  const headers = ['attachment_id', 'parsing_job_id', 'file_name', 'mime_type', 'storage_path', 'subject', 'sender_contact', 'classification', 'reason', 'linked_candidate_id'];
  const csvBody = [headers.join(',')]
    .concat(failedRows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')))
    .join('\n');
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'mailbox_failed_cv_attachments_classified.csv'), `${csvBody}\n`, 'utf8');

  const summary = {
    failedTotal: failedRows.length,
    genuineCvFailures: genuine.length,
    ambiguousFailures: ambiguous.length,
    obviousNonCvFailures: nonCv.length,
    requeueAttempted: SHOULD_REQUEUE ? genuine.length : 0,
    requeueSucceeded: requeueResults.filter((row) => row.ok).length,
    requeueFailed: requeueResults.filter((row) => !row.ok).length,
    sampleGenuine: genuine.slice(0, 20),
    sampleAmbiguous: ambiguous.slice(0, 20),
    sampleNonCv: nonCv.slice(0, 20),
    requeueResults: requeueResults.slice(0, 50),
  };

  fs.writeFileSync(path.join(OUTPUT_ROOT, 'mailbox_failed_cv_attachments_summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ message: error.message || String(error), stack: error.stack || null }, null, 2));
  process.exit(1);
});