require('dotenv').config();

const { supabaseAdminClient } = require('../dist/config/database');
const {
  maybeSendMissingDataEmail,
  sendStandaloneMissingDataEmail,
} = require('../dist/services/missingDataEmailService');

async function main() {
  const arg = process.argv[2];
  const force = process.argv.includes('--force') || process.argv.includes('-f');
  if (!arg) {
    console.error('Usage: node scripts/send-missing-data-email.js <candidate_code_or_uuid> [--force|-f]');
    process.exit(1);
  }

  const db = supabaseAdminClient();

  let candidateId = arg;
  let candidateCode = arg;
  let hasThread = false;

  const isCandidateCode = /^FL-\d{4}-\d+$/i.test(arg);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(arg);

  // If it looks like FL-2026-xxx, resolve to candidate id
  if (isCandidateCode) {
    const { data: candidate, error } = await db
      .from('candidates')
      .select('id, candidate_code, name, position, email, gmail_thread_id')
      .eq('candidate_code', arg)
      .maybeSingle();

    if (error || !candidate) {
      console.error('Candidate not found for code:', arg, error?.message || '');
      process.exit(1);
    }

    candidateId = candidate.id;
    candidateCode = candidate.candidate_code;
    hasThread = !!candidate.gmail_thread_id;
    
    console.log(`\n=== Sending Missing Data Email ===`);
    console.log(`Candidate: ${candidate.name} (${candidate.candidate_code})`);
    console.log(`Position: ${candidate.position}`);
    console.log(`Gmail Thread ID: ${candidate.gmail_thread_id || '(not set - will send standalone email)'}`);
    console.log(`\n`);
  } else if (isUuid) {
    const { data: candidate, error } = await db
      .from('candidates')
      .select('id, candidate_code, name, position, email, gmail_thread_id')
      .eq('id', arg)
      .maybeSingle();

    if (error || !candidate) {
      console.error('Candidate not found for id:', arg, error?.message || '');
      process.exit(1);
    }

    candidateId = candidate.id;
    candidateCode = candidate.candidate_code;
    hasThread = !!candidate.gmail_thread_id;
  }

  const result = hasThread
    ? await maybeSendMissingDataEmail({
        candidateId,
        trigger: 'manual_send_script',
        force,
      })
    : await sendStandaloneMissingDataEmail({
        candidateId,
        trigger: 'manual_send_script_manual',
        force,
      });

  if (result.sent) {
    console.log(`✅ Email sent successfully (attempt ${result.attempt})`);
  } else {
    console.log(`❌ Email not sent: ${result.reason}`);
    if (result.reason === 'missing_thread') {
      console.log(`   → Candidate does not have gmail_thread_id set.`);
      console.log(`   → This is set when a CV is ingested from Gmail.`);
      console.log(`   → For manual uploads, standalone email should be used.`);
    } else if (result.reason === 'missing_email') {
      console.log(`   → Candidate has no email address.`);
    } else if (result.reason === 'nothing_missing') {
      console.log(`   → All fields are complete; no missing data email needed.`);
    } else if (result.reason === 'max_attempts') {
      console.log(`   → Already sent 3 attempts; loop stopped.`);
    } else if (result.reason === 'cooldown') {
      console.log(`   → Still in 24h cooldown from last send.`);
    } else if (result.reason === 'status_blocked') {
      console.log(`   → Email loop status is stopped or completed.`);
    }
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
