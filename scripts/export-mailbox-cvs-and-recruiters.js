const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fetch = require('node-fetch');

const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

const ACCEPTED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const DEFAULT_CV_SINCE = process.env.MAILBOX_CV_SINCE || process.env.MAILBOX_SINCE || '2024-06-01';
const DEFAULT_RECRUITER_SINCE = process.env.MAILBOX_RECRUITER_SINCE || '';
const OUTPUT_ROOT = path.resolve(process.env.MAILBOX_OUTPUT_DIR || path.join(__dirname, 'output', 'mailbox-export'));
const OWN_DOMAIN = String(process.env.MAILBOX_OWN_DOMAIN || 'falishamanpower.com').toLowerCase();
const API_BASE = String(process.env.MAILBOX_API_BASE || 'https://glorious-flexibility-production.up.railway.app/api').replace(/\/$/, '');
const ENABLE_INGEST = String(process.env.MAILBOX_INGEST || 'true').toLowerCase() !== 'false';

function getConfig() {
  const host = process.env.MAILBOX_HOST || process.env.HOSTINGER_IMAP_HOST || 'mail.falishamanpower.com';
  const port = Number(process.env.MAILBOX_PORT || process.env.HOSTINGER_IMAP_PORT || 993);
  const secure = String(process.env.MAILBOX_SECURE || process.env.HOSTINGER_IMAP_SECURE || 'true').toLowerCase() !== 'false';
  const user = process.env.MAILBOX_USER || process.env.HOSTINGER_IMAP_USER || process.env.HOSTINGER_SMTP_USER || '';
  const pass = process.env.MAILBOX_PASS || process.env.HOSTINGER_IMAP_PASSWORD || process.env.HOSTINGER_SMTP_PASSWORD || '';

  if (!user || !pass) {
    throw new Error('Mailbox credentials are missing. Set MAILBOX_USER and MAILBOX_PASS, or reuse HOSTINGER_* env vars.');
  }

  return { host, port, secure, user, pass };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFileName(name) {
  return String(name || 'attachment')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmailAddress(value) {
  const match = String(value || '').match(/<([^>]+)>/) || String(value || '').match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return (match && (match[1] || match[0]) || '').trim().toLowerCase();
}

function toAddressList(addressLike) {
  if (!addressLike) return [];
  const source = Array.isArray(addressLike.value) ? addressLike.value : [];
  return source
    .map((entry) => ({
      name: String(entry.name || '').trim(),
      email: normalizeEmailAddress(entry.address || entry.name || ''),
    }))
    .filter((entry) => entry.email);
}

function hasAcceptedCvAttachment(attachment) {
  const mime = String(attachment.contentType || '').toLowerCase().split(';')[0].trim();
  const ext = path.extname(String(attachment.filename || '')).toLowerCase();
  return ACCEPTED_MIME_TYPES.has(mime) || ACCEPTED_EXTENSIONS.has(ext) || mime.startsWith('image/');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function toMessageSet(items) {
  return items.map((value) => Math.floor(Number(value))).filter((value) => Number.isFinite(value) && value > 0).join(',');
}

async function collectMailboxMessages(client, mailboxPath, sinceDate) {
  const lock = await client.getMailboxLock(mailboxPath);
  try {
    const uids = await client.search({ since: sinceDate }, { uid: true });
    console.log(`Mailbox ${mailboxPath}: found ${uids.length} messages since ${sinceDate.toISOString().slice(0, 10)}`);
    if (!uids.length) {
      return [];
    }

    function bodyStructureHasAttachment(bodyStructure) {
      if (!bodyStructure || typeof bodyStructure !== 'object') return false;

      const disposition = String(bodyStructure.disposition || '').toLowerCase();
      const type = String(bodyStructure.type || '').toLowerCase();
      const subtype = String(bodyStructure.subtype || '').toLowerCase();
      const childNodes = Array.isArray(bodyStructure.childNodes) ? bodyStructure.childNodes : [];

      if (disposition === 'attachment') return true;
      if (type === 'application' && subtype) return true;
      return childNodes.some((node) => bodyStructureHasAttachment(node));
    }

    const attachmentUids = [];
    for (const uidChunk of chunkArray(uids, 200)) {
      const messageSet = toMessageSet(uidChunk);
      if (!messageSet) continue;
      for await (const message of client.fetch(messageSet, { uid: true, bodyStructure: true }, { uid: true })) {
        if (!message.uid) continue;
        if (bodyStructureHasAttachment(message.bodyStructure)) {
          attachmentUids.push(message.uid);
        }
      }
      console.log(`Mailbox ${mailboxPath}: attachment scan ${Math.min(attachmentUids.length, uids.length)}/${uids.length} candidates with attachments so far`);
    }

    if (!attachmentUids.length) {
      return [];
    }

    console.log(`Mailbox ${mailboxPath}: ${attachmentUids.length} messages contain attachments`);

    const items = [];
    for (const uidChunk of chunkArray(attachmentUids, 50)) {
      const messageSet = toMessageSet(uidChunk);
      if (!messageSet) continue;
      for await (const message of client.fetch(messageSet, { uid: true, envelope: true, source: true }, { uid: true })) {
        if (!message.uid || !message.source) continue;
        const parsed = await simpleParser(message.source);
        items.push({
          mailboxPath,
          uid: message.uid,
          envelope: message.envelope,
          parsed,
        });
      }
      console.log(`Mailbox ${mailboxPath}: parsed ${items.length}/${attachmentUids.length} attachment messages`);
    }
    return items;
  } finally {
    lock.release();
  }
}

function normalizeEnvelopeAddressList(addresses) {
  const list = Array.isArray(addresses) ? addresses : [];
  return list
    .map((entry) => ({
      name: String(entry.name || '').trim(),
      email: normalizeEmailAddress(entry.address || ''),
    }))
    .filter((entry) => entry.email);
}

async function collectMailboxHeaders(client, mailboxPath, sinceDate) {
  const lock = await client.getMailboxLock(mailboxPath);
  try {
    const searchQuery = sinceDate ? { since: sinceDate } : { all: true };
    const uids = await client.search(searchQuery, { uid: true });
    if (!uids.length) {
      return [];
    }

    const items = [];
    for (const uidChunk of chunkArray(uids, 200)) {
      const messageSet = toMessageSet(uidChunk);
      if (!messageSet) continue;
      for await (const message of client.fetch(messageSet, { uid: true, envelope: true }, { uid: true })) {
        if (!message.uid || !message.envelope) continue;
        items.push({
          mailboxPath,
          uid: message.uid,
          messageId: String(message.envelope.messageId || '').replace(/^<|>$/g, ''),
          subject: String(message.envelope.subject || '').trim(),
          date: message.envelope.date ? new Date(message.envelope.date).toISOString() : '',
          fromList: normalizeEnvelopeAddressList(message.envelope.from),
          toList: [
            ...normalizeEnvelopeAddressList(message.envelope.to),
            ...normalizeEnvelopeAddressList(message.envelope.cc),
            ...normalizeEnvelopeAddressList(message.envelope.bcc),
          ],
        });
      }
      console.log(`Mailbox ${mailboxPath}: collected ${items.length}/${uids.length} recruiter header records`);
    }

    return items;
  } finally {
    lock.release();
  }
}

async function apiRequest(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, options);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json();
}

async function ingestCvMessage(message, acceptedAttachments) {
  const externalMessageId = `mailbox_import_${String(message.messageId || message.uid).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const payload = {
    sender_name: message.fromList[0]?.name || '',
    sender_contact: message.fromList[0]?.email || '',
    from: message.fromDisplay,
    to: message.toDisplay,
    subject: message.subject,
    messageId: message.messageId,
    imported_from_mailbox: true,
    mailbox_path: message.mailboxPath,
    import_uid: message.uid,
  };

  let inboxMessage;
  try {
    inboxMessage = await apiRequest('/cv-inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'email',
        external_message_id: externalMessageId,
        payload,
        status: 'pending',
        received_at: message.date,
      }),
    });
  } catch (error) {
    if (!String(error.message || '').includes('409')) {
      throw error;
    }

    const existing = await apiRequest(`/cv-inbox?limit=1&offset=0&source=email`);
    const found = (existing.messages || []).find((item) => item.external_message_id === externalMessageId);
    if (!found) {
      throw error;
    }
    inboxMessage = found;
  }

  const ingestedAttachments = [];
  for (const attachment of acceptedAttachments) {
    try {
      const result = await apiRequest(`/cv-inbox/${inboxMessage.id}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: attachment.filename,
          mime_type: attachment.contentType || 'application/octet-stream',
          storage_bucket: 'documents',
          storage_path: `mailbox-import/${message.uid}/${sanitizeFileName(attachment.filename || 'attachment')}`,
          attachment_type: 'cv',
          file_base64: attachment.content.toString('base64'),
        }),
      });
      ingestedAttachments.push({
        fileName: attachment.filename,
        attachmentId: result.attachment?.id || '',
        jobId: result.job_id || '',
      });
    } catch (error) {
      if (!String(error.message || '').includes('409')) {
        throw error;
      }
    }
  }

  return {
    inboxMessageId: inboxMessage.id,
    ingestedAttachments,
  };
}

async function main() {
  ensureDir(OUTPUT_ROOT);
  const cvDir = path.join(OUTPUT_ROOT, 'candidate-cv-attachments');
  ensureDir(cvDir);

  const cvSinceDate = new Date(DEFAULT_CV_SINCE);
  if (Number.isNaN(cvSinceDate.getTime())) {
    throw new Error(`Invalid MAILBOX_CV_SINCE date: ${DEFAULT_CV_SINCE}`);
  }

  const recruiterSinceDate = DEFAULT_RECRUITER_SINCE ? new Date(DEFAULT_RECRUITER_SINCE) : null;
  if (DEFAULT_RECRUITER_SINCE && recruiterSinceDate && Number.isNaN(recruiterSinceDate.getTime())) {
    throw new Error(`Invalid MAILBOX_RECRUITER_SINCE date: ${DEFAULT_RECRUITER_SINCE}`);
  }

  const config = getConfig();
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  const recruiterMap = new Map();
  const cvRows = [];
  const summary = {
    cvSince: DEFAULT_CV_SINCE,
    recruiterSince: DEFAULT_RECRUITER_SINCE || 'full-mailbox',
    processedMailboxes: [],
    candidateCvMessages: 0,
    candidateCvAttachments: 0,
    ingestedCvMessages: 0,
    ingestedCvAttachments: 0,
    recruiterContacts: 0,
  };

  await client.connect();

  try {
    const mailboxes = await client.list();
    const inboxMailbox = mailboxes.find((box) => String(box.path || '').toUpperCase() === 'INBOX');
    const sentMailboxes = mailboxes.filter((box) => {
      const pathLower = String(box.path || '').toLowerCase();
      const specialUse = Array.isArray(box.specialUse) ? box.specialUse.map(String) : [];
      return specialUse.includes('\\Sent') || /(^|[./\\])sent( items| mail)?$/i.test(pathLower) || pathLower === 'sent';
    });

    const targetMailboxes = [inboxMailbox, ...sentMailboxes].filter(Boolean);
    if (!targetMailboxes.length) {
      throw new Error('No INBOX or Sent mailboxes found.');
    }

    for (const mailbox of targetMailboxes) {
      const mailboxPath = mailbox.path;
      summary.processedMailboxes.push(mailboxPath);
      console.log(`Scanning mailbox: ${mailboxPath}`);
      const candidateMessages = String(mailboxPath).toUpperCase() === 'INBOX'
        ? await collectMailboxMessages(client, mailboxPath, cvSinceDate)
        : [];
      const recruiterHeaders = await collectMailboxHeaders(client, mailboxPath, recruiterSinceDate);

      console.log(`Mailbox ${mailboxPath}: ${candidateMessages.length} candidate messages, ${recruiterHeaders.length} recruiter header records`);

      for (const item of candidateMessages) {
        const parsed = item.parsed;
        const fromList = toAddressList(parsed.from);
        const toList = [
          ...toAddressList(parsed.to),
          ...toAddressList(parsed.cc),
          ...toAddressList(parsed.bcc),
        ];
        const subject = String(parsed.subject || item.envelope?.subject || '').trim();
        const sentAt = parsed.date ? parsed.date.toISOString() : '';
        const messageId = String(parsed.messageId || item.envelope?.messageId || '').replace(/^<|>$/g, '');
        const messageDetails = {
          mailboxPath,
          uid: item.uid,
          messageId,
          subject,
          date: sentAt,
          fromList,
          toList,
          fromDisplay: parsed.from?.text || '',
          toDisplay: parsed.to?.text || '',
        };

        const acceptedAttachments = parsed.attachments.filter(hasAcceptedCvAttachment);
        if (String(mailboxPath).toUpperCase() === 'INBOX' && sentAt && new Date(sentAt) >= cvSinceDate && acceptedAttachments.length > 0) {
          summary.candidateCvMessages += 1;
          for (let index = 0; index < acceptedAttachments.length; index++) {
            const attachment = acceptedAttachments[index];
            const safeName = sanitizeFileName(attachment.filename || `attachment-${item.uid}-${index + 1}`);
            const targetName = `${String(item.uid).padStart(8, '0')}_${safeName}`;
            const targetPath = path.join(cvDir, targetName);
            fs.writeFileSync(targetPath, attachment.content);
            summary.candidateCvAttachments += 1;

            cvRows.push({
              mailbox: mailboxPath,
              uid: item.uid,
              date: sentAt,
              from_email: fromList[0]?.email || '',
              from_name: fromList[0]?.name || '',
              subject,
              message_id: messageId,
              attachment_name: safeName,
              mime_type: attachment.contentType || '',
              saved_path: path.relative(OUTPUT_ROOT, targetPath),
            });
          }

          if (ENABLE_INGEST) {
            try {
              const ingestResult = await ingestCvMessage(messageDetails, acceptedAttachments);
              summary.ingestedCvMessages += 1;
              summary.ingestedCvAttachments += ingestResult.ingestedAttachments.length;
              if (summary.ingestedCvMessages % 25 === 0) {
                console.log(`Ingestion progress: ${summary.ingestedCvMessages} messages, ${summary.ingestedCvAttachments} attachments queued`);
              }
            } catch (error) {
              cvRows.push({
                mailbox: mailboxPath,
                uid: item.uid,
                date: sentAt,
                from_email: fromList[0]?.email || '',
                from_name: fromList[0]?.name || '',
                subject: `${subject} [INGEST FAILED: ${String(error.message || error)}]`,
                message_id: messageId,
                attachment_name: '',
                mime_type: '',
                saved_path: '',
              });
            }
          }
        }
      }

      for (const header of recruiterHeaders) {
        const externalContacts = [
          ...(sentMailboxes.some((box) => box.path === mailboxPath) ? header.toList : []),
          ...(String(mailboxPath).toUpperCase() === 'INBOX' ? header.fromList : []),
        ];

        for (const contact of externalContacts) {
          if (!contact.email) continue;
          const contactDomain = contact.email.split('@')[1] || '';
          if (!contactDomain || contactDomain === OWN_DOMAIN) continue;

          const existing = recruiterMap.get(contact.email) || {
            email: contact.email,
            name: contact.name || '',
            domain: contactDomain,
            first_contacted_at: header.date,
            last_contacted_at: header.date,
            contact_count: 0,
            last_subject: '',
          };

          existing.contact_count += 1;
          if (!existing.first_contacted_at || (header.date && header.date < existing.first_contacted_at)) {
            existing.first_contacted_at = header.date;
          }
          if (!existing.last_contacted_at || (header.date && header.date > existing.last_contacted_at)) {
            existing.last_contacted_at = header.date;
            existing.last_subject = header.subject;
          }
          if (!existing.name && contact.name) {
            existing.name = contact.name;
          }

          recruiterMap.set(contact.email, existing);
        }
      }
    }

    const recruiterRows = Array.from(recruiterMap.values())
      .sort((left, right) => String(right.last_contacted_at || '').localeCompare(String(left.last_contacted_at || '')));
    summary.recruiterContacts = recruiterRows.length;

    writeCsv(path.join(OUTPUT_ROOT, 'candidate_cv_attachments_2024_onward.csv'), [
      'mailbox',
      'uid',
      'date',
      'from_email',
      'from_name',
      'subject',
      'message_id',
      'attachment_name',
      'mime_type',
      'saved_path',
    ], cvRows);

    writeCsv(path.join(OUTPUT_ROOT, 'recruiter_contacts_2024_onward.csv'), [
      'email',
      'name',
      'domain',
      'first_contacted_at',
      'last_contacted_at',
      'contact_count',
      'last_subject',
    ], recruiterRows);

    fs.writeFileSync(path.join(OUTPUT_ROOT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.logout().catch(() => {});
  }
}

main().catch((error) => {
  const payload = error instanceof Error
    ? {
        message: error.message,
        code: error.code || null,
        command: error.command || null,
        response: error.response || null,
        responseText: error.responseText || null,
        stack: error.stack || null,
      }
    : { value: String(error) };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});