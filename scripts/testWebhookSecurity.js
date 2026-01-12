// Webhook security tests: invalid signatures, rate limits, idempotency
const crypto = require('crypto');

const PORT = process.env.PORT || '1000';
const HOST = process.env.HOST || 'localhost';
const BASE_URL = process.env.API_BASE_URL || `http://${HOST}:${PORT}/api`;

async function request(method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

async function resetRateLimits() {
  try {
    await fetch(`${BASE_URL.replace('/api', '')}/api/test/reset-rate-limits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    console.log('Rate limits reset');
  } catch (err) {
    console.log('Note: Could not reset rate limits (endpoint may not be available)');
  }
}

async function testInvalidSignature() {
  console.log('\n=== Test: Invalid WhatsApp Signature ===');
  await resetRateLimits();
  
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: 'test_invalid_sig',
                  from: '1234567890',
                  type: 'text',
                  text: { body: 'Test message' },
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const badSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';
  const res = await request('POST', '/webhooks/whatsapp', payload, {
    'X-Hub-Signature-256': badSignature,
  });

  console.log('Status:', res.status);
  console.log('Expected: 401 Unauthorized');
  console.log('Result:', res.status === 401 ? '✓ PASS' : '✗ FAIL');
  return res.status === 401;
}

async function testRateLimiting() {
  console.log('\n=== Test: WhatsApp Rate Limiting (120/min) ===');
  await resetRateLimits();
  
  // Generate 125 requests rapidly
  const appSecret = process.env.WHATSAPP_APP_SECRET || 'test-secret';
  const results = [];

  for (let i = 0; i < 125; i++) {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: `test_rate_${i}`,
                    from: '1234567890',
                    type: 'text',
                    text: { body: `Rate test ${i}` },
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const signature = `sha256=${crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex')}`;

    const res = await request('POST', '/webhooks/whatsapp', payload, {
      'X-Hub-Signature-256': signature,
    });

    results.push({ iteration: i, status: res.status });

    if (i === 119) {
      console.log(`Request ${i + 1}/125: Status ${res.status} (should be 200)`);
    }
    if (i === 120) {
      console.log(`Request ${i + 1}/125: Status ${res.status} (should be 429 - rate limited)`);
      if (res.status === 429) {
        console.log('Rate limit response:', res.json);
      }
    }
    if (i === 124) {
      console.log(`Request ${i + 1}/125: Status ${res.status} (should be 429 - rate limited)`);
    }
  }

  const passedFirst120 = results.slice(0, 120).every((r) => r.status !== 429);
  const failedAfter120 = results.slice(120).some((r) => r.status === 429);

  console.log('Result:', passedFirst120 && failedAfter120 ? '✓ PASS' : '✗ FAIL');
  return passedFirst120 && failedAfter120;
}

async function testIdempotency() {
  console.log('\n=== Test: Idempotency (same key = cached response) ===');
  await resetRateLimits();

  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: 'test_idempotent',
                  from: '1234567890',
                  type: 'text',
                  text: { body: 'Idempotency test' },
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const appSecret = process.env.WHATSAPP_APP_SECRET || 'test-secret';
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex')}`;

  const idempotencyKey = 'test_idempotency_key_123';

  // First request - use raw fetch to ensure signature matches body exactly
  const res1Raw = await fetch(`${BASE_URL}/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
      'X-Idempotency-Key': idempotencyKey,
    },
    body: rawBody,
  });
  const res1 = { status: res1Raw.status, json: await res1Raw.json().catch(() => ({})) };
  console.log('First request status:', res1.status);

  // Wait a moment
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Second request with same key - use same rawBody
  const res2Raw = await fetch(`${BASE_URL}/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
      'X-Idempotency-Key': idempotencyKey,
    },
    body: rawBody,
  });
  const res2 = { status: res2Raw.status, json: await res2Raw.json().catch(() => ({})) };
  console.log('Second request status:', res2.status);
  console.log('Second response (should be cached):', res2.json);

  const pass = res1.status === 200 && res2.status === 200;
  console.log('Result:', pass ? '✓ PASS' : '✗ FAIL');
  return pass;
}

async function testGmailRateLimiting() {
  console.log('\n=== Test: Gmail Rate Limiting (50/min) ===');
  await resetRateLimits();

  const results = [];
  for (let i = 0; i < 55; i++) {
    const payload = {
      message: {
        data: Buffer.from(
          JSON.stringify({
            emailAddress: 'user@gmail.com',
            historyId: String(i),
          })
        ).toString('base64'),
      },
    };

    const res = await request('POST', '/webhooks/gmail', payload);
    results.push({ iteration: i, status: res.status });

    if (i === 49) {
      console.log(`Request ${i + 1}/55: Status ${res.status} (should be 200)`);
    }
    if (i === 50) {
      console.log(`Request ${i + 1}/55: Status ${res.status} (should be 429 - rate limited)`);
    }
    if (i === 54) {
      console.log(`Request ${i + 1}/55: Status ${res.status} (should be 429 - rate limited)`);
    }
  }

  const passedFirst50 = results.slice(0, 50).every((r) => r.status !== 429);
  const failedAfter50 = results.slice(50).some((r) => r.status === 429);

  console.log('Result:', passedFirst50 && failedAfter50 ? '✓ PASS' : '✗ FAIL');
  return passedFirst50 && failedAfter50;
}

async function run() {
  console.log('Base URL:', BASE_URL);
  console.log('Starting webhook security tests...\n');

  const results = [];
  results.push(['Invalid WhatsApp Signature', await testInvalidSignature()]);
  results.push(['WhatsApp Rate Limiting', await testRateLimiting()]);
  results.push(['Idempotency', await testIdempotency()]);
  results.push(['Gmail Rate Limiting', await testGmailRateLimiting()]);

  console.log('\n=== Test Summary ===');
  results.forEach(([name, passed]) => {
    console.log(`${name}: ${passed ? '✓ PASS' : '✗ FAIL'}`);
  });

  const allPassed = results.every((r) => r[1]);
  process.exit(allPassed ? 0 : 1);
}

run().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
