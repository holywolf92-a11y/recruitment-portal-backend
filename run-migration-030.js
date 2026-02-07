const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Migration 030: Add missing-data email loop state columns\n');
    
    const migrationPath = path.join(__dirname, './migrations/030_missing_data_email_loop.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('To apply this migration, run the following SQL in Supabase SQL Editor:');
    console.log('(https://app.supabase.com/project/[project-id]/sql)');
    console.log('\n' + '='.repeat(70) + '\n');
    console.log(sql);
    console.log('\n' + '='.repeat(70) + '\n');
    console.log('After running the SQL above, the missing-data email loop will be ready.');
    console.log('\nColumns added:');
    console.log('  - gmail_thread_id (identify which Gmail thread a candidate came from)');
    console.log('  - gmail_from_email (sender email for replies)');
    console.log('  - gmail_last_message_id (Message-ID for threading)');
    console.log('  - gmail_last_subject (original subject for Re: prefix)');
    console.log('  - missing_data_email_status (inactive/active/completed/stopped)');
    console.log('  - missing_data_email_attempts (count: 0-3)');
    console.log('  - missing_data_email_last_sent_at (timestamp)');
    console.log('  - missing_data_email_next_send_at (cooldown enforcement)');
    console.log('  - missing_data_email_last_snapshot_hash (idempotency)');
    console.log('  - missing_data_email_last_reply_processed_at (reply tracking)\n');
  } catch (err) {
    console.error('Error reading migration file:', err);
    process.exit(1);
  }
}

runMigration();
