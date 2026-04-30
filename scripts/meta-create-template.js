/*
  Creates a WhatsApp message template on a WABA.

  Usage:
    cd recruitment-portal-backend
    railway run node scripts/meta-create-template.js <WABA_ID>

  Env:
    WHATSAPP_ACCESS_TOKEN
    WHATSAPP_GRAPH_VERSION (optional)

  The template is intentionally simple and avoids password/login wording.
*/

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';

const TEMPLATE_NAME = 'requested_link_notice';
const TEMPLATE_LANGUAGE = 'en_US';

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
    // ignore parse failure
  }

  return { ok: res.ok, status: res.status, json, text };
}

(async () => {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.argv[2];

  if (!token) {
    console.log('MISSING_ENV: WHATSAPP_ACCESS_TOKEN');
    process.exit(2);
  }

  if (!wabaId) {
    console.log('Usage: node scripts/meta-create-template.js <WABA_ID>');
    process.exit(2);
  }

  const payload = {
    name: TEMPLATE_NAME,
    category: 'UTILITY',
    language: TEMPLATE_LANGUAGE,
    parameter_format: 'POSITIONAL',
    components: [
      {
        type: 'BODY',
        text: 'Falisha Jobs: Here is the link you requested: {{1}}. Open it when ready.',
        example: {
          body_text: [['https://falishajobs.up.railway.app/example-link']],
        },
      },
    ],
    allow_category_change: true,
  };

  const result = await postJson(
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`,
    token,
    payload,
  );

  console.log('status:', result.status);
  if (result.json) {
    console.log(JSON.stringify(result.json, null, 2));
  } else {
    console.log(result.text);
  }

  if (!result.ok) {
    process.exit(1);
  }
})().catch((error) => {
  console.error('FATAL', error?.message || error);
  process.exit(1);
});