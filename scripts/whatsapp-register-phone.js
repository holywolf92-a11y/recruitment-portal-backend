/*
  WhatsApp Cloud API: register/verify a business phone number.

  This script:
    1) Sets (or updates) the two-step verification PIN
    2) Requests an OTP via SMS/VOICE
    3) Verifies the OTP
    4) Prints the phone number status (aim: CONNECTED)

  Run using Railway env (recommended):
    cd recruitment-portal-backend
    railway run node scripts/whatsapp-register-phone.js

  Notes:
    - This prompts for PIN + code locally (not printed).
    - Phone number must NOT be actively used in WhatsApp Messenger/Business app.
*/

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';

async function getJson(url, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { ok: response.ok, status: response.status, json, text };
}

function printSection(title) {
  console.log('\n' + '='.repeat(80));
  console.log(title);
  console.log('='.repeat(80));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function promptLine(promptText) {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(promptText, resolve));
  rl.close();
  return String(answer || '').trim();
}

(async () => {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.log('MISSING_ENV', {
      hasToken: !!token,
      hasPhoneNumberId: !!phoneNumberId,
      graphVersion: GRAPH_VERSION,
    });
    process.exit(2);
  }

  printSection('Pre-check');
  console.log('PhoneNumberId:', phoneNumberId);
  console.log('Graph:', GRAPH_VERSION);
  console.log(
    'Important: If this number is currently active in WhatsApp/WhatsApp Business app, delete that WhatsApp account first, then retry.'
  );

  printSection('Step 1/4 — Set two-step verification PIN');
  const pin = await promptLine('Enter a NEW 6-digit PIN (two-step verification): ');
  if (!/^\d{6}$/.test(pin)) {
    console.log('PIN must be exactly 6 digits. Aborting.');
    process.exit(2);
  }

  let pinWasSet = false;
  let accountNotRegistered = false;

  const pinResult = await getJson(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pin }),
  });

  console.log('status:', pinResult.status);
  if (pinResult.ok) {
    pinWasSet = true;
    console.log(pinResult.json || { success: true });
  } else {
    const errCode = pinResult.json?.error?.code;
    if (errCode === 133010) {
      accountNotRegistered = true;
      console.log(
        'PIN set failed because Meta reports the phone account is not registered yet. Continuing with request_code/verify_code...'
      );
      console.log(pinResult.json || pinResult.text);
    } else {
      console.log(pinResult.json || pinResult.text);
      process.exit(1);
    }
  }

  printSection('Step 2/4 — Request verification code');
  let codeMethod = (await promptLine('Code method (SMS/VOICE) [SMS]: ')) || 'SMS';
  codeMethod = codeMethod.toUpperCase();
  if (!['SMS', 'VOICE'].includes(codeMethod)) {
    console.log('Invalid code method. Use SMS or VOICE. Aborting.');
    process.exit(2);
  }
  const language = (await promptLine('Language [en_US]: ')) || 'en_US';

  const requestCodeUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/request_code?code_method=${encodeURIComponent(
    codeMethod
  )}&language=${encodeURIComponent(language)}`;

  const requestResult = await getJson(requestCodeUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  console.log('status:', requestResult.status);
  if (!requestResult.ok) {
    const errCode = requestResult.json?.error?.code;
    // Common case: WhatsApp Manager shows PENDING but ownership is already verified.
    // In that case Meta returns 136024 and you should proceed to /register.
    if (errCode === 136024) {
      console.log(requestResult.json || requestResult.text);
      console.log('Phone number already verified. Skipping SMS verification step and proceeding to /register...');
    } else {
      console.log(requestResult.json || requestResult.text);
      process.exit(1);
    }
  } else {
    console.log(requestResult.json || { success: true });

    printSection('Step 3/4 — Verify code');
    const code = await promptLine('Enter the 6-digit code you received: ');
    if (!/^\d{6}$/.test(code)) {
      console.log('Code must be exactly 6 digits. Aborting.');
      process.exit(2);
    }

    const verifyUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/verify_code`;
    const form = new URLSearchParams({ code });

    const verifyResult = await getJson(verifyUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    console.log('status:', verifyResult.status);
    if (!verifyResult.ok) {
      console.log(verifyResult.json || verifyResult.text);
      process.exit(1);
    }
    console.log(verifyResult.json || { success: true });
  }

  // Some tenants require explicit registration after verification.
  printSection('Step 3b/4 — Attempt Cloud API register endpoint');
  const registerUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/register`;
  const registerResult = await getJson(registerUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  });
  console.log('status:', registerResult.status);
  console.log(registerResult.json || registerResult.text);

  if (!pinWasSet) {
    printSection('Step 3c/4 — Retry setting two-step PIN');
    const retryPinResult = await getJson(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pin }),
    });

    console.log('status:', retryPinResult.status);
    if (!retryPinResult.ok) {
      console.log(retryPinResult.json || retryPinResult.text);
    } else {
      console.log(retryPinResult.json || { success: true });
    }
  }

  printSection('Step 4/4 — Poll status (looking for CONNECTED)');
  for (let attempt = 1; attempt <= 10; attempt++) {
    const statusResult = await getJson(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}?fields=status,code_verification_status,account_mode,quality_rating,display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log(`attempt ${attempt}/10:`, statusResult.status);
    if (statusResult.json) console.log(JSON.stringify(statusResult.json, null, 2));
    else console.log(statusResult.text.slice(0, 2000));

    const status = statusResult.json?.status;
    if (status === 'CONNECTED') {
      console.log('DONE: status is CONNECTED. Inbound webhooks should start working.');
      return;
    }

    await sleep(3000);
  }

  console.log(
    'Still not CONNECTED. If WhatsApp Manager still says Pending, the number may still be active on WhatsApp app, or your WABA is managed by a partner and needs partner-side registration.'
  );
})().catch((err) => {
  console.error('FATAL', err?.message || err);
  process.exit(1);
});
