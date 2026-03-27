require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const OUTPUT_ROOT = path.resolve(process.env.MAILBOX_OUTPUT_DIR || path.join(__dirname, 'output', 'mailbox-export'));
const SOURCE_FILE = path.join(OUTPUT_ROOT, 'recruiter_outreach_shortlist.csv');
const TARGET_CSV = path.join(OUTPUT_ROOT, 'recruiter_whatsapp_candidates.csv');
const TARGET_JSON = path.join(OUTPUT_ROOT, 'recruiter_whatsapp_candidates.json');
const TARGET_MD = path.join(OUTPUT_ROOT, 'recruiter_whatsapp_summary.md');
const MAILBOXES = ['INBOX', 'INBOX.Sent'];
const MAX_MESSAGES_PER_CONTACT = Number(process.env.RECRUITER_PHONE_MAX_MESSAGES || '6');

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

function loadRows(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function normalizeEmailAddress(value) {
  const match = String(value || '').match(/<([^>]+)>/) || String(value || '').match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return ((match && (match[1] || match[0])) || '').trim().toLowerCase();
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

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function toMessageSet(items) {
  return items
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0)
    .join(',');
}

function normalizePhone(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  let normalized = raw.replace(/[^\d+]/g, '');
  if (!normalized) return null;
  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }
  const digits = normalized.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  if (normalized.startsWith('+')) return `+${digits}`;
  return digits;
}

function extractSnippet(text, index, length) {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + length + 50);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function classifySnippet(snippet) {
  const text = String(snippet || '').toLowerCase();
  if (/(whatsapp|whats app|wa\.me|wa:|w\/a)/i.test(text)) return 'whatsapp';
  if (/(mobile|cell|tel|telephone|phone|contact)/i.test(text)) return 'phone';
  return 'generic';
}

function extractPhoneCandidates(text) {
  const source = String(text || '');
  const seen = new Set();
  const candidates = [];
  const regex = /(?:\+|00)?\d[\d\s().-]{6,}\d/g;
  let match;

  while ((match = regex.exec(source)) !== null) {
    const raw = match[0];
    const normalized = normalizePhone(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    const snippet = extractSnippet(source, match.index, raw.length);
    const label = classifySnippet(snippet);
    const confidence = label === 'whatsapp' ? 'high' : label === 'phone' ? 'medium' : 'low';

    candidates.push({
      raw,
      normalized,
      label,
      confidence,
      snippet,
    });
  }

  return candidates;
}

async function collectMessageMatches(client, mailboxPath, contactRows) {
  const lock = await client.getMailboxLock(mailboxPath);
  try {
    const contactHits = new Map();
    let processed = 0;

    for (const row of contactRows) {
      const email = normalizeEmailAddress(row.email);
      if (!email) continue;

      const uids = await client.search({ or: [{ from: email }, { to: email }] }, { uid: true });
      if (!uids.length) {
        processed += 1;
        continue;
      }

      const list = [];
      const sortedUids = [...uids].sort((left, right) => right - left).slice(0, MAX_MESSAGES_PER_CONTACT);
      const messageSet = toMessageSet(sortedUids);
      if (messageSet) {
        for await (const message of client.fetch(messageSet, { uid: true, envelope: true }, { uid: true })) {
          if (!message.uid || !message.envelope) continue;
          list.push({
            uid: message.uid,
            subject: String(message.envelope.subject || '').trim(),
            date: message.envelope.date ? new Date(message.envelope.date).toISOString() : '',
            mailbox: mailboxPath,
          });
        }
      }

      list.sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
      contactHits.set(email, list.slice(0, MAX_MESSAGES_PER_CONTACT));

      processed += 1;
      if (processed % 25 === 0) {
        console.log(`Mailbox ${mailboxPath}: searched ${processed}/${contactRows.length} recruiter contacts`);
      }
    }

    return contactHits;
  } finally {
    lock.release();
  }
}

async function fetchParsedMessage(client, mailboxPath, uid) {
  const lock = await client.getMailboxLock(mailboxPath);
  try {
    const messageSet = toMessageSet([uid]);
    for await (const message of client.fetch(messageSet, { uid: true, source: true }, { uid: true })) {
      if (!message.source) return null;
      return simpleParser(message.source);
    }
    return null;
  } finally {
    lock.release();
  }
}

async function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`Shortlist file not found: ${SOURCE_FILE}`);
  }

  const shortlist = loadRows(SOURCE_FILE);
  const config = getConfig();
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });
  await client.connect();

  try {
    const hitMap = new Map();
    for (const mailboxPath of MAILBOXES) {
      const mailboxHits = await collectMessageMatches(client, mailboxPath, shortlist);
      for (const [email, records] of mailboxHits.entries()) {
        const merged = hitMap.get(email) || [];
        merged.push(...records);
        merged.sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
        const unique = [];
        const seen = new Set();
        for (const record of merged) {
          const key = `${record.mailbox}:${record.uid}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(record);
        }
        hitMap.set(email, unique.slice(0, MAX_MESSAGES_PER_CONTACT));
      }
    }

    const results = [];
    for (const row of shortlist) {
      const email = normalizeEmailAddress(row.email);
      const messages = hitMap.get(email) || [];
      const foundNumbers = new Map();

      for (const message of messages) {
        const parsed = await fetchParsedMessage(client, message.mailbox, message.uid);
        const text = [parsed?.text || '', parsed?.html || ''].join('\n');
        const numbers = extractPhoneCandidates(text);
        for (const number of numbers) {
          if (foundNumbers.has(number.normalized)) continue;
          foundNumbers.set(number.normalized, {
            email,
            name: row.name || '',
            domain: row.domain || '',
            whatsapp_or_phone: number.normalized,
            raw_match: number.raw,
            label: number.label,
            confidence: number.confidence,
            mailbox: message.mailbox,
            message_date: message.date,
            message_subject: message.subject,
            snippet: number.snippet,
          });
        }
      }

      results.push({
        recruiter: {
          email,
          name: row.name || '',
          domain: row.domain || '',
          contact_count: row.contact_count || '',
        },
        matches: Array.from(foundNumbers.values()),
      });
    }

    const flatRows = results.flatMap((entry) => entry.matches);
    flatRows.sort((left, right) => {
      const confidenceOrder = { high: 0, medium: 1, low: 2 };
      const leftRank = confidenceOrder[left.confidence] ?? 9;
      const rightRank = confidenceOrder[right.confidence] ?? 9;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return String(right.message_date || '').localeCompare(String(left.message_date || ''));
    });

    writeCsv(TARGET_CSV, [
      'email',
      'name',
      'domain',
      'whatsapp_or_phone',
      'raw_match',
      'label',
      'confidence',
      'mailbox',
      'message_date',
      'message_subject',
      'snippet',
    ], flatRows);

    fs.writeFileSync(TARGET_JSON, JSON.stringify(results, null, 2), 'utf8');

    const contactsWithMatches = results.filter((entry) => entry.matches.length > 0);
    const summaryLines = [
      '# Recruiter WhatsApp Extraction Summary',
      '',
      `Contacts scanned: ${results.length}`,
      `Contacts with phone-like matches: ${contactsWithMatches.length}`,
      `Total extracted numbers: ${flatRows.length}`,
      '',
      'Top high-confidence entries:',
      '',
      ...flatRows
        .filter((row) => row.confidence === 'high')
        .slice(0, 30)
        .map((row, index) => `${index + 1}. ${row.email} | ${row.whatsapp_or_phone} | ${row.message_date} | ${row.message_subject}`),
    ];
    fs.writeFileSync(TARGET_MD, `${summaryLines.join('\n')}\n`, 'utf8');

    console.log(JSON.stringify({
      contactsScanned: results.length,
      contactsWithMatches: contactsWithMatches.length,
      extractedNumbers: flatRows.length,
      highConfidence: flatRows.filter((row) => row.confidence === 'high').length,
      mediumConfidence: flatRows.filter((row) => row.confidence === 'medium').length,
      lowConfidence: flatRows.filter((row) => row.confidence === 'low').length,
      outputCsv: TARGET_CSV,
      outputJson: TARGET_JSON,
      outputMd: TARGET_MD,
    }, null, 2));
  } finally {
    await client.logout().catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    message: error.message || String(error),
    stack: error.stack || null,
  }, null, 2));
  process.exit(1);
});