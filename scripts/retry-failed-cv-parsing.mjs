import dotenv from 'dotenv';
dotenv.config();

// Retry cv-parsing for kind=cv attachments with failed parsing_jobs (Python 503 errors etc.)
// Skips 'extracted' ones (those correctly had insufficient signals or were processed already)

const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: K, Authorization: `Bearer ${K}` };

const { enqueueCvParsingJobForAttachment } = await import('../dist/services/inboxAttachmentService.js');

// Get all kind=cv, candidate_id=null attachments
const atts = await (await fetch(`${U}/rest/v1/inbox_attachments?parsing_status=eq.pending&candidate_id=is.null&attachment_kind=eq.cv&select=id,file_name`, { headers: h })).json();
console.log(`Total to check: ${atts.length}`);

let retried = 0, skipped = 0;
for (const att of atts) {
  // Check latest parsing job status
  const jobs = await (await fetch(`${U}/rest/v1/parsing_jobs?inbox_attachment_id=eq.${att.id}&select=id,status&order=created_at.desc&limit=1`, { headers: h })).json();
  const latest = jobs[0];

  if (!latest || latest.status === 'failed') {
    // No job or failed job — enqueue fresh
    try {
      await enqueueCvParsingJobForAttachment(att.id, { force: false });
      console.log(`Enqueued retry for: ${att.file_name}`);
      retried++;
    } catch(e) {
      console.error(`Error for ${att.id}:`, e.message);
    }
  } else {
    // extracted/processing/queued — skip
    skipped++;
  }
}

console.log(`\nDone. Retried: ${retried}, Skipped (already processed): ${skipped}`);
