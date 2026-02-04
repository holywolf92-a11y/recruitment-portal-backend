const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hncvsextwmvjydcukdwx.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigration() {
  console.log('Running parsing_jobs table migration...');

  try {
    // Execute the SQL statements one by one
    const statements = [
      `create extension if not exists pgcrypto`,
      
      `create table if not exists parsing_jobs (
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
      )`,
      
      `create index if not exists idx_parsing_jobs_attachment_id on parsing_jobs(attachment_id)`,
      
      `create index if not exists idx_parsing_jobs_status on parsing_jobs(status)`
    ];

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      console.log(`\nExecuting statement ${i + 1}/${statements.length}...`);
      console.log(stmt.substring(0, 80) + '...');
      
      const { data, error } = await supabase.rpc('exec_sql', { sql: stmt });
      
      if (error) {
        // Try alternative approach using raw SQL via connection string
        console.log(`RPC method failed, trying direct execution...`);
        const response = await fetch(`${supabaseUrl}/rest/v1/`, {
          method: 'POST',
          headers: {
            'apikey': serviceRoleKey,
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ query: stmt })
        });
        
        if (!response.ok) {
          console.log(`Direct execution also failed. This is expected - migration should be run via Supabase Dashboard.`);
          console.log(`\nPlease run the following SQL in Supabase Dashboard:`);
          console.log(`https://supabase.com/dashboard/project/hncvsextwmvjydcukdwx/sql/new`);
          console.log(`\n${statements.join(';\n\n')};`);
          return;
        }
      }
      
      console.log('✓ Statement executed successfully');
    }

    console.log('\n✅ All migration statements completed!');
    
    // Verify table was created
    console.log('\nVerifying parsing_jobs table...');
    const { data: tables, error: verifyError } = await supabase
      .from('parsing_jobs')
      .select('id')
      .limit(1);
    
    if (verifyError) {
      if (verifyError.code === 'PGRST204') {
        console.log('❌ Table not created yet. Please run the SQL manually in Supabase Dashboard.');
        console.log(`URL: https://supabase.com/dashboard/project/hncvsextwmvjydcukdwx/sql/new`);
      } else {
        console.log('Table verification error:', verifyError.message);
      }
    } else {
      console.log('✅ Table exists and is accessible!');
    }

  } catch (err) {
    console.error('Migration error:', err.message);
    console.log('\n📝 Manual SQL to run in Supabase Dashboard:');
    console.log('https://supabase.com/dashboard/project/hncvsextwmvjydcukdwx/sql/new');
    console.log('\n--- Copy everything below ---\n');
    console.log(`create extension if not exists pgcrypto;

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
create index if not exists idx_parsing_jobs_status on parsing_jobs(status);`);
  }
}

runMigration();
