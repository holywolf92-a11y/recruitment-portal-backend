const https = require('https');

const supabaseRef = 'hncvsextwmvjydcukdwx';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

// SQL to create the table
const sql = `
create extension if not exists pgcrypto;

create table if not exists parsing_jobs (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null,
  file_hash text,
  status text not null default 'queued',
  attempts int not null default 0,
  python_request_id text,
  schema_version text default 'v1',
  result_json jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_parsing_jobs_attachment_id on parsing_jobs(attachment_id);
create index if not exists idx_parsing_jobs_status on parsing_jobs(status);
`.trim();

console.log('============================================');
console.log('SUPABASE SQL MIGRATION - parsing_jobs table');
console.log('============================================\n');
console.log('Please run this SQL in Supabase Dashboard:\n');
console.log(`https://supabase.com/dashboard/project/${supabaseRef}/sql/new\n`);
console.log('--- COPY EVERYTHING BELOW ---\n');
console.log(sql);
console.log('\n--- END OF SQL ---\n');
console.log('After running, press any key to verify...');

// Wait for user input
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', async () => {
  console.log('\nVerifying table...');
  
  const https = require('https');
  const options = {
    hostname: `${supabaseRef}.supabase.co`,
    path: '/rest/v1/parsing_jobs?limit=0',
    method: 'GET',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('SUCCESS! Table parsing_jobs is now accessible!');
        console.log('You can now trigger CV parsing.');
      } else {
        console.log(`FAILED: Status ${res.statusCode}`);
        console.log(data);
        console.log('\nPlease run the SQL manually in Supabase Dashboard.');
      }
      process.exit(0);
    });
  });

  req.on('error', (error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });

  req.end();
});
