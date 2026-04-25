const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function createSupabaseBuilder(state, table) {
  const query = {
    table,
    filters: [],
    selectArg: null,
    updatePayload: null,
    insertPayload: null,
    _singleMode: null,
    select(arg) {
      this.selectArg = arg;
      return this;
    },
    update(payload) {
      this.updatePayload = payload;
      return this;
    },
    insert(payload) {
      this.insertPayload = payload;
      return this;
    },
    eq(column, value) {
      this.filters.push({ op: 'eq', column, value });
      return this;
    },
    ilike(column, value) {
      this.filters.push({ op: 'ilike', column, value });
      return this;
    },
    neq(column, value) {
      this.filters.push({ op: 'neq', column, value });
      return this;
    },
    not(column, op, value) {
      this.filters.push({ op: 'not', column, value, modifier: op });
      return this;
    },
    is(column, value) {
      this.filters.push({ op: 'is', column, value });
      return this;
    },
    order() {
      return this;
    },
    range() {
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle() {
      this._singleMode = 'maybeSingle';
      return Promise.resolve(resolveSupabaseResult(state, this));
    },
    single() {
      this._singleMode = 'single';
      return Promise.resolve(resolveSupabaseResult(state, this));
    },
    then(resolve, reject) {
      return Promise.resolve(resolveSupabaseResult(state, this)).then(resolve, reject);
    },
  };

  return query;
}

function getEq(filters, column) {
  return filters.find((item) => item.op === 'eq' && item.column === column)?.value;
}

function resolveSupabaseResult(state, query) {
  const { table, filters, selectArg, updatePayload, insertPayload } = query;

  if (updatePayload) {
    state.updates.push({ table, payload: updatePayload, filters });
    return { data: null, error: null };
  }

  if (insertPayload) {
    state.inserts.push({ table, payload: insertPayload });
    if (table === 'candidate_documents') {
      return { data: { id: 'doc-created', file_name: insertPayload.file_name }, error: null };
    }
    return { data: insertPayload, error: null };
  }

  if (table === 'inbox_attachments') {
    const attachmentId = getEq(filters, 'id');
    if (attachmentId === 'att-prebound' && String(selectArg).includes('file_name')) {
      return {
        data: {
          file_name: 'resume.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          storage_bucket: 'documents',
          storage_path: 'uploads/resume.docx',
          sha256: 'filehash-1',
          candidate_id: null,
          linked_candidate_id: 'owner-candidate-1',
          parsing_status: 'queued',
          attachment_kind: 'cv',
          attachment_type: 'cv',
          inbox_message_id: null,
          inbox_messages: null,
        },
        error: null,
      };
    }

    if (attachmentId === 'att-prebound' && String(selectArg).includes('linked_candidate_id')) {
      return { data: { linked_candidate_id: 'owner-candidate-1' }, error: null };
    }

    if (attachmentId === 'att-prebound' && String(selectArg).includes('inbox_message_id')) {
      return { data: { inbox_message_id: null }, error: null };
    }

    if (getEq(filters, 'sha256') === 'filehash-1') {
      return { data: null, error: null };
    }

    if (getEq(filters, 'inbox_message_id')) {
      return { data: null, error: null };
    }
  }

  if (table === 'candidate_documents') {
    return { data: [], error: null };
  }

  if (table === 'candidates') {
    const candidateId = getEq(filters, 'id');
    if (candidateId === 'cand-created') {
      return {
        data: {
          id: 'cand-created',
          candidate_code: 'FL-TEST-1',
          name: 'Parsed Candidate',
          email: 'parsed@example.com',
          phone: '+923001112233',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }

  return { data: null, error: null };
}

test('pre-bound attachment linked_candidate_id alone does not bypass forced parser flow', async () => {
  const targetPath = path.resolve(__dirname, '../dist/workers/cvParserWorker.js');
  delete require.cache[targetPath];
  const originalHmacSecret = process.env.PYTHON_HMAC_SECRET;
  process.env.PYTHON_HMAC_SECRET = 'test-hmac-secret';

  const state = {
    updates: [],
    inserts: [],
    createCandidateCalls: [],
    enrichCalls: [],
    parsingStatusCalls: [],
  };

  let processor;
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'bullmq') {
      return {
        Worker: class WorkerMock {
          constructor(_name, fn) {
            processor = fn;
          }
          on() {
            return this;
          }
        },
        UnrecoverableError: class UnrecoverableError extends Error {},
      };
    }

    if (request === '../config/redis') {
      return { redis: {} };
    }

    if (request === '../services/parsingJobsService') {
      return {
        ParsingJobsService: class ParsingJobsServiceMock {
          async setStatus(jobId, status) {
            state.parsingStatusCalls.push({ jobId, status });
          }
        },
      };
    }

    if (request === '../services/candidateService') {
      return {
        createCandidate: async (payload) => {
          state.createCandidateCalls.push(payload);
          return {
            id: 'cand-created',
            candidate_code: 'FL-TEST-1',
            name: payload.name,
            email: payload.email,
            phone: payload.phone,
          };
        },
        normalizePhoneE164: (value) => value || null,
      };
    }

    if (request === '../config/database') {
      return {
        supabaseAdminClient: () => ({
          from(table) {
            return createSupabaseBuilder(state, table);
          },
          storage: {
            from() {
              return {
                createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/resume.docx' }, error: null }),
                download: async () => ({ data: new Blob([Buffer.from('resume-bytes')]), error: null }),
                upload: async () => ({ error: null }),
              };
            },
          },
        }),
      };
    }

    if (request === '../services/splitUploadService') {
      return {
        callSplitAndCategorize: async () => ({ documents: [], engine_used: 'test' }),
        docTypeToFolder: () => 'cv_resume',
        preserveOriginalPdf: async () => 'original/path.pdf',
      };
    }

    if (request === '../services/hybridPhotoExtractionService') {
      return {
        extractProfilePhotoHybrid: async () => ({ success: false, method: 'none' }),
        uploadExtractedPhotoToCandidatePhotos: async () => ({ storagePath: 'candidate_photos/profile.jpg' }),
      };
    }

    if (request === '../config/documentCategories') {
      return {
        DOCUMENT_CATEGORIES: { CV_RESUME: 'cv_resume', PHOTOS: 'photos' },
        VERIFICATION_STATUS: { PENDING_AI: 'pending_ai', VERIFIED: 'verified' },
      };
    }

    if (request === '../config/queue') {
      return {
        documentVerificationQueue: { add: async () => {} },
      };
    }

    if (request === '../services/documentVerificationLogService') {
      return { generateRequestId: () => 'req-1' };
    }

    if (request === '../utils/splitDocumentProcessor') {
      return {
        processSplitDocument: async () => ({
          storagePath: 'processed/doc',
          mimeType: 'application/pdf',
          shouldAutoVerify: false,
        }),
      };
    }

    if (request === '../utils/documentNaming') {
      return { generateDescriptiveFilename: () => 'CV.pdf' };
    }

    if (request === '../services/progressiveDataCompletionService') {
      return {
        isGovernmentEmail: () => false,
        findExistingCandidate: async () => null,
        enrichCandidateData: async (...args) => {
          state.enrichCalls.push(args);
          return { updated: [], skipped: [] };
        },
        updateMissingFields: async () => [],
      };
    }

    if (request === '../services/aiProfilePhotoExtractionService') {
      return { extractProfilePhotoFromPdfUsingAI: async () => ({ pageUsed: 1, confidence: 0.9 }) };
    }

    if (request === '../services/whatsappService') {
      return {
        sendMessage: async () => ({ messages: [{ id: 'wamid-1' }] }),
        sendTemplateMessage: async () => ({ messages: [{ id: 'wamid-2' }] }),
      };
    }

    if (request === '../services/whatsappInboxService') {
      return {
        ensureConversationForPhone: async () => ({ id: 'conversation-1' }),
        recordOutboundMessage: async () => {},
      };
    }

    if (request === '../services/professionInferenceService') {
      return { inferProfessionFromCvData: () => 'Electrician' };
    }

    if (request === '../services/emailService') {
      return { emailService: { sendEmail: async () => {} } };
    }

    if (request === '../utils/singleCvHeuristics') {
      return { shouldSkipSplitAndCategorizeForSingleCvUpload: () => true };
    }

    if (request === '../services/missingDataEmailService') {
      return { maybeSendMissingDataEmail: async () => ({ sent: false }) };
    }

    return originalLoad(request, parent, isMain);
  };

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      schema_version: 'v1',
      candidate: {
        full_name: 'Parsed Candidate',
        email: 'parsed@example.com',
        phone: '+923001112233',
        position: 'Electrician',
      },
    }),
    text: async () => '',
  });

  try {
    const workerModule = require(targetPath);
    workerModule.startCvParserWorker();
    assert.equal(typeof processor, 'function');

    const result = await processor({
      data: {
        jobId: 'job-1',
        attachmentId: 'att-prebound',
        fileHash: 'filehash-1',
        force: true,
      },
      attemptsMade: 0,
    });

    assert.notEqual(result?.skipped, true, 'worker should not skip forced parsing when only linked_candidate_id is pre-bound');
    assert.equal(state.createCandidateCalls.length, 1, 'force parse should still create/link a candidate when only linked_candidate_id is pre-bound');
    assert.equal(state.enrichCalls.length, 1, 'newly created candidate should still be enriched after parsing');

    const forcedFallbackUpdate = state.updates.find((item) => item.table === 'inbox_attachments' && item.payload.candidate_id === 'cand-created');
    assert.ok(forcedFallbackUpdate, 'parsed candidate should be assigned to inbox attachment');
    assert.equal(forcedFallbackUpdate.payload.linked_candidate_id, 'owner-candidate-1', 'ownership binding should be preserved separately');
  } finally {
    process.env.PYTHON_HMAC_SECRET = originalHmacSecret;
    Module._load = originalLoad;
    global.fetch = originalFetch;
    delete require.cache[targetPath];
  }
});