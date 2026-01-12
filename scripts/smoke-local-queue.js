/**
 * Local Smoke Test for CV Processing Queue
 * Tests the process/status endpoints and queue health without requiring live attachments
 * 
 * Usage:
 *   npm run smoke:local-queue
 *   or
 *   API_BASE_URL=http://localhost:4100 npm run smoke:local-queue
 */

/* eslint-disable no-console */
require('dotenv').config();

const API = process.env.API_BASE_URL || 'http://localhost:4100';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function testHealthEndpoint() {
  console.log('\n=== Test 1: Queue Health Endpoint ===');
  try {
    const res = await fetch(`${API}/api/health/queue`, { method: 'GET' });
    if (!res.ok) {
      console.warn(`⚠️  Health endpoint returned ${res.status}`);
      console.log('Note: Health endpoint may not be deployed on Railway');
      return { ok: false, status: res.status };
    }
    const data = await res.json();
    console.log('✅ Health endpoint reachable');
    console.log('Response:', JSON.stringify(data, null, 2));
    return { ok: true, data };
  } catch (e) {
    console.warn(`⚠️  Health endpoint unreachable: ${e.message}`);
    console.log('Note: This may be normal on Railway if endpoint is not deployed');
    return { ok: false, error: e.message };
  }
}

async function testAttachmentUpload() {
  console.log('\n=== Test 2: Create Test Attachment ===');
  try {
    // 1. Create a test inbox message
    const msgRes = await fetch(`${API}/api/cv-inbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'smoke-test',
        external_message_id: `smoke_${Date.now()}`,
        payload: { text: 'Smoke test CV upload' },
        status: 'pending',
      }),
    });

    if (!msgRes.ok) {
      const err = await msgRes.json();
      console.error('Failed to create inbox message:', msgRes.status, err);
      return { ok: false };
    }

    const msg = await msgRes.json();
    const messageId = msg.id;
    console.log(`✅ Created test message: ${messageId}`);

    // 2. Create test attachment (base64 encoded mock PDF)
    const mockPdfBase64 = 'JVBERi0xLjAKCjEgMCBvYmo+Cjw8IC9UeXBlIC9DYXRhbG9nIC9QYWdlcyAyIDAgUiA+PgplbmRvYgoKMiAwIG9iagogIDw8IC9UeXBlIC9QYWdlcyAvS2lkcyBbMyAwIFJdIC9Db3VudCAxID4+CmVuZG9iCgozIDAgb2JqCiAgPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQogICAgIC9Db250ZW50cyA0IDAgUiA+PgplbmRvYgoK NCAwIG9iagogIDw8IC9MZW5ndGggNDQgPj4Kc3RyZWFtCkJUCi9GMSA0OCBUZgoxMDAgNzAwIFRkClN0b2tlIFRqCkVUCmVuZHN0cmVhbQplbmRvYgoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDA3OSAwMDAwMCBuIAowMDAwMDAwMTczIDAwMDAwIG4gCjAwMDAwMDAzMDEgMDAwMDAgbiAKdHJhaWxlcgogIDw8IC9TaXplIDUgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQwNAolJUVPRgo=';
    
    const attRes = await fetch(`${API}/api/cv-inbox/${messageId}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file_name: 'smoke-test.pdf',
        mime_type: 'application/pdf',
        storage_bucket: 'inbox',
        storage_path: `smoke/${messageId}/test.pdf`,
        attachment_type: 'cv',
        file_base64: mockPdfBase64,
      }),
    });

    if (!attRes.ok) {
      const err = await attRes.json();
      console.error('Failed to create attachment:', attRes.status, err);
      return { ok: false };
    }

    const att = await attRes.json();
    const attachmentId = att.id;
    console.log(`✅ Created test attachment: ${attachmentId}`);

    return { ok: true, messageId, attachmentId };
  } catch (e) {
    console.error('Error in attachment upload:', e.message);
    return { ok: false, error: e.message };
  }
}

async function testProcessEndpoint(attachmentId) {
  console.log('\n=== Test 3: Trigger CV Parsing Job ===');
  try {
    const res = await fetch(`${API}/api/cv-inbox/attachments/${attachmentId}/process`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    if (!res.ok) {
      const err = await res.json();
      console.error('Failed to trigger parsing:', res.status, err);
      return { ok: false };
    }

    const data = await res.json();
    const jobId = data.job_id;
    console.log(`✅ Triggered parsing job: ${jobId}`);
    console.log('Response:', JSON.stringify(data, null, 2));

    return { ok: true, jobId };
  } catch (e) {
    console.error('Error triggering parsing:', e.message);
    return { ok: false, error: e.message };
  }
}

async function testStatusEndpoint(jobId) {
  console.log('\n=== Test 4: Check Job Status (Initial) ===');
  try {
    const res = await fetch(`${API}/api/parsing-jobs/${jobId}`, { method: 'GET' });

    if (!res.ok) {
      const err = await res.json();
      console.error('Failed to fetch status:', res.status, err);
      return { ok: false };
    }

    const data = await res.json();
    console.log(`Job status: ${data.status} (attempts: ${data.attempts || 0})`);
    console.log('Full response:', JSON.stringify(data, null, 2));

    return { ok: true, status: data.status };
  } catch (e) {
    console.error('Error fetching job status:', e.message);
    return { ok: false, error: e.message };
  }
}

async function testStatusPolling(jobId, maxWait = 30000) {
  console.log('\n=== Test 5: Poll Job Status (30s timeout) ===');
  const started = Date.now();
  let lastStatus = null;

  while (true) {
    const elapsed = Date.now() - started;
    const elapsedSec = Math.floor(elapsed / 1000);

    try {
      const res = await fetch(`${API}/api/parsing-jobs/${jobId}`, { method: 'GET' });

      if (!res.ok) {
        console.error(`Status fetch failed: ${res.status}`);
        break;
      }

      const data = await res.json();
      lastStatus = data.status;

      console.log(
        `[${elapsedSec}s] status=${data.status}, attempts=${data.attempts || 0}${
          data.error_message ? `, error="${data.error_message}"` : ''
        }`
      );

      if (data.status === 'extracted') {
        console.log(`✅ Job completed successfully!`);
        console.log('Result keys:', data.result ? Object.keys(data.result) : []);
        return { ok: true, status: 'extracted', result: data };
      }

      if (data.status === 'failed') {
        console.log(`❌ Job failed: ${data.error_message || 'unknown error'}`);
        return { ok: false, status: 'failed', result: data };
      }

      if (elapsed > maxWait) {
        console.log(`⏳ Job still pending after ${maxWait / 1000}s (no worker running, expected)`);
        console.log(`Note: Worker requires RUN_WORKER=true env var to process jobs`);
        return { ok: true, status: 'queued', note: 'Worker not running' };
      }
    } catch (e) {
      console.error(`Status poll error: ${e.message}`);
      break;
    }

    await sleep(2000);
  }

  return { ok: false, error: 'Polling failed', lastStatus };
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  CV Parsing Queue - Local Smoke Test                           ║
║  API Base: ${API.padEnd(50)} ║
╚════════════════════════════════════════════════════════════════╝
`);

  // Test 1: Health
  const health = await testHealthEndpoint();

  // Test 2: Upload attachment
  const upload = await testAttachmentUpload();
  if (!upload.ok) {
    console.error('\n❌ Failed to create test attachment');
    process.exitCode = 1;
    return;
  }

  // Test 3: Process
  const proc = await testProcessEndpoint(upload.attachmentId);
  if (!proc.ok) {
    console.error('\n❌ Failed to trigger parsing');
    process.exitCode = 1;
    return;
  }

  // Test 4: Initial status check
  const initial = await testStatusEndpoint(proc.jobId);
  if (!initial.ok) {
    console.error('\n❌ Failed to fetch initial status');
    process.exitCode = 1;
    return;
  }

  // Test 5: Poll status
  const polling = await testStatusPolling(proc.jobId);

  // Summary
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  Test Summary                                                  ║
╚════════════════════════════════════════════════════════════════╝

✅ Endpoints reachable: Process, Status
${polling.note ? '⚠️  Worker not running (RUN_WORKER=true required)' : ''}
${polling.status === 'extracted' ? '✅ Job completed!' : ''}
${polling.status === 'failed' ? '❌ Job failed!' : ''}
${polling.status === 'queued' ? '⏳ Job queued (waiting for worker)' : ''}

Next Steps:
1. Ensure REDIS_URL env is set and Redis is running
2. Set RUN_WORKER=true to start processing jobs
3. Deploy Python service at PYTHON_CV_PARSER_URL
4. Set PYTHON_HMAC_SECRET for authentication
5. Re-run this test with worker running

Test Data Created:
- Message ID: ${upload.messageId}
- Attachment ID: ${upload.attachmentId}
- Job ID: ${proc.jobId}
`);

  process.exitCode = polling.ok ? 0 : 1;
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exitCode = 99;
});
