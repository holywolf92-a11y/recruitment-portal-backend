require('dotenv').config();

const { supabaseAdminClient } = require('../dist/config/database');
const { generateMissingDataEmailContent } = require('../dist/services/missingDataEmailService');

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/generate-missing-data-email.js <candidate_code_or_uuid>');
    process.exit(1);
  }

  const db = supabaseAdminClient();

  let candidateId = arg;

  // If it looks like FL-2026-xxx, resolve to candidate id
  if (/^FL-\d{4}-\d+$/i.test(arg)) {
    const { data: candidate, error } = await db
      .from('candidates')
      .select('id, candidate_code, name, position, email')
      .eq('candidate_code', arg)
      .maybeSingle();

    if (error || !candidate) {
      console.error('Candidate not found for code:', arg, error?.message || '');
      process.exit(1);
    }

    candidateId = candidate.id;
  }

  const out = await generateMissingDataEmailContent({ candidateId });
  if (!out.ok) {
    console.error('Failed to generate email:', out.reason);
    process.exit(1);
  }

  console.log('--- Missing Data Email Preview ---');
  console.log('To:', out.toEmail);
  console.log('Subject:', out.subject);
  console.log('');
  console.log(out.bodyText);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
