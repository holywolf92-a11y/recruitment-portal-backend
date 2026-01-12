// Simple smoke tests for inbox API endpoints. Run with backend server up: npm run start (port 1000 default)
const PORT = process.env.PORT || '1000';
const HOST = process.env.HOST || 'localhost';
const BASE_URL = process.env.API_BASE_URL || `http://${HOST}:${PORT}/api`;

async function request(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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

async function run() {
  console.log('Base URL:', BASE_URL);

  // 1) Create inbox message
  const createPayload = {
    source: 'whatsapp',
    external_message_id: `test-${Date.now()}`,
    payload: { text: 'Hello inbox smoke test' },
    status: 'pending',
  };
  const created = await request('POST', '/cv-inbox', createPayload);
  console.log('\nCreate message', created.status, created.json);
  if (created.status >= 300) throw new Error('Create failed');
  const messageId = created.json.id;

  // 2) List inbox messages
  const list = await request('GET', '/cv-inbox?limit=5&offset=0', undefined);
  console.log('\nList messages', list.status, Array.isArray(list.json?.messages) ? list.json.messages.length : list.json);

  // 3) Get by id
  const fetched = await request('GET', `/cv-inbox/${messageId}`, undefined);
  console.log('\nGet by id', fetched.status, fetched.json);

  // 4) Update status
  const updated = await request('PATCH', `/cv-inbox/${messageId}`, { status: 'processed' });
  console.log('\nUpdate status', updated.status, updated.json);

  // 5) Delete
  const deleted = await request('DELETE', `/cv-inbox/${messageId}`, undefined);
  console.log('\nDelete', deleted.status, deleted.json);

  // 6) Verify delete
  const checkDeleted = await request('GET', `/cv-inbox/${messageId}`, undefined);
  console.log('\nGet after delete (should 404)', checkDeleted.status, checkDeleted.json);
}

run().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
