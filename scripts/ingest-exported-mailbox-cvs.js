const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const OUTPUT_ROOT = path.resolve(process.env.MAILBOX_OUTPUT_DIR || path.join(__dirname, 'output', 'mailbox-export'));
const SOURCE_FILE = path.join(OUTPUT_ROOT, 'candidate_cv_attachments_2024_onward.csv');
const API_BASE = String(process.env.MAILBOX_API_BASE || 'https://glorious-flexibility-production.up.railway.app/api').replace(/\/$/, '');
const INGEST_LIMIT = Number(process.env.MAILBOX_INGEST_LIMIT || 0);
const INGEST_CONCURRENCY = Math.max(1, Number(process.env.MAILBOX_INGEST_CONCURRENCY || 6));
const INGEST_UIDS = new Set(String(process.env.MAILBOX_INGEST_UIDS || '').split(',').map((value) => value.trim()).filter(Boolean));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFileName(name) {
  return String(name || 'attachment')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .trim();
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (inQuotes) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        current += character;
      }
      continue;
    }

    if (character === ',') {
      values.push(current);
      current = '';
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function loadRows(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

async function apiRequest(endpoint, options = {}) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    if (response.ok) {
      return response.json();
    }

    const text = await response.text().catch(() => '');
    const message = `${response.status} ${response.statusText}: ${text}`;
    const retryable = response.status >= 500 && response.status < 600;

    if (!retryable || attempt === 4) {
      throw new Error(message);
    }

    await sleep(1000 * attempt);
  }
}

async function createOrFetchInboxMessage(group) {
  const externalMessageId = `mailbox_import_${String(group.message_id || group.uid).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const payload = {
    sender_name: group.from_name || '',
    sender_contact: group.from_email || '',
    from: group.from_email || '',
    to: '',
    subject: group.subject || '',
    messageId: group.message_id || '',
    imported_from_mailbox: true,
    mailbox_path: group.mailbox || 'INBOX',
    import_uid: Number(group.uid) || 0,
  };

  try {
    const created = await apiRequest('/cv-inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'email',
        external_message_id: externalMessageId,
        payload,
        status: 'pending',
        received_at: group.date || new Date().toISOString(),
      }),
    });
    return created.id || created.message?.id || created;
  } catch (error) {
    if (!String(error.message || '').includes('409')) {
      throw error;
    }

    const existing = await apiRequest('/cv-inbox?limit=5000&offset=0&source=email');
    const found = (existing.messages || []).find((item) => item.external_message_id === externalMessageId);
    if (!found) {
      throw error;
    }
    return found.id;
  }
}

async function buildExistingInboxMap() {
  const existing = await apiRequest('/cv-inbox?limit=5000&offset=0&source=email');
  const entries = (existing.messages || [])
    .filter((item) => item && item.external_message_id && item.id)
    .map((item) => [item.external_message_id, item.id]);
  return new Map(entries);
}

async function attachFile(inboxMessageId, row) {
  const absolutePath = path.join(OUTPUT_ROOT, row.saved_path.replace(/\\/g, path.sep));
  const content = fs.readFileSync(absolutePath);
  const safeStorageName = sanitizeFileName(row.attachment_name);

  try {
    const result = await apiRequest(`/cv-inbox/${inboxMessageId}/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: row.attachment_name,
        mime_type: row.mime_type || 'application/octet-stream',
        storage_bucket: 'documents',
        storage_path: `mailbox-import/${row.uid}/${safeStorageName}`,
        attachment_type: 'cv',
        file_base64: content.toString('base64'),
      }),
    });

    return { attached: true, jobId: result.job_id || '' };
  } catch (error) {
    if (String(error.message || '').includes('409')) {
      return { attached: false, duplicate: true, jobId: '' };
    }
    throw error;
  }
}

async function main() {
  const rows = loadRows(SOURCE_FILE);
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.mailbox}::${row.uid}::${row.message_id}`;
    const existing = groups.get(key) || { ...row, attachments: [] };
    existing.attachments.push(row);
    groups.set(key, existing);
  }

  const summary = {
    groups: groups.size,
    attachments: rows.length,
    inboxMessagesCreatedOrReused: 0,
    attachmentsSubmitted: 0,
    duplicateAttachments: 0,
    failedGroups: 0,
    failedUids: [],
    failedAttachments: [],
  };

  const filteredGroups = Array.from(groups.values()).filter((group) => INGEST_UIDS.size === 0 || INGEST_UIDS.has(String(group.uid)));
  const groupsToProcess = filteredGroups.slice(0, INGEST_LIMIT > 0 ? INGEST_LIMIT : undefined);
  summary.groups = groupsToProcess.length;
  const existingInboxMap = await buildExistingInboxMap();
  let processedGroups = 0;
  let nextIndex = 0;

  async function processGroup(group) {
    const externalMessageId = `mailbox_import_${String(group.message_id || group.uid).replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    try {
      let inboxMessageId = existingInboxMap.get(externalMessageId);
      if (!inboxMessageId) {
        inboxMessageId = await createOrFetchInboxMessage(group);
        existingInboxMap.set(externalMessageId, inboxMessageId);
      }
      summary.inboxMessagesCreatedOrReused += 1;

      for (const attachment of group.attachments) {
        try {
          const result = await attachFile(inboxMessageId, attachment);
          if (result.duplicate) {
            summary.duplicateAttachments += 1;
          } else if (result.attached) {
            summary.attachmentsSubmitted += 1;
          }
        } catch (error) {
          summary.failedAttachments.push({
            uid: String(group.uid),
            messageId: group.message_id,
            attachmentName: attachment.attachment_name,
            error: String(error.message || error),
          });
          console.error(`Failed attachment uid=${group.uid} file=${attachment.attachment_name}: ${String(error.message || error)}`);
        }
      }
    } catch (error) {
      summary.failedGroups += 1;
      summary.failedUids.push(String(group.uid));
      console.error(`Failed group uid=${group.uid} messageId=${group.message_id}: ${String(error.message || error)}`);
    }

    processedGroups += 1;
    if (processedGroups % 25 === 0 || processedGroups === groupsToProcess.length) {
      console.log(`Ingested ${processedGroups}/${groupsToProcess.length} messages, ${summary.attachmentsSubmitted} attachments submitted, ${summary.duplicateAttachments} duplicates`);
    }
  }

  async function worker() {
    while (nextIndex < groupsToProcess.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const group = groupsToProcess[currentIndex];
      if (!group) {
        break;
      }
      await processGroup(group);
    }
  }

  await Promise.all(Array.from({ length: Math.min(INGEST_CONCURRENCY, groupsToProcess.length) }, () => worker()));

  const summaryPath = path.join(OUTPUT_ROOT, 'ingest-summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ message: error.message || String(error), stack: error.stack || null }, null, 2));
  process.exitCode = 1;
});