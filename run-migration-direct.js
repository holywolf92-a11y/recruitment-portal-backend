const postgres = require('postgres');

const supabaseUrl = 'https://hncvsextwmvjydcukdwx.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  console.log('Please set the environment variable and try again');
  process.exit(1);
}

// Parse connection string from Supabase credentials
const connectionString = `postgresql://postgres.hncvsextwmvjydcukdwx:${serviceRoleKey}@db.hncvsextwmvjydcukdwx.supabase.co:6543/postgres`;

async function runMigration() {
  try {
    console.log('🔄 Connecting to Supabase database...');
    const sql = postgres(connectionString, { ssl: 'require' });
    
    console.log('✅ Connected successfully');
    console.log('🔄 Adding profile_photo_url column to candidates table...');
    
    await sql`
      ALTER TABLE candidates
      ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
    `;
    
    console.log('✅ Column added successfully!');
    
    // Verify the column exists
    const result = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'candidates' AND column_name = 'profile_photo_url';
    `;
    
    if (result.length > 0) {
      console.log('✅ Verified: profile_photo_url column exists');
    }
    
    await sql.end();
    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runMigration();
