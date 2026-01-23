/**
 * Check whether migration 016 (universal rejection + override + retry schema) is applied in Supabase.
 *
 * This script connects directly to Supabase Postgres using the same connection string
 * pattern used by other migration scripts in this repo.
 *
 * It DOES NOT apply any migrations; it only verifies schema presence.
 */

const { Client } = require('pg');

// Prefer env var if present; otherwise fall back to migrate.js connection string pattern (repo-local).
// NOTE: Do not print credentials.
const DEFAULT_CONN =
  'postgresql://postgres:MonsterBurger123!!@db.hncvsextwmvjydcukdwx.supabase.co:5432/postgres';

const connectionString =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_POSTGRES_URL ||
  DEFAULT_CONN;

const REQUIRED_CANDIDATE_DOCUMENT_COLUMNS = [
  'rejection_code',
  'rejection_reason',
  'ai_confidence',
  'ocr_confidence',
  'verified_against',
  'verification_source',
  'error_stage',
  'retry_possible',
  'retry_count',
  'max_retries',
  'document_expiry_date',
  'rejection_context',
  'override_reason',
  'overridden_by',
  'overridden_at',
];

async function main() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('🔍 Checking if migration 016 is applied...\n');

    await client.connect();

    // 1) Check columns in candidate_documents
    const colsRes = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'candidate_documents'
        AND column_name = ANY($1::text[])
      ORDER BY column_name;
    `,
      [REQUIRED_CANDIDATE_DOCUMENT_COLUMNS]
    );

    const foundCols = new Set(colsRes.rows.map((r) => r.column_name));
    const missingCols = REQUIRED_CANDIDATE_DOCUMENT_COLUMNS.filter((c) => !foundCols.has(c));

    // 2) Check admin_override_logs table exists
    const tableRes = await client.query(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'admin_override_logs'
      LIMIT 1;
    `
    );

    const hasAdminOverrideLogs = tableRes.rows.length > 0;

    // 3) Check key constraints exist (best-effort)
    const constraintRes = await client.query(
      `
      SELECT conname
      FROM pg_constraint
      WHERE conname IN (
        'check_candidate_documents_verification_source',
        'check_candidate_documents_error_stage',
        'check_candidate_documents_retry_counts',
        'check_admin_override_logs_required_role'
      )
      ORDER BY conname;
    `
    );

    const foundConstraints = constraintRes.rows.map((r) => r.conname);

    // Report
    console.log('✅ candidate_documents columns found:', foundCols.size, '/', REQUIRED_CANDIDATE_DOCUMENT_COLUMNS.length);
    if (missingCols.length) {
      console.log('❌ Missing candidate_documents columns:');
      for (const c of missingCols) console.log('  -', c);
    } else {
      console.log('✅ All required candidate_documents columns exist');
    }

    console.log('\n✅ admin_override_logs table:', hasAdminOverrideLogs ? 'FOUND' : 'MISSING');

    console.log('\n✅ Key constraints found:', foundConstraints.length ? foundConstraints.join(', ') : '(none)');

    const applied = missingCols.length === 0 && hasAdminOverrideLogs;

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (applied) {
      console.log('🎉 Migration 016 appears to be APPLIED.');
      console.log('No manual action needed in Supabase for migration 016.');
    } else {
      console.log('⚠️  Migration 016 is NOT fully applied.');
      console.log('You still need to run `backend/migrations/016_add_universal_rejection_details.sql` in Supabase SQL Editor (or via psql).');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (err) {
    console.error('❌ Failed to check migration 016:', err?.message || err);
    process.exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

main();

