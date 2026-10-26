// Unit tests for the generic IMAP mailbox poller (workers/mailboxPollingEngine.ts) and the
// CV-intake handler used for info@. ImapFlow, Supabase and the CV pipeline are replaced by
// in-memory fakes; real mailparser parses the raw test emails.
//
//   node --test scripts/test-mailbox-polling.js

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '../tsconfig.json'),
  compilerOptions: { module: 'commonjs' },
});

// Quiet the engine's console logging during tests.
for (const level of ['log', 'warn', 'error']) console[level] = () => {};

const engine = require('../src/workers/mailboxPollingEngine.ts');
const { createCvIntakeMessageHandler } = require('../src/services/cvIntakeMailboxHandler.ts');
const { mayContainIntakeCvAttachment } = require('../src/services/imapMailboxService.ts');

const PDF = (label) => Buffer.from(`%PDF-1.4\n% curriculum vitae ${label}\n%%EOF\n`);

// ─── Fake IMAP server + ImapFlow client ──────────────────────────────────────

function buildRawEmail({ messageId, subject, from, date, attachments }) {
  const head =
    `From: ${from}\r\nTo: info@falishamanpower.com\r\nSubject: ${subject}\r\n` +
    `Message-ID: <${messageId}>\r\nDate: ${date.toUTCString()}\r\nMIME-Version: 1.0\r\n`;
  if (!attachments.length) {
    return Buffer.from(`${head}Content-Type: text/plain; charset=utf-8\r\n\r\nHello there\r\n`);
  }
  const boundary = 'b0undary';
  let body = `${head}Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
  body += `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease find my CV attached.\r\n`;
  for (const a of attachments) {
    body +=
      `--${boundary}\r\nContent-Type: ${a.mime}; name="${a.filename}"\r\n` +
      `Content-Disposition: attachment; filename="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
      `${Buffer.from(a.content).toString('base64')}\r\n`;
  }
  return Buffer.from(`${body}--${boundary}--\r\n`);
}

function buildBodyStructure(attachments) {
  if (!attachments.length) return { part: '1', type: 'text/plain', parameters: { charset: 'utf-8' } };
  return {
    type: 'multipart/mixed',
    childNodes: [
      { part: '1', type: 'text/plain', parameters: { charset: 'utf-8' } },
      ...attachments.map((a, i) => ({
        part: String(i + 2),
        type: a.mime,
        parameters: { name: a.filename },
        disposition: 'attachment',
        dispositionParameters: { filename: a.filename },
        size: a.content.length,
      })),
    ],
  };
}

function makeMessage(uid, { date = '2026-10-10T10:00:00Z', attachments = [], messageId, subject } = {}) {
  const spec = {
    messageId: messageId || `msg-${uid}@example.com`,
    subject: subject || `Application ${uid}`,
    from: `Applicant ${uid} <applicant${uid}@example.com>`,
    date: new Date(date),
    attachments,
  };
  return {
    uid,
    messageId: spec.messageId,
    subject: spec.subject,
    from: `applicant${uid}@example.com`,
    internalDate: spec.date,
    raw: buildRawEmail(spec),
    bodyStructure: buildBodyStructure(attachments),
    seen: false,
  };
}

const pdfAttachment = (filename, label = filename) => ({ filename, mime: 'application/pdf', content: PDF(label) });

function createFakeImapServer({ uidValidity = 777, messages = [] } = {}) {
  const server = {
    uidValidity,
    messages,
    failConnect: null,
    writes: [],
    log: [],
    clientsCreated: 0,
    uidNext() {
      return this.messages.reduce((max, m) => Math.max(max, m.uid), 0) + 1;
    },
    find(uid) {
      return this.messages.find((m) => m.uid === Number(uid)) || null;
    },
  };

  server.createClient = () => {
    server.clientsCreated++;
    return {
      mailbox: false,
      on() {
        return this;
      },
      async connect() {
        if (server.failConnect) throw new Error(server.failConnect);
        server.log.push(['connect']);
      },
      async logout() {
        server.log.push(['logout']);
      },
      close() {},
      async status() {
        return { unseen: server.messages.filter((m) => !m.seen).length };
      },
      async getMailboxLock(folder, options = {}) {
        server.log.push(['lock', folder, { readOnly: !!options.readOnly }]);
        this.mailbox = {
          path: folder,
          uidValidity: BigInt(server.uidValidity),
          uidNext: server.uidNext(),
          readOnly: !!options.readOnly,
        };
        return { path: folder, release: () => server.log.push(['release']) };
      },
      async search(query) {
        server.log.push(['search', query]);
        const uids = server.messages.map((m) => m.uid).sort((a, b) => a - b);
        if (query.uid) {
          const from = Number(String(query.uid).split(':')[0]);
          const matched = uids.filter((uid) => uid >= from);
          // Real IMAP quirk: "n:*" always matches the highest UID, even when it is below n.
          return matched.length ? matched : uids.slice(-1);
        }
        if (query.since) {
          const sinceDay = new Date(query.since).toISOString().slice(0, 10);
          return server.messages
            .filter((m) => m.internalDate.toISOString().slice(0, 10) >= sinceDay)
            .map((m) => m.uid);
        }
        return uids;
      },
      async fetchAll(range, query, options) {
        assert.equal(options?.uid, true, 'fetchAll must address messages by UID');
        assert.ok(!query.source, 'batch fetch must not download message bodies');
        server.log.push(['fetchAll', [...range]]);
        return range
          .map((uid) => server.find(uid))
          .filter(Boolean)
          .map((m, index) => ({
            seq: index + 1,
            uid: m.uid,
            size: m.raw.length,
            internalDate: m.internalDate,
            envelope: {
              messageId: `<${m.messageId}>`,
              subject: m.subject,
              from: [{ name: 'Applicant', address: m.from }],
              to: [{ address: 'info@falishamanpower.com' }],
            },
            bodyStructure: m.bodyStructure,
          }));
      },
      async fetchOne(seq, query, options) {
        assert.equal(options?.uid, true, 'fetchOne must address messages by UID');
        server.log.push(['fetchOne', Number(seq)]);
        const m = server.find(seq);
        return m ? { uid: m.uid, source: m.raw } : false;
      },
      async messageFlagsAdd(range, flags) {
        server.writes.push(['messageFlagsAdd', String(range), flags]);
        const m = server.find(range);
        if (m && flags.includes('\\Seen')) m.seen = true;
        return true;
      },
      async messageFlagsSet() {
        server.writes.push(['messageFlagsSet']);
        return true;
      },
      async messageMove() {
        server.writes.push(['messageMove']);
        return false;
      },
      async messageDelete() {
        server.writes.push(['messageDelete']);
        return true;
      },
    };
  };

  return server;
}

// ─── In-memory store (same semantics as emailReplyAuditService + migration 045) ──

function createMemoryStore(clock) {
  const checkpoints = new Map();
  const runs = [];
  const runItems = [];
  const key = (provider, mailbox) => `${provider}|${mailbox}`;

  const ensure = (provider, mailbox) => {
    const k = key(provider, mailbox);
    if (!checkpoints.has(k)) {
      checkpoints.set(k, {
        id: crypto.randomUUID(),
        provider,
        mailbox,
        lastSeenUid: 0,
        lastSeenMessageId: null,
        lastSeenReceivedAt: null,
        lastPollRunId: null,
        lastPollStartedAt: null,
        lastPollCompletedAt: null,
        uidValidity: null,
        lockOwner: null,
        lockExpiresAt: null,
        metadata: {},
        createdAt: clock.now().toISOString(),
        updatedAt: null,
      });
    }
    return checkpoints.get(k);
  };

  const store = {
    checkpoints,
    runs,
    runItems,
    seedCheckpoint(provider, mailbox, patch) {
      Object.assign(ensure(provider, mailbox), patch);
    },
    async tryAcquireLock({ provider, mailbox, owner, ttlSeconds }) {
      const cp = ensure(provider, mailbox);
      const now = clock.now().getTime();
      const free = !cp.lockOwner || cp.lockOwner === owner || !cp.lockExpiresAt || new Date(cp.lockExpiresAt).getTime() < now;
      if (!free) return false;
      cp.lockOwner = owner;
      cp.lockExpiresAt = new Date(now + Math.max(ttlSeconds, 30) * 1000).toISOString();
      return true;
    },
    async releaseLock({ provider, mailbox, owner }) {
      const cp = ensure(provider, mailbox);
      if (cp.lockOwner === owner) {
        cp.lockOwner = null;
        cp.lockExpiresAt = null;
      }
    },
    async getCheckpoint(provider, mailbox) {
      return { ...ensure(provider, mailbox), metadata: { ...ensure(provider, mailbox).metadata } };
    },
    async setCheckpointPosition({ provider, mailbox, lastSeenUid, uidValidity, metadata }) {
      const cp = ensure(provider, mailbox);
      cp.lastSeenUid = lastSeenUid;
      cp.uidValidity = String(uidValidity);
      cp.metadata = { ...cp.metadata, ...(metadata || {}) };
    },
    async advanceCheckpoint(args) {
      const cp = ensure(args.provider, args.mailbox);
      cp.lastSeenUid = Math.max(cp.lastSeenUid, Math.floor(args.lastSeenUid));
      cp.lastSeenMessageId = args.lastSeenMessageId || cp.lastSeenMessageId;
      cp.lastSeenReceivedAt = args.lastSeenReceivedAt || cp.lastSeenReceivedAt;
      cp.lastPollRunId = args.lastPollRunId || cp.lastPollRunId;
      cp.lastPollStartedAt = args.lastPollStartedAt || cp.lastPollStartedAt;
      cp.lastPollCompletedAt = args.lastPollCompletedAt || cp.lastPollCompletedAt;
      cp.metadata = { ...cp.metadata, ...(args.metadata || {}) };
    },
    async updateCheckpointMetadata(provider, mailbox, patch) {
      const cp = ensure(provider, mailbox);
      cp.metadata = { ...cp.metadata, ...patch };
    },
    async markAbandonedRuns({ provider, mailbox, staleAfterMs }) {
      const cutoff = clock.now().getTime() - staleAfterMs;
      let count = 0;
      for (const run of runs) {
        if (run.provider !== provider || run.mailbox !== mailbox || run.status !== 'running') continue;
        if (staleAfterMs > 0 && new Date(run.last_heartbeat_at).getTime() >= cutoff) continue;
        Object.assign(run, {
          status: 'failed',
          abandoned_at: clock.now().toISOString(),
          completed_at: clock.now().toISOString(),
          error_code: 'ABANDONED_RUN',
        });
        count++;
      }
      return count;
    },
    async createRun({ provider, mailbox, trigger, workerInstanceId }) {
      const id = crypto.randomUUID();
      const now = clock.now().toISOString();
      runs.push({
        id,
        provider,
        mailbox,
        trigger,
        status: 'running',
        worker_instance_id: workerInstanceId,
        started_at: now,
        last_heartbeat_at: now,
        completed_at: null,
        abandoned_at: null,
        error_code: null,
        error_message: null,
        error_details: null,
      });
      return id;
    },
    async heartbeatRun(runId) {
      const run = runs.find((r) => r.id === runId);
      if (run) run.last_heartbeat_at = clock.now().toISOString();
    },
    async completeRun(args) {
      const run = runs.find((r) => r.id === args.runId);
      if (!run) return;
      Object.assign(run, {
        status: args.status,
        completed_at: clock.now().toISOString(),
        messages_discovered: args.messagesDiscovered,
        messages_processed: args.messagesProcessed,
        success_count: args.successCount,
        error_count: args.errorCount,
        error_code: args.errorCode || null,
        error_message: args.errorMessage || null,
        error_details: args.errorDetails || null,
      });
    },
    async createRunItem(args) {
      const id = crypto.randomUUID();
      runItems.push({ id, ...args, status: 'pending' });
      return id;
    },
    async completeRunItem(args) {
      const item = runItems.find((i) => i.id === args.runItemId);
      if (item) Object.assign(item, args);
    },
    async listRecentRuns(provider, mailbox, limit) {
      return runs
        .filter((r) => r.provider === provider && r.mailbox === mailbox)
        .slice()
        .sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : runs.indexOf(b) - runs.indexOf(a)))
        .slice(0, limit);
    },
    async getLastSuccessfulRun(provider, mailbox) {
      return (
        runs
          .filter((r) => r.provider === provider && r.mailbox === mailbox && r.status === 'completed')
          .slice()
          .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))[0] || null
      );
    },
  };
  return store;
}

// ─── Fake CV pipeline (inbox_messages / inbox_attachments / parse queue) ─────

function createFakeIntake() {
  const intake = {
    messages: new Map(),
    attachments: [],
    enqueued: [],
    failCreateAttachmentOnce: new Set(),
    failEnqueueOnce: new Set(),
  };
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

  intake.deps = {
    async findInboxMessageByExternalId(externalMessageId) {
      const row = intake.messages.get(externalMessageId);
      return row ? { id: row.id, status: row.status, payload: row.payload } : null;
    },
    async createInboxMessage(input) {
      if (intake.messages.has(input.externalMessageId)) throw new Error('external_message_id already exists');
      const row = { id: crypto.randomUUID(), source: input.source, status: input.status, payload: input.payload, receivedAt: input.receivedAt };
      intake.messages.set(input.externalMessageId, row);
      return { id: row.id, payload: row.payload };
    },
    async updateInboxMessage(id, update) {
      for (const row of intake.messages.values()) {
        if (row.id === id) Object.assign(row, update);
      }
    },
    async createAttachment(input) {
      if (intake.failCreateAttachmentOnce.delete(input.fileName)) throw new Error('storage upload timed out');
      const digest = sha(input.fileBuffer);
      if (intake.attachments.some((a) => a.sha256 === digest)) throw new Error('Duplicate attachment (sha256 + type)');
      const row = { id: crypto.randomUUID(), inbox_message_id: input.inboxMessageId, sha256: digest, fileName: input.fileName, storagePath: input.storagePath, mimeType: input.mimeType };
      intake.attachments.push(row);
      return { id: row.id };
    },
    async findCvAttachmentBySha256(digest) {
      const row = intake.attachments.find((a) => a.sha256 === digest);
      return row ? { id: row.id, inbox_message_id: row.inbox_message_id } : null;
    },
    async enqueueCvParsingJob(attachmentId) {
      const row = intake.attachments.find((a) => a.id === attachmentId);
      if (row && intake.failEnqueueOnce.delete(row.fileName)) throw new Error('Redis connection refused');
      intake.enqueued.push(attachmentId);
      return { status: 'queued' };
    },
    isDuplicateError: (err) => /already exists|duplicate/i.test(String(err && err.message)),
  };
  return intake;
}

// ─── Harness ─────────────────────────────────────────────────────────────────

let defCounter = 0;

function setup({ server = createFakeImapServer(), startDate = null, batchSize = 50, readOnly = true, handler, clockStart = '2026-10-26T12:00:00Z', alertEmail = 'info@falishamanpower.com', idSuffix } = {}) {
  const clock = { current: new Date(clockStart), now() { return new Date(this.current); } };
  const store = createMemoryStore(clock);
  const intake = createFakeIntake();
  const alerts = [];
  const id = `info${idSuffix || ++defCounter}`;
  const provider = 'imap-intake';
  const mailbox = `${id}@falishamanpower.com/INBOX`;

  const def = {
    id,
    provider,
    mailbox,
    label: `${id}@falishamanpower.com`,
    folder: 'INBOX',
    readOnly,
    batchSize,
    intervalMinutes: 60,
    heartbeatIntervalMs: 60 * 60 * 1000,
    staleAfterMs: 15 * 60 * 1000,
    startDate: startDate ? new Date(startDate) : null,
    initialPosition: 'newest',
    alert: { email: alertEmail, failureThreshold: 3, staleAfterHours: 26 },
    isConfigured: () => true,
    getConnection: () => ({ host: 'imap.gmail.com', port: 993, secure: true, user: `${id}@falishamanpower.com`, pass: 'x' }),
    wantsMessage: (summary) => mayContainIntakeCvAttachment(summary.attachments),
    handleMessage:
      handler ||
      createCvIntakeMessageHandler({ inboxSource: 'email', provider, mailbox, account: `${id}@falishamanpower.com`, deps: intake.deps }),
  };

  const makeDeps = (workerInstanceId = `test-instance-${id}`) => ({
    store,
    createImapClient: () => server.createClient(),
    sendAlertEmail: async (args) => {
      alerts.push(args);
      return true;
    },
    now: () => clock.now(),
    workerInstanceId,
  });

  return { server, clock, store, intake, alerts, def, deps: makeDeps(), makeDeps };
}

function seedCurrentCheckpoint(ctx, lastSeenUid) {
  ctx.store.seedCheckpoint(ctx.def.provider, ctx.def.mailbox, { uidValidity: String(ctx.server.uidValidity), lastSeenUid });
}

function checkpointOf(ctx) {
  return ctx.store.checkpoints.get(`${ctx.def.provider}|${ctx.def.mailbox}`);
}

function downloadedUids(server) {
  return server.log.filter((entry) => entry[0] === 'fetchOne').map((entry) => entry[1]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('first run honours START_DATE, ingests only PDF/DOC/DOCX, and never writes to the mailbox', async () => {
  const server = createFakeImapServer({
    messages: [
      makeMessage(1, { date: '2026-08-01T09:00:00Z', attachments: [pdfAttachment('old-cv.pdf')] }),
      makeMessage(2, { date: '2026-10-01T09:00:00Z', attachments: [pdfAttachment('cv.pdf')] }),
      makeMessage(3, { date: '2026-10-02T09:00:00Z' }),
      makeMessage(4, {
        date: '2026-10-03T09:00:00Z',
        attachments: [{ filename: 'resume.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: Buffer.from('PK docx resume') }],
      }),
      makeMessage(5, { date: '2026-10-04T09:00:00Z', attachments: [{ filename: 'photo.jpg', mime: 'image/jpeg', content: Buffer.from('jpeg') }] }),
      makeMessage(6, {
        date: '2026-10-05T09:00:00Z',
        attachments: [
          { filename: 'biodata.doc', mime: 'application/msword', content: Buffer.from('doc biodata') },
          { filename: 'certificates.zip', mime: 'application/zip', content: Buffer.from('zip') },
        ],
      }),
    ],
  });
  const ctx = setup({ server, startDate: '2026-09-26' });

  const result = await engine.pollMailbox(ctx.def, 'recovery', ctx.deps);

  assert.equal(result.status, 'completed');
  assert.deepEqual(
    ctx.intake.attachments.map((a) => a.fileName).sort(),
    ['biodata.doc', 'cv.pdf', 'resume.docx']
  );
  assert.equal(ctx.intake.enqueued.length, 3);
  for (const row of ctx.intake.messages.values()) {
    assert.equal(row.source, 'email');
    assert.equal(row.status, 'processed');
  }
  assert.equal(ctx.intake.messages.size, 3, 'one inbox message per email with a CV attachment');

  const cp = checkpointOf(ctx);
  assert.equal(cp.lastSeenUid, 6);
  assert.equal(cp.uidValidity, '777');
  assert.equal(cp.lockOwner, null, 'lock released after the run');

  // Read-only: EXAMINE, no flag changes, no moves or deletes, nothing marked seen.
  assert.deepEqual(server.log.find((e) => e[0] === 'lock')[2], { readOnly: true });
  assert.deepEqual(server.writes, []);
  assert.ok(server.messages.every((m) => !m.seen));

  // Messages before START_DATE or without a document attachment are never downloaded.
  assert.deepEqual(downloadedUids(server).sort(), [2, 4, 6]);
});

test('with no START_DATE a fresh mailbox starts at the newest mail (history is not imported)', async () => {
  const server = createFakeImapServer({
    messages: [1, 2, 3].map((uid) => makeMessage(uid, { attachments: [pdfAttachment(`cv${uid}.pdf`)] })),
  });
  const ctx = setup({ server });

  const first = await engine.pollMailbox(ctx.def, 'recovery', ctx.deps);
  assert.equal(first.status, 'completed');
  assert.equal(first.messagesDiscovered, 0);
  assert.equal(ctx.intake.attachments.length, 0);
  assert.equal(checkpointOf(ctx).lastSeenUid, 3);

  server.messages.push(makeMessage(4, { attachments: [pdfAttachment('cv4.pdf')] }));
  const second = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(second.status, 'completed');
  assert.deepEqual(ctx.intake.attachments.map((a) => a.fileName), ['cv4.pdf']);
  assert.equal(checkpointOf(ctx).lastSeenUid, 4);
});

test('catch-up loop keeps fetching batches until it reaches the newest mail', async () => {
  const server = createFakeImapServer({
    messages: Array.from({ length: 45 }, (_, i) => makeMessage(i + 1, { attachments: [pdfAttachment(`cv${i + 1}.pdf`)] })),
  });
  const ctx = setup({ server, batchSize: 10 });
  seedCurrentCheckpoint(ctx, 0);

  const result = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);

  assert.equal(result.status, 'completed');
  assert.equal(result.messagesDiscovered, 45);
  assert.equal(ctx.intake.attachments.length, 45);
  assert.equal(server.log.filter((e) => e[0] === 'fetchAll').length, 5);
  assert.equal(checkpointOf(ctx).lastSeenUid, 45);

  // Nothing new: the IMAP "46:*" quirk must not re-import the last message.
  server.log.length = 0;
  const idle = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(idle.status, 'completed');
  assert.equal(idle.messagesDiscovered, 0);
  assert.equal(server.log.filter((e) => e[0] === 'fetchAll').length, 0);
  assert.equal(ctx.intake.attachments.length, 45);
});

test('a failed message holds the checkpoint; the next run retries it and dedupes the rest', async () => {
  const server = createFakeImapServer({
    messages: [1, 2, 3, 4, 5].map((uid) => makeMessage(uid, { attachments: [pdfAttachment(`cv${uid}.pdf`)] })),
  });
  const ctx = setup({ server });
  seedCurrentCheckpoint(ctx, 0);
  ctx.intake.failCreateAttachmentOnce.add('cv3.pdf');

  const first = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(first.status, 'completed_with_errors');
  assert.equal(first.messagesFailed, 1);
  assert.equal(checkpointOf(ctx).lastSeenUid, 2, 'checkpoint stops before the failed message');
  assert.equal(ctx.intake.attachments.length, 4, 'later messages are still ingested');
  const failedItem = ctx.store.runItems.find((i) => i.messageUid === 3);
  assert.equal(failedItem.status, 'failed');

  const second = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(second.status, 'completed');
  assert.equal(checkpointOf(ctx).lastSeenUid, 5);
  assert.equal(ctx.intake.messages.size, 5, 'exactly one inbox message per Message-ID');
  assert.equal(ctx.intake.attachments.length, 5, 'each CV stored once');
  assert.equal(ctx.intake.enqueued.length, 5, 'each CV queued once');
  const secondRunItems = ctx.store.runItems.filter((i) => i.runId === second.runId);
  assert.deepEqual(
    secondRunItems.map((i) => [i.messageUid, i.status]),
    [[3, 'ingested'], [4, 'duplicate'], [5, 'duplicate']]
  );
});

test('an email interrupted after storing one attachment resumes without duplicating it', async () => {
  const server = createFakeImapServer({
    messages: [makeMessage(1, { attachments: [pdfAttachment('a.pdf'), pdfAttachment('b.pdf')] })],
  });
  const ctx = setup({ server });
  seedCurrentCheckpoint(ctx, 0);
  ctx.intake.failEnqueueOnce.add('a.pdf'); // stored, but Redis refuses the parse job

  const first = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(first.status, 'completed_with_errors');
  assert.equal(checkpointOf(ctx).lastSeenUid, 0);
  const [row] = [...ctx.intake.messages.values()];
  assert.equal(row.status, 'pending');

  const second = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(second.status, 'completed');
  assert.equal(checkpointOf(ctx).lastSeenUid, 1);
  assert.equal(ctx.intake.messages.size, 1);
  assert.deepEqual(ctx.intake.attachments.map((a) => a.fileName).sort(), ['a.pdf', 'b.pdf']);
  assert.equal(ctx.intake.enqueued.length, 2, 'a.pdf is queued on the retry, b.pdf once');
  assert.equal(row.status, 'processed');
});

test('an abandoned run from a crashed instance is closed and the poll resumes from the checkpoint', async () => {
  const server = createFakeImapServer({
    messages: [1, 2, 3, 4].map((uid) => makeMessage(uid, { attachments: [pdfAttachment(`cv${uid}.pdf`)] })),
  });
  const ctx = setup({ server });
  ctx.store.seedCheckpoint(ctx.def.provider, ctx.def.mailbox, {
    uidValidity: '777',
    lastSeenUid: 2,
    lockOwner: 'crashed-replica|pid:1|boot:dead',
    lockExpiresAt: '2026-10-26T11:00:00Z', // lease expired an hour ago
  });
  const deadRunId = await ctx.store.createRun({ provider: ctx.def.provider, mailbox: ctx.def.mailbox, trigger: 'worker', workerInstanceId: 'crashed-replica' });
  ctx.store.runs[0].started_at = '2026-10-26T10:00:00Z';
  ctx.store.runs[0].last_heartbeat_at = '2026-10-26T10:05:00Z';

  const result = await engine.pollMailbox(ctx.def, 'recovery', ctx.deps);

  const deadRun = ctx.store.runs.find((r) => r.id === deadRunId);
  assert.equal(deadRun.status, 'failed');
  assert.equal(deadRun.error_code, 'ABANDONED_RUN');
  assert.ok(deadRun.abandoned_at);
  assert.equal(result.status, 'completed');
  assert.deepEqual(ctx.intake.attachments.map((a) => a.fileName), ['cv3.pdf', 'cv4.pdf'], 'resumes after UID 2');
  assert.deepEqual(server.log.filter((e) => e[0] === 'fetchAll').map((e) => e[1]), [[3, 4]]);
  assert.equal(checkpointOf(ctx).lastSeenUid, 4);
});

test('a live lock held by another instance stops a second runner before it touches IMAP', async () => {
  const server = createFakeImapServer({ messages: [makeMessage(1, { attachments: [pdfAttachment('cv.pdf')] })] });
  const ctx = setup({ server });
  seedCurrentCheckpoint(ctx, 0);
  ctx.store.seedCheckpoint(ctx.def.provider, ctx.def.mailbox, {
    lockOwner: 'other-replica',
    lockExpiresAt: '2026-10-26T12:10:00Z',
  });

  const result = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(result.status, 'skipped');
  assert.equal(result.skippedReason, 'locked');
  assert.equal(server.clientsCreated, 0);
  assert.equal(ctx.store.runs.length, 0);
  assert.equal(checkpointOf(ctx).lockOwner, 'other-replica');
});

test('two replicas polling the same mailbox at once: exactly one runs', async () => {
  const server = createFakeImapServer({
    messages: [1, 2, 3].map((uid) => makeMessage(uid, { attachments: [pdfAttachment(`cv${uid}.pdf`)] })),
  });
  const ctx = setup({ server });
  seedCurrentCheckpoint(ctx, 0);
  // Same provider/mailbox key, separate in-process state and instance ids (as on two replicas).
  const replicaB = { ...ctx.def, id: `${ctx.def.id}-replica-b` };

  const [a, b] = await Promise.all([
    engine.pollMailbox(ctx.def, 'worker', ctx.makeDeps('replica-a')),
    engine.pollMailbox(replicaB, 'worker', ctx.makeDeps('replica-b')),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ['completed', 'skipped']);
  assert.equal([a, b].find((r) => r.status === 'skipped').skippedReason, 'locked');
  assert.equal(ctx.intake.attachments.length, 3);
  assert.equal(ctx.store.runs.length, 1);
});

test('UIDVALIDITY change rescans by date and dedupes on Message-ID', async () => {
  const server = createFakeImapServer({
    uidValidity: 100,
    messages: [
      makeMessage(1, { date: '2026-10-01T08:00:00Z', attachments: [pdfAttachment('a.pdf')] }),
      makeMessage(2, { date: '2026-10-02T08:00:00Z', attachments: [pdfAttachment('b.pdf')] }),
      makeMessage(3, { date: '2026-10-03T08:00:00Z', attachments: [pdfAttachment('c.pdf')] }),
    ],
  });
  const ctx = setup({ server });
  seedCurrentCheckpoint(ctx, 0);

  await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(ctx.intake.attachments.length, 3);
  assert.equal(checkpointOf(ctx).lastSeenUid, 3);

  // The server renumbers the folder: same mail under new UIDs, plus one new email.
  server.uidValidity = 200;
  server.messages = [
    makeMessage(10, { date: '2026-10-01T08:00:00Z', messageId: 'msg-1@example.com', attachments: [pdfAttachment('a.pdf')] }),
    makeMessage(11, { date: '2026-10-02T08:00:00Z', messageId: 'msg-2@example.com', attachments: [pdfAttachment('b.pdf')] }),
    makeMessage(12, { date: '2026-10-03T08:00:00Z', messageId: 'msg-3@example.com', attachments: [pdfAttachment('c.pdf')] }),
    makeMessage(13, { date: '2026-10-04T08:00:00Z', attachments: [pdfAttachment('d.pdf')] }),
  ];

  const result = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(result.status, 'completed');
  const cp = checkpointOf(ctx);
  assert.equal(cp.uidValidity, '200');
  assert.equal(cp.lastSeenUid, 13);
  assert.equal(cp.metadata.previousUidValidity, '100');
  assert.equal(ctx.intake.messages.size, 4, 'renumbered mail is not imported twice');
  assert.deepEqual(ctx.intake.attachments.map((a) => a.fileName), ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']);
  const items = ctx.store.runItems.filter((i) => i.runId === result.runId).map((i) => [i.messageUid, i.status]);
  assert.deepEqual(items, [[10, 'duplicate'], [11, 'duplicate'], [12, 'duplicate'], [13, 'ingested']]);
});

test('read-only mailboxes refuse flag changes; a writable (Hostinger-style) mailbox may mark seen', async () => {
  const readOnlyServer = createFakeImapServer({ messages: [makeMessage(1, { attachments: [pdfAttachment('cv.pdf')] })] });
  const ro = setup({
    server: readOnlyServer,
    handler: async (ctx) => {
      await ctx.markSeen();
      return { status: 'matched' };
    },
  });
  seedCurrentCheckpoint(ro, 0);
  const roResult = await engine.pollMailbox(ro.def, 'worker', ro.deps);
  assert.equal(roResult.status, 'completed_with_errors');
  assert.match(String(roResult.error), /read-only/);
  assert.deepEqual(readOnlyServer.writes, []);
  assert.equal(checkpointOf(ro).lastSeenUid, 0);

  const writableServer = createFakeImapServer({ messages: [makeMessage(1, { attachments: [pdfAttachment('cv.pdf')] })] });
  const rw = setup({
    server: writableServer,
    readOnly: false,
    handler: async (ctx) => {
      await ctx.markSeen();
      return { status: 'matched' };
    },
  });
  seedCurrentCheckpoint(rw, 0);
  const rwResult = await engine.pollMailbox(rw.def, 'worker', rw.deps);
  assert.equal(rwResult.status, 'completed');
  assert.deepEqual(writableServer.log.find((e) => e[0] === 'lock')[2], { readOnly: false });
  assert.deepEqual(writableServer.writes, [['messageFlagsAdd', '1', ['\\Seen']]]);
});

test('three consecutive failed runs send one alert; recovery sends a resolved note', async () => {
  const server = createFakeImapServer({ messages: [makeMessage(1, { attachments: [pdfAttachment('cv.pdf')] })] });
  const ctx = setup({ server });
  seedCurrentCheckpoint(ctx, 0);
  server.failConnect = 'Invalid credentials (Failure)';

  for (let i = 0; i < 2; i++) {
    const r = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
    assert.equal(r.status, 'failed');
    ctx.clock.current = new Date(ctx.clock.current.getTime() + 60_000);
  }
  assert.equal(ctx.alerts.length, 0, 'no alert before the threshold');

  await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(ctx.alerts.length, 1);
  assert.equal(ctx.alerts[0].to, 'info@falishamanpower.com');
  assert.match(ctx.alerts[0].text, /Consecutive failed runs: 3/);
  assert.match(ctx.alerts[0].text, /Invalid credentials/);

  ctx.clock.current = new Date(ctx.clock.current.getTime() + 60_000);
  await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(ctx.alerts.length, 1, 'no repeat within 24h for the same incident');

  server.failConnect = null;
  ctx.clock.current = new Date(ctx.clock.current.getTime() + 60_000);
  const ok = await engine.pollMailbox(ctx.def, 'worker', ctx.deps);
  assert.equal(ok.status, 'completed');
  assert.equal(ctx.alerts.length, 2);
  assert.match(ctx.alerts[1].subject, /^Resolved/);
  assert.equal(checkpointOf(ctx).metadata.alert.open, false);
});

test('no successful poll for more than 26 hours sends an alert', async () => {
  const ctx = setup({ clockStart: '2026-10-26T12:00:00Z' });
  ctx.store.seedCheckpoint(ctx.def.provider, ctx.def.mailbox, { createdAt: '2026-10-25T06:00:00Z' });

  await engine.evaluateMailboxAlerts(ctx.def, ctx.deps);
  assert.equal(ctx.alerts.length, 1);
  assert.match(ctx.alerts[0].text, /No successful poll for about 30 hours/);
});

test('BODYSTRUCTURE pre-filter keeps documents, drops plain mail and images', () => {
  assert.equal(mayContainIntakeCvAttachment([]), false);
  assert.equal(mayContainIntakeCvAttachment([{ filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1 }]), false);
  assert.equal(mayContainIntakeCvAttachment([{ filename: 'CV.PDF', mimeType: 'application/octet-stream', size: 1 }]), true);
  assert.equal(mayContainIntakeCvAttachment([{ filename: '', mimeType: 'application/pdf', size: 1 }]), true);
  assert.equal(mayContainIntakeCvAttachment([{ filename: 'x.zip', mimeType: 'application/zip', size: 1 }]), false);
});
