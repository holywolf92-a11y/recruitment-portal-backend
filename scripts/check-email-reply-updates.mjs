const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';
const h = { apikey: KEY, Authorization: 'Bearer ' + KEY, Prefer: 'count=exact' };

// 1. Candidates where reply was fully processed (progressive enrichment completed)
const r1 = await fetch(
  SUPABASE_URL + '/rest/v1/candidates?select=id,full_name,missing_data_email_last_reply_processed_at&missing_data_email_last_reply_processed_at=not.is.null&order=missing_data_email_last_reply_processed_at.desc',
  { headers: h }
);
const range1 = r1.headers.get('content-range');
const cands = await r1.json();
console.log('=== Candidates with reply fully processed ===');
console.log('content-range:', range1);
if (Array.isArray(cands)) {
  console.log('Count:', cands.length);
  cands.forEach(c => console.log('  ', c.full_name, '|', c.missing_data_email_last_reply_processed_at));
} else {
  console.log(JSON.stringify(cands));
}

// 2. candidate_documents ingested from email replies
const r2 = await fetch(
  SUPABASE_URL + '/rest/v1/candidate_documents?select=id,candidate_id,created_at&source=eq.email&order=created_at.desc',
  { headers: h }
);
const range2 = r2.headers.get('content-range');
const docs = await r2.json();
console.log('\n=== Documents sourced from email ===');
console.log('content-range:', range2);
if (Array.isArray(docs)) {
  const uniq = new Set(docs.map(d => d.candidate_id));
  console.log('Total email docs:', docs.length);
  console.log('Unique candidates with email docs:', uniq.size);
  docs.slice(0, 5).forEach(d => console.log('  doc', d.id, 'candidate', d.candidate_id, 'at', d.created_at));
} else {
  console.log(JSON.stringify(docs));
}

// 3. Candidates that have field_sources containing 'email' (data filled from reply)
const r3 = await fetch(
  SUPABASE_URL + '/rest/v1/candidates?select=id,full_name,field_sources,updated_at&field_sources=cs.{"email"}&order=updated_at.desc&limit=200',
  { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }
);
const enriched = await r3.json();
console.log('\n=== Candidates with email in field_sources ===');
if (Array.isArray(enriched)) {
  console.log('Count:', enriched.length);
  enriched.slice(0, 10).forEach(c => console.log('  ', c.full_name, '|', JSON.stringify(c.field_sources)));
} else {
  console.log(JSON.stringify(enriched));
}
