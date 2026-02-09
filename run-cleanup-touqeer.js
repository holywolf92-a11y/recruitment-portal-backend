#!/usr/bin/env node

/**
 * Execute Touqeer Ahmed duplicate cleanup
 * Merges FL-2026-914/915/916 into FL-2026-912
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('   Make sure backend/.env file exists with these variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 STEP 1: Find all Touqeer candidates');
  console.log('='.repeat(80));

  const { data: candidates, error: err1 } = await supabase
    .from('candidates')
    .select('id, candidate_code, name, email, phone, status, created_at')
    .ilike('name', '%touqeer%')
    .order('created_at', { ascending: true });

  if (err1) throw err1;
  console.table(candidates);

  // ========================================================================

  console.log('\n' + '='.repeat(80));
  console.log('📊 STEP 2: Count documents before merge');
  console.log('='.repeat(80));

  const docCounts = {};
  for (const cand of candidates) {
    const { data: docs, error } = await supabase
      .from('documents')
      .select('doc_type')
      .eq('candidate_id', cand.id);

    if (error) throw error;

    docCounts[cand.candidate_code] = {
      name: cand.name,
      status: cand.status,
      doc_count: docs.length,
      doc_types: [...new Set(docs.map(d => d.doc_type))].join(', ')
    };
  }

  console.table(docCounts);

  // ========================================================================

  console.log('\n' + '='.repeat(80));
  console.log('🔀 STEP 3: Transfer documents from duplicates to principal');
  console.log('='.repeat(80));

  const principal = candidates.find(c => c.candidate_code === 'FL-2026-912');
  if (!principal) {
    throw new Error('Principal candidate FL-2026-912 not found');
  }

  console.log(`Principal: ${principal.candidate_code} (${principal.name})`);
  console.log(`Principal UUID: ${principal.id}\n`);

  const duplicates = candidates.filter(c => 
    ['FL-2026-914', 'FL-2026-915', 'FL-2026-916'].includes(c.candidate_code)
  );

  console.log(`Found ${duplicates.length} duplicates to merge:`);
  duplicates.forEach(d => console.log(`  - ${d.candidate_code} (${d.name})`));

  let totalMoved = 0;
  for (const dup of duplicates) {
    const { data: docs, error: err2 } = await supabase
      .from('documents')
      .select('id')
      .eq('candidate_id', dup.id);

    if (err2) throw err2;

    if (docs.length > 0) {
      console.log(`\n  Moving ${docs.length} documents from ${dup.candidate_code}...`);
      
      const { error: err3 } = await supabase
        .from('documents')
        .update({ candidate_id: principal.id })
        .eq('candidate_id', dup.id);

      if (err3) throw err3;
      
      totalMoved += docs.length;
      console.log(`  ✅ Moved ${docs.length} documents`);
    } else {
      console.log(`\n  ⚠️  ${dup.candidate_code} has no documents to move`);
    }
  }

  console.log(`\n📦 Total documents transferred: ${totalMoved}`);

  // ========================================================================

  console.log('\n' + '='.repeat(80));
  console.log('🚫 STEP 4: Mark duplicates as Cancelled');
  console.log('='.repeat(80));

  for (const dup of duplicates) {
    const { error: err4 } = await supabase
      .from('candidates')
      .update({ 
        status: 'Cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', dup.id);

    if (err4) throw err4;
    console.log(`  ✅ Marked ${dup.candidate_code} as Cancelled`);
  }

  // ========================================================================

  console.log('\n' + '='.repeat(80));
  console.log('✅ STEP 5: Verify cleanup results');
  console.log('='.repeat(80));

  const verifyResults = {};
  for (const cand of candidates) {
    const { data: docs, error } = await supabase
      .from('documents')
      .select('doc_type')
      .eq('candidate_id', cand.id);

    if (error) throw error;

    // Get updated status
    const { data: updated, error: err5 } = await supabase
      .from('candidates')
      .select('status')
      .eq('id', cand.id)
      .single();

    if (err5) throw err5;

    verifyResults[cand.candidate_code] = {
      name: cand.name,
      status: updated.status,
      total_docs: docs.length,
      doc_types: [...new Set(docs.map(d => d.doc_type))].join(', ')
    };
  }

  console.table(verifyResults);

  // ========================================================================

  console.log('\n' + '='.repeat(80));
  console.log('📋 CLEANUP SUMMARY');
  console.log('='.repeat(80));

  const principalResult = verifyResults['FL-2026-912'];
  console.log(`
✅ Cleanup completed successfully!

📌 Principal Candidate: FL-2026-912
   - Status: ${principalResult.status}
   - Total Documents: ${principalResult.total_docs}
   - Document Types: ${principalResult.doc_types || '(none)'}

🚫 Duplicate Candidates: FL-2026-914, FL-2026-915, FL-2026-916
   - Status: Cancelled (hidden from main candidate list)
   - Documents: Moved to principal

💡 Next Steps:
   - Verify FL-2026-912 in your portal (should have all documents)
   - Duplicates (914/915/916) are marked Cancelled and won't appear in searches
   - Test the duplicate prevention fixes are working with new emails
  `);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  console.error(error);
  process.exit(1);
});
