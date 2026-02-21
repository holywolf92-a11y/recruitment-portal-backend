/*
  Sends a simple WhatsApp text message using Cloud API.

  Usage:
    cd recruitment-portal-backend
    railway run node scripts/whatsapp-send-test.js "+923135678933" "test message"

  Uses env vars:
    WHATSAPP_ACCESS_TOKEN
    WHATSAPP_PHONE_NUMBER_ID
    WHATSAPP_GRAPH_VERSION (optional, default v25.0)
*/

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';

async function main() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const to = process.argv[2];
  const body = process.argv[3] || 'Test message';

  if (!token || !phoneNumberId) {
    console.log('MISSING_ENV', {
      hasToken: !!token,
      hasPhoneNumberId: !!phoneNumberId,
    });
    process.exit(2);
  }

  if (!to) {
    console.log('Usage: node scripts/whatsapp-send-test.js "+<countrycode><number>" "message"');
    process.exit(2);
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  console.log('status:', response.status);
  console.log(json || text);
  if (!response.ok) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL', e?.message || e);
  process.exit(1);
});
