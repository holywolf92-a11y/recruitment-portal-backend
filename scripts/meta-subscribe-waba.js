/*
  Subscribes the current Meta app to a WABA so webhooks are delivered.

  Usage:
    cd recruitment-portal-backend
    railway run node scripts/meta-subscribe-waba.js 2327099184462303

  Env:
    WHATSAPP_ACCESS_TOKEN
    WHATSAPP_APP_ID (optional)
    WHATSAPP_GRAPH_VERSION (optional)

  Notes:
    - Requires token with whatsapp_business_manage_events.
    - This does NOT set callback URL/verify token; it only links the app to the WABA.
*/

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';

async function postJson(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { ok: res.ok, status: res.status, json, text };
}

(async () => {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const appId = process.env.WHATSAPP_APP_ID || '1609169707175401';
  const wabaId = process.argv[2];

  if (!token) {
    console.log('MISSING_ENV: WHATSAPP_ACCESS_TOKEN');
    process.exit(2);
  }
  if (!wabaId) {
    console.log('Usage: node scripts/meta-subscribe-waba.js <WABA_ID>');
    process.exit(2);
  }

  // Many Graph endpoints accept subscribed_fields as a query param. We'll send both for compatibility.
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps?subscribed_fields=${encodeURIComponent(
    'messages'
  )}`;

  const result = await postJson(url, token, {
    subscribed_fields: ['messages'],
  });

  console.log('status:', result.status);
  console.log(result.json || result.text);

  if (!result.ok) process.exit(1);

  console.log('Subscribed appId:', appId, 'to WABA:', wabaId);
})().catch((e) => {
  console.error('FATAL', e?.message || e);
  process.exit(1);
});
