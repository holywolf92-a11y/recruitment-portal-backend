/* eslint-disable no-console */
require('dotenv').config();

const API = process.env.API_BASE_URL || 'http://localhost:4100';
const ATTACHMENT_ID = process.env.ATTACHMENT_ID; // required

if (!ATTACHMENT_ID) {
  console.error('Missing ATTACHMENT_ID env var');
  process.exit(1);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('API:', API);
  console.log('ATTACHMENT_ID:', ATTACHMENT_ID);

  // 1) trigger parsing
  const triggerRes = await fetch(`${API}/api/cv-inbox/attachments/${ATTACHMENT_ID}/process`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });

  const triggerBody = await triggerRes.json().catch(() => ({}));
  if (!triggerRes.ok) {
    console.error('Trigger failed:', triggerRes.status, triggerBody);
    process.exit(1);
  }

  const jobId = triggerBody.job_id;
  console.log('Triggered job:', jobId, 'status:', triggerBody.status);

  // 2) poll status
  const started = Date.now();
  while (true) {
    const stRes = await fetch(`${API}/api/parsing-jobs/${jobId}`);
    const st = await stRes.json().catch(() => ({}));

    if (!stRes.ok) {
      console.error('Status fetch failed:', stRes.status, st);
      process.exit(1);
    }

    console.log(
      `[${Math.floor((Date.now() - started) / 1000)}s]`,
      'status:',
      st.status,
      'attempts:',
      st.attempts,
      st.error_message ? `err="${st.error_message}"` : ''
    );

    if (st.status === 'extracted') {
      console.log('✅ DONE. schema_version:', st.schema_version);
      console.log('Result keys:', st.result ? Object.keys(st.result) : []);
      process.exit(0);
    }

    if (st.status === 'failed') {
      console.log('❌ FAILED:', st.error_message);
      process.exit(2);
    }

    // timeout after 2 mins
    if (Date.now() - started > 120000) {
      console.log('⏳ TIMEOUT waiting for completion');
      process.exit(3);
    }

    await sleep(2000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
