/*
  Backfill: copy linked_candidate_id → candidate_id on inbox_attachments.

  The whatsappAttachmentVerificationWorker was writing linked_candidate_id but not
  candidate_id. The CV Inbox UI only checks candidate_id to decide "extracted" vs
  "queued". This script one-shot fixes all rows where linked_candidate_id is set
  but candidate_id is not, resolving the "stuck in Queued" appearance.

  Usage:
    cd recruitment-portal-backend
    node -r dotenv/config scripts/backfill-inbox-attachment-candidate-id.js

  Safe to run multiple times (idempotent).
*/

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log('=== Backfill: inbox_attachments.candidate_id from linked_candidate_id ===\n');

  // 1) Fetch all rows where linked_candidate_id is set but candidate_id is not.
  const { data: rows, error: fetchErr } = await supabase
    .from('inbox_attachments')
    .select('id, file_name, mime_type, linked_candidate_id, candidate_id, created_at')
    .not('linked_candidate_id', 'is', null)
    .is('candidate_id', null)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (fetchErr) {
    console.error('ERROR fetching rows:', fetchErr.message);
    process.exit(1);
  }

  const toFix = (rows || []).filter(r => r.linked_candidate_id && !r.candidate_id);

  console.log(`Found ${toFix.length} attachment(s) to backfill.\n`);

  if (toFix.length === 0) {
    console.log('Nothing to do. All attachments with linked_candidate_id already have candidate_id set.');
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (const row of toFix) {
    const { error: updateErr } = await supabase
      .from('inbox_attachments')
      .update({ candidate_id: row.linked_candidate_id })
      .eq('id', row.id)
      .is('candidate_id', null); // guard: only update if still null (idempotent)

    if (updateErr) {
      console.error(`  ERROR updating ${row.id}: ${updateErr.message}`);
      errorCount += 1;
    } else {
      console.log(`  ✓ ${row.id}  (${row.file_name || 'unnamed'}) → candidate ${row.linked_candidate_id}`);
      successCount += 1;
    }
  }

  console.log(`\n=== Done: ${successCount} updated, ${errorCount} failed ===`);

  if (errorCount === 0) {
    console.log('\n✅ All stuck WhatsApp CV attachments in CV Inbox will now show as "Extracted".');
    console.log('   Refresh the CV Inbox page to confirm.');
  }
}

main().catch(err => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});
