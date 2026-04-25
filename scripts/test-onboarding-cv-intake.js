const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const express = require('express');
const http = require('node:http');

function createCandidateQuery(candidate) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    neq() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({ data: { ...candidate }, error: null });
    },
  };
}

test('onboarding CV upload returns queued intake metadata and refreshed onboarding payload', async () => {
  const targetPath = path.resolve(__dirname, '../dist/routes/onboarding.js');
  delete require.cache[targetPath];

  const state = {
    inboxMessageArgs: null,
    attachmentArgs: null,
    enqueueArgs: null,
  };

  const candidate = {
    id: 'candidate-1',
    email_tracking_token: 'ONB123',
    name: 'A Candidate',
    email: 'candidate@example.com',
    phone: '+923001112233',
    date_of_birth: '1994-01-01',
    address: 'Rawalpindi',
    passport_received: false,
    cnic_received: false,
    driving_license_received: false,
    police_character_received: false,
    certificate_received: false,
    medical_received: false,
    visa_received: false,
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../middleware/auth') {
      return {
        authenticate: (_req, _res, next) => next(),
      };
    }

    if (request === '../config/database') {
      return {
        supabaseAdminClient: () => ({
          from(table) {
            if (table === 'candidates') {
              return createCandidateQuery(candidate);
            }
            throw new Error(`Unexpected table access in onboarding test: ${table}`);
          },
          storage: {
            from() {
              return {
                createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/profile.jpg' }, error: null }),
              };
            },
          },
        }),
      };
    }

    if (request === '../services/candidateDocumentService') {
      return {
        uploadCandidateDocument: async () => {
          throw new Error('non-CV upload path should not run in this test');
        },
        formatDocumentResponse: async (doc) => doc,
        listCandidateDocumentsByCandidate: async () => [{ id: 'existing-doc', file_name: 'Existing Passport.pdf' }],
      };
    }

    if (request === '../services/documentClassifier') {
      return {
        DocumentClassifier: {
          classify: () => ({ attachmentKind: 'cv' }),
        },
      };
    }

    if (request === '../services/inboxAttachmentService') {
      return {
        createAttachment: async (args) => {
          state.attachmentArgs = args;
          return { id: 'att-queued-1' };
        },
        enqueueCvParsingJobForAttachment: async (attachmentId, options) => {
          state.enqueueArgs = { attachmentId, options };
          return { jobId: 'job-queued-1', status: 'queued' };
        },
      };
    }

    if (request === '../services/inboxService') {
      return {
        createInboxMessage: async (args) => {
          state.inboxMessageArgs = args;
          return { id: 'msg-queued-1' };
        },
      };
    }

    if (request === '../services/progressiveDataCompletionService') {
      return { updateFieldManually: async () => {} };
    }

    if (request === '../services/timelineService') {
      return { logProfileUpdated: async () => {} };
    }

    return originalLoad(request, parent, isMain);
  };

  let server;
  try {
    const onboardingRouter = require(targetPath).default;
    const app = express();
    app.use(onboardingRouter);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();
    const form = new FormData();
    form.set('token', 'ONB123');
    form.set('document_type', 'cv');
    form.set('file', new Blob([Buffer.from('fake-pdf')], { type: 'application/pdf' }), 'resume.pdf');

    const response = await fetch(`http://127.0.0.1:${address.port}/documents`, {
      method: 'POST',
      body: form,
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.document, null);
    assert.equal(body.request_id, 'job-queued-1');
    assert.equal(body.intake_attachment_id, 'att-queued-1');
    assert.equal(body.intake_status, 'queued');
    assert.equal(body.onboarding.candidate.id, 'candidate-1');
    assert.equal(body.onboarding.documents.length, 1);
    assert.ok(Array.isArray(body.onboarding.missing_documents));
    assert.ok(body.onboarding.completion);

    assert.equal(state.inboxMessageArgs.source, 'web');
    assert.equal(state.inboxMessageArgs.payload.origin, 'candidate_onboarding_cv_upload');
    assert.equal(state.attachmentArgs.linkedCandidateId, 'candidate-1');
    assert.equal(state.attachmentArgs.messageSource, 'web');
    assert.deepEqual(state.enqueueArgs, {
      attachmentId: 'att-queued-1',
      options: { force: false, expiresInSeconds: 3600 },
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[targetPath];
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});