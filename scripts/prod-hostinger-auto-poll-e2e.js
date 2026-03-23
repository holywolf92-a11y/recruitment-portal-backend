require('dotenv').config();

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const base = 'https://glorious-flexibility-production.up.railway.app/api';
const statusUrl = `${base}/email/hostinger/status`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logPath = process.env.PROD_HOSTINGER_E2E_LOG_PATH
  ? path.resolve(process.env.PROD_HOSTINGER_E2E_LOG_PATH)
  : null;

function writeLog(message, data) {
  if (!logPath) {
    return;
  }

  const line = `[${new Date().toISOString()}] ${message}${data === undefined ? '' : ` ${typeof data === 'string' ? data : JSON.stringify(data)}`}\n`;
  fs.appendFileSync(logPath, line);
}

async function json(url, options) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...((options && options.headers) || {}) },
    ...options,
  });
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  if (logPath) {
    fs.writeFileSync(logPath, '');
  }

  const startedAt = Date.now();
  writeLog('starting');
  const beforeStatus = await json(statusUrl);
  writeLog('loaded before status', beforeStatus);
  const beforePollStartedAt = beforeStatus?.polling?.lastPollStartedAt || null;
  const beforeCheckpointUid = beforeStatus?.checkpoint?.lastSeenUid || null;

  const stamp = Date.now();
  const nonce = Math.random().toString(36).slice(2, 8);
  const candidateName = `QA Auto Poll ${stamp}`;
  const seedEmail = `qa.auto.poll.${stamp}.${nonce}@example.com`;
  const created = await json(`${base}/candidates`, {
    method: 'POST',
    body: JSON.stringify({ name: candidateName, email: seedEmail }),
  });
  const candidateId = created.candidate.id;
  writeLog('created candidate', { candidateId, seedEmail });

  const sendResult = await json(`${base}/email/send-missing-docs`, {
    method: 'POST',
    body: JSON.stringify({ candidateId, force: true }),
  });
  writeLog('sent missing docs email', sendResult);

  await sleep(8000);

  const trace1 = await json(`${base}/email/reply-trace/${candidateId}`);
  writeLog('loaded initial reply trace', trace1);
  const beforeReplyMessages = trace1.replyMessages?.length || 0;
  const beforeLastReplyProcessedAt = trace1.candidate?.lastReplyProcessedAt || null;
  const subject = (
    trace1.logEntries?.[trace1.logEntries.length - 1]
    || trace1.sentMessages?.[trace1.sentMessages.length - 1]
    || {}
  ).subject || `Action required: please send missing documents [#${trace1.candidate.emailTrackingToken}]`;

  const attachmentPathCandidates = [
    'd:/falisha/recruitment-portal-frontend/test-cv-upload.pdf',
    'd:/falisha/recruitment-portal-frontend/package.json',
  ];
  const attachmentPath = attachmentPathCandidates.find((filePath) => fs.existsSync(filePath));

  const transport = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.HOSTINGER_SMTP_USER,
      pass: process.env.HOSTINGER_SMTP_PASSWORD,
    },
  });

  await transport.sendMail({
    from: `Falisha Jobs <${process.env.HOSTINGER_SMTP_USER}>`,
    to: process.env.PROD_HOSTINGER_REPLY_TO || 'support@falishajobs.com',
    subject: `Re: ${String(subject).replace(/^Re:\s*/i, '')}`,
    text: 'Assalam o Alaikum\nCountry of Interest: Saudi Arabia\nPlease find the attached document.\n',
    attachments: attachmentPath ? [{ filename: path.basename(attachmentPath), path: attachmentPath }] : [],
  });
  writeLog('sent smtp reply', { subject, attachmentPath });

  let statusAfter = null;
  let automaticPollObserved = false;
  let replyProcessedObserved = false;
  let traceAfter = trace1;

  for (let attempt = 1; attempt <= 24; attempt += 1) {
    await sleep(20000);
    statusAfter = await json(statusUrl);
    traceAfter = await json(`${base}/email/reply-trace/${candidateId}`);
    writeLog('polled status', { attempt, statusAfter });
    writeLog('polled reply trace', {
      attempt,
      replyMessages: traceAfter.replyMessages?.length || 0,
      lastReplyProcessedAt: traceAfter.candidate?.lastReplyProcessedAt || null,
    });

    const lastPollStartedAt = statusAfter?.polling?.lastPollStartedAt || null;
    const checkpointUid = statusAfter?.checkpoint?.lastSeenUid || null;
    const advancedPoll = beforePollStartedAt
      ? !!lastPollStartedAt && lastPollStartedAt !== beforePollStartedAt
      : !!lastPollStartedAt;
    const advancedUid = typeof beforeCheckpointUid === 'number' && typeof checkpointUid === 'number'
      ? checkpointUid > beforeCheckpointUid
      : false;
    const replyMessages = traceAfter.replyMessages?.length || 0;
    const lastReplyProcessedAt = traceAfter.candidate?.lastReplyProcessedAt || null;
    const advancedReplyMessages = replyMessages > beforeReplyMessages;
    const advancedLastReplyProcessedAt = !!lastReplyProcessedAt
      && lastReplyProcessedAt !== beforeLastReplyProcessedAt;

    if (advancedPoll || advancedUid) {
      automaticPollObserved = true;
    }

    if (advancedReplyMessages || advancedLastReplyProcessedAt) {
      replyProcessedObserved = true;
      break;
    }
  }

  const trace2 = traceAfter.replyMessages?.length || traceAfter.candidate?.lastReplyProcessedAt
    ? traceAfter
    : await json(`${base}/email/reply-trace/${candidateId}`);
  const candidate = await json(`${base}/candidates/${candidateId}`);
  const missing = await json(`${base}/candidates/${candidateId}/missing-fields`);

  const summary = {
    candidateId,
    candidateEmail: seedEmail,
    sendResult,
    before: {
      pollStartedAt: beforePollStartedAt,
      checkpointUid: beforeCheckpointUid,
      replyMessages: beforeReplyMessages,
      lastReplyProcessedAt: beforeLastReplyProcessedAt,
    },
    after: {
      pollStartedAt: statusAfter?.polling?.lastPollStartedAt || null,
      checkpointUid: statusAfter?.checkpoint?.lastSeenUid || null,
      schedulerActive: statusAfter?.schedulerActive || null,
      enabled: statusAfter?.enabled || null,
      unreadCount: statusAfter?.unreadCount || null,
      replyMessages: trace2.replyMessages?.length || 0,
      lastReplyProcessedAt: trace2.candidate?.lastReplyProcessedAt || null,
    },
    automaticPollObserved,
    replyProcessedObserved,
    trace: {
      sentMessages: trace2.sentMessages?.length || 0,
      logEntries: trace2.logEntries?.length || 0,
      replyMessages: trace2.replyMessages?.length || 0,
      documents: trace2.documents?.length || 0,
      candidateUpdates: trace2.candidateUpdates || null,
      lastReplyProcessedAt: trace2.candidate?.lastReplyProcessedAt || null,
    },
    candidateCountry: candidate?.candidate?.country_of_interest || null,
    missingFieldsTotal: missing?.total_missing ?? null,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!replyProcessedObserved) {
    throw new Error(`Reply processing was not observed before timeout for candidate ${candidateId}`);
  }

  writeLog('completed successfully');
}

main().catch((error) => {
  writeLog('failed', error && error.stack ? error.stack : String(error));
  console.error('PROD_E2E_ERROR', error && error.stack ? error.stack : error);
  process.exit(1);
});