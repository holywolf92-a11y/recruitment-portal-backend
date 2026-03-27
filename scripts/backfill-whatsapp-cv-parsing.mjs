/**
 * Backfill cv-parsing jobs for stuck WhatsApp attachments.
 *
 * These are attachments that went through whatsappAttachmentVerificationWorker
 * (so they have candidate_id set) but cv-parsing was never enqueued because
 * the old worker only enqueued document-verification.
 *
 * Run: node --experimental-vm-modules scripts/backfill-whatsapp-cv-parsing.mjs [--dry-run] [--batch-size=50] [--delay=2000]
 */

import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchSize = parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '30', 10);
const delayMs = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '3000', 10);

const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!U || !K) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const headers = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

const { enqueueCvParsingJobForAttachment } = await import('../dist/services/inboxAttachmentService.js');

async function fetchPage(offset, limit) {
  const url = `${U}/rest/v1/inbox_attachments?parsing_status=eq.pending&candidate_id=not.is.null&attachment_kind=in.(cv,unknown)&select=id,attachment_kind,candidate_id,file_name&offset=${offset}&limit=${limit}&order=id.asc`;
  const r = await fetch(url, { headers: { ...headers, Prefer: 'count=exact' } });
  const data = await r.json();
  const total = parseInt(r.headers.get('content-range')?.split('/')[1] || '0', 10);
  return { data, total };
}

async function updateAttachmentKindToCv(ids) {
  const url = `${U}/rest/v1/inbox_attachments?id=in.(${ids.join(',')})`;
  await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ attachment_kind: 'cv' }) });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log(`=== WhatsApp CV-Parsing Backfill ===`);
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | batch=${batchSize} | delay=${delayMs}ms`);

const { data: firstPage, total } = await fetchPage(0, 1);
console.log(`Total attachments to backfill: ${total}`);

if (total === 0) {
  console.log('Nothing to do!');
  process.exit(0);
}

let enqueued = 0;
let skipped = 0;
let errors = 0;
let offset = 0;

while (offset < total) {
  const { data: batch } = await fetchPage(offset, batchSize);
  if (!batch || batch.length === 0) break;

  console.log(`\nBatch ${Math.floor(offset / batchSize) + 1}: processing ${batch.length} attachments (${offset + 1}-${offset + batch.length} of ${total})`);

  // Collect unknown-kind IDs to update in bulk
  const unknownIds = batch.filter(a => a.attachment_kind === 'unknown').map(a => a.id);

  if (!dryRun && unknownIds.length > 0) {
    await updateAttachmentKindToCv(unknownIds);
    console.log(`  Updated ${unknownIds.length} attachment_kind unknown→cv`);
  }

  for (const att of batch) {
    try {
      if (dryRun) {
        console.log(`  [DRY] Would enqueue: ${att.id} (${att.file_name}) candidate=${att.candidate_id}`);
        enqueued++;
        continue;
      }

      const result = await enqueueCvParsingJobForAttachment(att.id, { force: true });
      if (result?.status === 'queued' || result?.status === 'deduplicated') {
        enqueued++;
        if (enqueued % 10 === 0) {
          console.log(`  ${enqueued} enqueued so far...`);
        }
      } else {
        console.warn(`  Unexpected status for ${att.id}:`, result);
        skipped++;
      }
    } catch (err) {
      console.error(`  ERROR for ${att.id}:`, err.message);
      errors++;
    }
  }

  offset += batchSize;

  if (offset < total) {
    console.log(`  Sleeping ${delayMs}ms before next batch...`);
    await sleep(delayMs);
  }
}

console.log(`\n=== Backfill Complete ===`);
console.log(`Enqueued: ${enqueued}`);
console.log(`Skipped:  ${skipped}`);
console.log(`Errors:   ${errors}`);
console.log(`Total:    ${enqueued + skipped + errors} / ${total}`);
process.exit(0);
