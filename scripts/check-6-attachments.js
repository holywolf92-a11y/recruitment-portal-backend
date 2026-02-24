require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ATTACHMENT_IDS = [
  'd1b4c77d-7872-434b-98b6-8e958bcc9073', // MUHAMMAD UMAIR ISHTIAQ.pdf
  '1c9b87ea-ad51-40ac-87e4-dd0365b0a47e', // Aleeza Tariq(Chemistry Lecturer).pdf
  '3fe82029-7adc-4c60-8c0c-285b049a1a56', // Attaullahcv2.pdf
  '35222a1a-5563-46d0-a66c-13859c2124b8', // Resume-Ali Ahmed.pdf
  '7dd17cc1-36b3-43ea-9e6e-b1b52476534a', // Sami-ur-rehman.pdf
  '4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd', // CV(1).pdf
];

async function main() {
  const { data: attachments, error: attErr } = await sb
    .from('inbox_attachments')
    .select('id, file_name, candidate_id, linked_candidate_id, attachment_type')
    .in('id', ATTACHMENT_IDS);

  if (attErr) throw attErr;

  console.log('\n=== Attachment Status ===');
  for (const a of attachments) {
    const resolved = a.candidate_id || a.linked_candidate_id;
    const status = resolved ? '✅ EXTRACTED' : '⏳ STILL STUCK';
    console.log(`${status} | ${a.file_name}`);
    if (resolved) console.log(`  -> candidate_id: ${a.candidate_id || '(via linked)'} linked: ${a.linked_candidate_id}`);
  }

  // Most recent parsing job per attachment
  const { data: jobs } = await sb
    .from('parsing_jobs')
    .select('id, status, inbox_attachment_id, created_at')
    .in('inbox_attachment_id', ATTACHMENT_IDS)
    .order('created_at', { ascending: false });

  console.log('\n=== Latest Parsing Job per Attachment ===');
  const seen = new Set();
  for (const j of (jobs || [])) {
    if (!seen.has(j.inbox_attachment_id)) {
      seen.add(j.inbox_attachment_id);
      const att = attachments.find(a => a.id === j.inbox_attachment_id);
      console.log(`${j.status.padEnd(12)} | ${(att?.file_name || j.inbox_attachment_id).substring(0, 35)} | job=${j.id.substring(0, 8)} @ ${j.created_at.substring(11, 19)}`);
    }
  }

  const stuck = attachments.filter(a => !a.candidate_id && !a.linked_candidate_id);
  console.log(`\n${stuck.length === 0 ? '🎉 ALL 6 EXTRACTED!' : `⏳ ${stuck.length}/6 still stuck`}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
