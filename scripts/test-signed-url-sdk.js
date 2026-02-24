require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ATTACHMENT_IDS = [
  '7dd17cc1-36b3-43ea-9e6e-b1b52476534a', // Sami-ur-rehman.pdf
  '4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd', // CV(1).pdf
  '35222a1a-5563-46d0-a66c-13859c2124b8', // Resume-Ali Ahmed.pdf
  '1c9b87ea-ad51-40ac-87e4-dd0365b0a47e', // Aleeza Tariq.pdf
];

async function main() {
  const { data: atts } = await sb
    .from('inbox_attachments')
    .select('id, file_name, storage_bucket, storage_path')
    .in('id', ATTACHMENT_IDS);

  for (const att of atts) {
    console.log(`\nTesting: ${att.file_name}`);
    console.log(`  storage: ${att.storage_bucket}/${att.storage_path}`);

    // Create signed URL using the SDK (same as cvParserWorker does)
    const { data: signed, error: signedErr } = await sb.storage
      .from(att.storage_bucket || 'documents')
      .createSignedUrl(att.storage_path, 3600);

    if (signedErr || !signed?.signedUrl) {
      console.log(`  -> SIGN FAILED: ${signedErr?.message}`);
      continue;
    }

    console.log(`  -> signedUrl: ${signed.signedUrl.substring(0, 80)}...`);

    // Test if the URL is actually fetchable
    try {
      const res = await fetch(signed.signedUrl, { method: 'HEAD' });
      if (res.ok) {
        console.log(`  -> FILE ACCESSIBLE ✅ (${res.headers.get('content-length')} bytes)`);
      } else {
        console.log(`  -> FILE NOT ACCESSIBLE ❌ ${res.status} ${res.statusText}`);
        // Try GET
        const res2 = await fetch(signed.signedUrl);
        const text = await res2.text();
        console.log(`  -> GET response: ${text.substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`  -> FETCH ERROR: ${e.message}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
