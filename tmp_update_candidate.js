const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const attachmentId = '2e6696da-2782-4565-a53d-3be37d8292cb';

const formatEducation = (edu) => {
  if (!Array.isArray(edu)) return null;
  const parts = edu.map((e) => {
    if (!e || typeof e !== 'object') return null;
    const seg = [];
    if (e.degree) seg.push(e.degree);
    if (e.institution) seg.push(e.institution);
    if (e.location) seg.push(e.location);
    if (e.graduation_date) seg.push(e.graduation_date);
    if (e.cgpa) seg.push('CGPA: ' + e.cgpa);
    return seg.filter(Boolean).join(' - ');
  }).filter(Boolean);
  return parts.length ? parts.join(' | ') : null;
};

(async () => {
  const { data: job, error: jobErr } = await supabase
    .from('parsing_jobs')
    .select('output')
    .eq('inbox_attachment_id', attachmentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (jobErr) {
    console.error(jobErr);
    return;
  }

  const parsed = job?.output?.candidate;
  if (!parsed) {
    console.log('No parsed output');
    return;
  }

  const { data: att, error: attErr } = await supabase
    .from('inbox_attachments')
    .select('candidate_id')
    .eq('id', attachmentId)
    .single();

  if (attErr) {
    console.error(attErr);
    return;
  }

  const candidateId = att?.candidate_id;
  if (!candidateId) {
    console.log('No candidate_id linked to attachment');
    return;
  }

  const update = {
    name: parsed.full_name || null,
    email: parsed.email || null,
    phone: parsed.phone || null,
    position: parsed.position || null,
    experience_years: parsed.experience_years || null,
    education: formatEducation(parsed.education),
    certifications: Array.isArray(parsed.certifications) ? parsed.certifications.join(' | ') : null,
    languages: Array.isArray(parsed.languages) ? parsed.languages.join(' | ') : null,
    skills: Array.isArray(parsed.skills) ? parsed.skills.join(', ') : null,
    previous_employment: parsed.previous_employment || null,
    professional_summary: parsed.professional_summary || parsed.summary || null,
  };

  const { error: updateErr } = await supabase
    .from('candidates')
    .update(update)
    .eq('id', candidateId);

  if (updateErr) {
    console.error(updateErr);
    return;
  }

  console.log('Updated candidate', candidateId, update);
})();
