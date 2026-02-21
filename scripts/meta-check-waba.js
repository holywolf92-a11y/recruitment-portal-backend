/*
  Checks a WABA (WhatsApp Business Account) for:
    - basic info
    - phone numbers linked
    - whether it's subscribed to the app (webhooks)

  Usage:
    cd recruitment-portal-backend
    railway run node scripts/meta-check-waba.js 2327099184462303

  Env:
    WHATSAPP_ACCESS_TOKEN
    WHATSAPP_APP_ID (optional)
    WHATSAPP_GRAPH_VERSION (optional)
*/

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';

async function getJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { ok: res.ok, status: res.status, json, text };
}

function section(title) {
  console.log('\n' + '='.repeat(80));
  console.log(title);
  console.log('='.repeat(80));
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
    console.log('Usage: node scripts/meta-check-waba.js <WABA_ID>');
    process.exit(2);
  }

  section('1) WABA basic info');
  const waba = await getJson(
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}?fields=id,name,account_review_status,ownership_type,business_verification_status`,
    token
  );
  console.log('status:', waba.status);
  console.log(waba.json || waba.text);

  section('2) WABA phone numbers');
  const phones = await getJson(
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,status,account_mode,code_verification_status,quality_rating&limit=50`,
    token
  );
  console.log('status:', phones.status);
  console.log(phones.json || phones.text);

  section('3) WABA subscribed apps');
  const subs = await getJson(`https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`, token);
  console.log('status:', subs.status);
  if (subs.json) console.log(JSON.stringify(subs.json, null, 2));
  else console.log(subs.text);

  // Helper: detect app id in response. Format can vary; commonly it's nested.
  const entries = subs.json?.data || [];
  const seenAppIds = Array.from(
    new Set(
      entries
        .flatMap((x) => {
          const direct = x?.id ?? x?.app_id;
          const nested = x?.whatsapp_business_api_data?.id ?? x?.whatsapp_business_api_data?.app_id;

          const link = x?.whatsapp_business_api_data?.link;
          const linkMatch = typeof link === 'string' ? link.match(/[?&]app_id=(\d+)/) : null;
          const fromLink = linkMatch?.[1];

          return [direct, nested, fromLink].filter(Boolean);
        })
        .map((v) => String(v))
    )
  );
  console.log('\nSubscribed app ids found:', seenAppIds.length ? seenAppIds.join(', ') : '(none)');
  console.log('App subscribed to this WABA?', seenAppIds.includes(String(appId)), '(appId:', String(appId) + ')');
})().catch((e) => {
  console.error('FATAL', e?.message || e);
  process.exit(1);
});
