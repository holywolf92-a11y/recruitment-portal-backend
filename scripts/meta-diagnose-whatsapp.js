/*
  Meta/WhatsApp webhook diagnostics.
  Prints only non-secret metadata.

  Usage:
    cd recruitment-portal-backend
    railway run node scripts/meta-diagnose-whatsapp.js
*/

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v20.0';

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { status: response.status, json, text };
}

function printSection(title) {
  console.log('\n' + '='.repeat(80));
  console.log(title);
  console.log('='.repeat(80));
}

async function tryPhoneFields({ graphVersion, phoneNumberId, token, label, fields }) {
  printSection(label);
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=${encodeURIComponent(
    fields
  )}`;
  const result = await getJson(url, { Authorization: `Bearer ${token}` });
  console.log('status:', result.status);
  if (result.json) console.log(JSON.stringify(result.json, null, 2));
  else console.log(result.text.slice(0, 2000));
}

(async () => {
  const systemUserToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const appId = process.env.WHATSAPP_APP_ID || '1609169707175401';
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!systemUserToken || !appSecret || !phoneNumberId) {
    console.log('MISSING_ENV', {
      hasSystemUserToken: !!systemUserToken,
      hasAppSecret: !!appSecret,
      hasPhoneNumberId: !!phoneNumberId,
      hasAppId: !!appId,
    });
    process.exit(2);
  }

  // App access token form: app_id|app_secret
  const appAccessToken = `${appId}|${appSecret}`;

  printSection('1) App Subscriptions (Webhook callback URL + fields)');
  const subs = await getJson(
    `https://graph.facebook.com/${GRAPH_VERSION}/${appId}/subscriptions`,
    { Authorization: `Bearer ${appAccessToken}` }
  );
  console.log('status:', subs.status);
  if (subs.json) {
    // Should contain: data: [{ object, callback_url, fields, active, verify_token? }]
    console.log(JSON.stringify(subs.json, null, 2));
  } else {
    console.log(subs.text.slice(0, 2000));
  }

  printSection('2) Phone Number Status');
  const phone = await getJson(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name,account_mode,status,code_verification_status`,
    { Authorization: `Bearer ${systemUserToken}` }
  );
  console.log('status:', phone.status);
  if (phone.json) console.log(JSON.stringify(phone.json, null, 2));
  else console.log(phone.text.slice(0, 2000));

  await tryPhoneFields({
    graphVersion: GRAPH_VERSION,
    phoneNumberId,
    token: systemUserToken,
    label: '2a) Phone readiness fields (attempt)',
    fields:
      'id,display_phone_number,verified_name,account_mode,status,code_verification_status,quality_rating,messaging_limit_tier,platform_type,name_status,new_name_status',
  });

  // Try to discover the WABA/business linkage from the phone-number object.
  // Field availability varies by Graph version and permissions.
  await tryPhoneFields({
    graphVersion: GRAPH_VERSION,
    phoneNumberId,
    token: systemUserToken,
    label: '2b) Phone -> whatsapp_business_account (attempt)',
    fields: 'whatsapp_business_account',
  });
  await tryPhoneFields({
    graphVersion: GRAPH_VERSION,
    phoneNumberId,
    token: systemUserToken,
    label: '2c) Phone -> whatsapp_business_account{id,name} (attempt)',
    fields: 'whatsapp_business_account{id,name}',
  });
  await tryPhoneFields({
    graphVersion: GRAPH_VERSION,
    phoneNumberId,
    token: systemUserToken,
    label: '2d) Phone -> id,account_id (attempt)',
    fields: 'id,account_id',
  });
  await tryPhoneFields({
    graphVersion: GRAPH_VERSION,
    phoneNumberId,
    token: systemUserToken,
    label: '2e) Phone -> owner_business,business (attempt)',
    fields: 'id,owner_business,business',
  });

  printSection('3) Businesses for token (discover WABA)');
  const businesses = await getJson(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/businesses?limit=50`,
    { Authorization: `Bearer ${systemUserToken}` }
  );
  console.log('status:', businesses.status);
  if (!businesses.json) {
    console.log(businesses.text.slice(0, 2000));
    return;
  }
  console.log(JSON.stringify(businesses.json, null, 2));

  const businessIds = (businesses.json.data || []).map((b) => b.id).filter(Boolean);
  if (businessIds.length === 0) {
    console.log('No businesses returned for this token.');
    return;
  }

  for (const businessId of businessIds.slice(0, 5)) {
    printSection(`4) Owned WABAs for business ${businessId}`);
    const wabas = await getJson(
      `https://graph.facebook.com/${GRAPH_VERSION}/${businessId}/owned_whatsapp_business_accounts?fields=id,name&limit=50`,
      { Authorization: `Bearer ${systemUserToken}` }
    );
    console.log('status:', wabas.status);
    if (!wabas.json) {
      console.log(wabas.text.slice(0, 2000));
      continue;
    }
    console.log(JSON.stringify(wabas.json, null, 2));

    const wabaIds = (wabas.json.data || []).map((w) => w.id).filter(Boolean);
    for (const wabaId of wabaIds.slice(0, 5)) {
      printSection(`5) Subscribed apps for WABA ${wabaId}`);
      const subscribed = await getJson(
        `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`,
        { Authorization: `Bearer ${systemUserToken}` }
      );
      console.log('status:', subscribed.status);
      if (subscribed.json) console.log(JSON.stringify(subscribed.json, null, 2));
      else console.log(subscribed.text.slice(0, 2000));

      printSection(`6) Phone numbers on WABA ${wabaId}`);
      const phoneNums = await getJson(
        `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,status,account_mode&limit=50`,
        { Authorization: `Bearer ${systemUserToken}` }
      );
      console.log('status:', phoneNums.status);
      if (phoneNums.json) console.log(JSON.stringify(phoneNums.json, null, 2));
      else console.log(phoneNums.text.slice(0, 2000));
    }
  }
})().catch((err) => {
  console.error('FATAL', err?.message || err);
  process.exit(1);
});
