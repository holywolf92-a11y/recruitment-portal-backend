const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://hncvsextwmvjydcukdwx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  try {
    console.log('Running migration: Add profile_photo_url to candidates table...');
    
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE candidates
        ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
        
        COMMENT ON COLUMN candidates.profile_photo_url IS 'URL of candidate profile photo extracted from CV (Supabase Storage)';
      `
    });

    if (error) {
      // Try direct RPC call instead
      console.log('Trying direct SQL execution...');
      const { data, error: directError } = await supabase
        .from('candidates')
        .select('*')
        .limit(1);
      
      if (directError) {
        console.error('Error:', directError);
        process.exit(1);
      }
      
      console.log('Connected to database successfully');
      console.log('Note: Column addition requires direct SQL access');
      console.log('Please run this SQL in Supabase SQL Editor:');
      console.log(`
        ALTER TABLE candidates
        ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
      `);
    } else {
      console.log('✅ Migration completed successfully!');
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
