import dotenv from 'dotenv';
dotenv.config();

const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: K, Authorization: `Bearer ${K}` };

// Total count
const r1 = await fetch(`${U}/rest/v1/inbox_attachments?parsing_status=eq.pending&candidate_id=is.null&attachment_kind=eq.cv&select=id`, { headers: { ...h, Prefer: 'count=exact', Range: '0-0' } });
console.log('Total kind=cv, no candidate_id:', r1.headers.get('content-range'));

// Get the IDs
const atts = await (await fetch(`${U}/rest/v1/inbox_attachments?parsing_status=eq.pending&candidate_id=is.null&attachment_kind=eq.cv&select=id,file_name,created_at&order=created_at.desc`, { headers: h })).json();
console.log('Sample filenames:', atts.slice(0, 5).map(a => a.file_name));

// Check a few for parsing_jobs records
for (const att of atts.slice(0, 3)) {
  const jobs = await (await fetch(`${U}/rest/v1/parsing_jobs?inbox_attachment_id=eq.${att.id}&select=id,status`, { headers: h })).json();
  console.log(`${att.id} (${att.file_name}) → parsing_jobs:`, jobs.length ? jobs.map(j => `${j.id.substring(0,8)}... status=${j.status}`) : 'NONE');
}
