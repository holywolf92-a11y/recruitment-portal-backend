/*
  Prints Graph debug_token info (scopes + granular scopes) for the current WHATSAPP_ACCESS_TOKEN.

  Usage:
    cd recruitment-portal-backend
    railway run node scripts/meta-debug-token.js

  Env:
    WHATSAPP_ACCESS_TOKEN
    WHATSAPP_APP_SECRET
    WHATSAPP_APP_ID (optional)
*/

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';

async function main() {
  const inputToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const appId = process.env.WHATSAPP_APP_ID || '1609169707175401';

  if (!inputToken || !appSecret || !appId) {
    console.log('MISSING_ENV', {
      hasInputToken: !!inputToken,
      hasAppSecret: !!appSecret,
      hasAppId: !!appId,
    });
    process.exit(2);
  }

  const appAccessToken = `${appId}|${appSecret}`;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${encodeURIComponent(
    inputToken
  )}&access_token=${encodeURIComponent(appAccessToken)}`;

  const response = await fetch(url);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  console.log('status:', response.status);
  if (!json) {
    console.log(text.slice(0, 4000));
    process.exit(response.ok ? 0 : 1);
  }

  const data = json.data || {};
  // Print only non-sensitive parts
  const output = {
    app_id: data.app_id,
    type: data.type,
    is_valid: data.is_valid,
    scopes: data.scopes,
    granular_scopes: data.granular_scopes,
    expires_at: data.expires_at,
    issued_at: data.issued_at,
    user_id: data.user_id,
  };

  console.log(JSON.stringify(output, null, 2));
  if (!response.ok) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL', e?.message || e);
  process.exit(1);
});
