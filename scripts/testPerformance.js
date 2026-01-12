// Performance testing for inbox ingestion at scale
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
  return { status: res.status, json };
}

async function testInboxCreationThroughput() {
  console.log('\n=== Test: Inbox Message Creation Throughput ===');
  const messageCount = 100;
  const startTime = Date.now();
  const latencies = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < messageCount; i++) {
    const reqStart = Date.now();
    const payload = {
      source: 'test-load',
      external_message_id: `perf_msg_${Date.now()}_${i}`,
      payload: { text: `Performance test message ${i}` },
      status: 'pending',
    };

    try {
      const res = await request('POST', '/cv-inbox', payload);
      const latency = Date.now() - reqStart;
      latencies.push(latency);

      if (res.status === 201) {
        successCount++;
      } else {
        errorCount++;
      }
    } catch (err) {
      errorCount++;
    }
  }

  const totalTime = Date.now() - startTime;
  const throughput = (successCount / (totalTime / 1000)).toFixed(2);
  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
  const maxLatency = Math.max(...latencies);
  const minLatency = Math.min(...latencies);

  console.log(`Messages created: ${successCount}/${messageCount}`);
  console.log(`Total time: ${totalTime}ms`);
  console.log(`Throughput: ${throughput} msg/sec`);
  console.log(`Average latency: ${avgLatency}ms`);
  console.log(`Min/Max latency: ${minLatency}ms / ${maxLatency}ms`);
  console.log(`Errors: ${errorCount}`);

  return successCount === messageCount && errorCount === 0;
}

async function testAttachmentDedupPerformance() {
  console.log('\n=== Test: Attachment Deduplication Performance ===');

  // First create an inbox message
  const msgPayload = {
    source: 'test-dedup',
    external_message_id: `perf_dedup_${Date.now()}`,
    payload: { text: 'Dedup test' },
  };

  const msgRes = await request('POST', '/cv-inbox', msgPayload);
  if (msgRes.status !== 201) {
    console.log('Failed to create inbox message');
    return false;
  }

  const messageId = msgRes.json.id;
  const fileBuffer = Buffer.from('Test CV content ' + Date.now());
  const base64 = fileBuffer.toString('base64');

  // First attachment (should succeed)
  const startTime = Date.now();
  const attachRes1 = await request('POST', `/cv-inbox/${messageId}/attachments`, {
    file_name: 'resume.pdf',
    mime_type: 'application/pdf',
    storage_bucket: 'inbox',
    storage_path: 'test/resume.pdf',
    attachment_type: 'cv',
    file_base64: base64,
  });
  const time1 = Date.now() - startTime;

  console.log(`First attachment: ${attachRes1.status} (${time1}ms)`);

  // Duplicate attachment (should fail with 409)
  const dupStart = Date.now();
  const attachRes2 = await request('POST', `/cv-inbox/${messageId}/attachments`, {
    file_name: 'resume.pdf',
    mime_type: 'application/pdf',
    storage_bucket: 'inbox',
    storage_path: 'test/resume.pdf',
    attachment_type: 'cv',
    file_base64: base64,
  });
  const time2 = Date.now() - dupStart;

  console.log(`Duplicate attachment: ${attachRes2.status} (${time2}ms)`);
  console.log(`Expected: 201, then 409 (duplicate)`);

  const pass = attachRes1.status === 201 && attachRes2.status === 409;
  console.log(`Result: ${pass ? '✓ PASS' : '✗ FAIL'}`);

  return pass;
}

async function testListingPerformance() {
  console.log('\n=== Test: Inbox Listing Performance (pagination) ===');

  // Create 50 messages
  console.log('Creating 50 test messages...');
  for (let i = 0; i < 50; i++) {
    await request('POST', '/cv-inbox', {
      source: 'test-list',
      external_message_id: `perf_list_${Date.now()}_${i}`,
      payload: { text: `List test ${i}` },
    });
  }

  // Test pagination
  const tests = [
    { limit: 10, offset: 0 },
    { limit: 20, offset: 0 },
    { limit: 10, offset: 20 },
    { limit: 50, offset: 0 },
  ];

  const latencies = [];
  for (const test of tests) {
    const startTime = Date.now();
    const res = await request('GET', `/cv-inbox?limit=${test.limit}&offset=${test.offset}`, null);
    const latency = Date.now() - startTime;
    latencies.push(latency);

    console.log(
      `List (limit=${test.limit}, offset=${test.offset}): ${res.status} in ${latency}ms, returned ${res.json?.messages?.length || 0} items`
    );
  }

  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
  console.log(`Average latency: ${avgLatency}ms`);

  return true;
}

async function testConcurrentRequests() {
  console.log('\n=== Test: Concurrent Request Handling ===');

  const concurrency = 20;
  const requestsPerClient = 5;
  const startTime = Date.now();
  const latencies = [];
  let successCount = 0;

  const promises = [];
  for (let client = 0; client < concurrency; client++) {
    for (let req = 0; req < requestsPerClient; req++) {
      promises.push(
        (async () => {
          const reqStart = Date.now();
          const payload = {
            source: 'test-concurrent',
            external_message_id: `perf_concurrent_${client}_${req}_${Date.now()}`,
            payload: { text: `Concurrent test ${client}-${req}` },
          };

          try {
            const res = await request('POST', '/cv-inbox', payload);
            const latency = Date.now() - reqStart;
            latencies.push(latency);
            if (res.status === 201) successCount++;
          } catch (err) {
            // silent
          }
        })()
      );
    }
  }

  await Promise.all(promises);

  const totalTime = Date.now() - startTime;
  const totalRequests = concurrency * requestsPerClient;
  const throughput = (totalRequests / (totalTime / 1000)).toFixed(2);
  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
  const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

  console.log(`Clients: ${concurrency}`);
  console.log(`Total requests: ${totalRequests}`);
  console.log(`Total time: ${totalTime}ms`);
  console.log(`Throughput: ${throughput} req/sec`);
  console.log(`Average latency: ${avgLatency}ms`);
  console.log(`P95 latency: ${p95Latency}ms`);
  console.log(`Success: ${successCount}/${totalRequests}`);

  return successCount === totalRequests;
}

async function testUpdatePerformance() {
  console.log('\n=== Test: Message Status Update Performance ===');

  // Create message
  const msgRes = await request('POST', '/cv-inbox', {
    source: 'test-update',
    external_message_id: `perf_update_${Date.now()}`,
    payload: { text: 'Update test' },
  });

  const messageId = msgRes.json.id;
  const statuses = ['processed', 'failed', 'pending'];
  const latencies = [];

  for (const status of statuses) {
    const startTime = Date.now();
    const res = await request('PATCH', `/cv-inbox/${messageId}`, { status });
    const latency = Date.now() - startTime;
    latencies.push(latency);

    console.log(`Update to "${status}": ${res.status} in ${latency}ms`);
  }

  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
  console.log(`Average latency: ${avgLatency}ms`);

  return true;
}

async function run() {
  console.log('Base URL:', BASE_URL);
  console.log('Starting performance tests...');
  console.log('Note: These tests create real data. May take a minute...\n');

  const results = [];
  results.push(['Inbox Creation Throughput', await testInboxCreationThroughput()]);
  results.push(['Attachment Deduplication', await testAttachmentDedupPerformance()]);
  results.push(['Listing Performance', await testListingPerformance()]);
  results.push(['Status Update Performance', await testUpdatePerformance()]);
  results.push(['Concurrent Request Handling', await testConcurrentRequests()]);

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
