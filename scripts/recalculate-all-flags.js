/**
 * Recalculate document flags for all candidates
 * This ensures flags are accurate after data clearing or migration
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function recalculateFlagsForCandidate(candidateId) {
  try {
    // Get ALL documents for this candidate
    const { data: documents, error: docsError } = await supabase
      .from('candidate_documents')
      .select('category, verification_status, file_name')
      .eq('candidate_id', candidateId);

    if (docsError) {
      console.warn(`  ⚠️  Error fetching candidate_documents for ${candidateId}: ${docsError.message}`);
    }

    // Check inbox_attachments
    const { data: inboxAttachments, error: inboxError } = await supabase
      .from('inbox_attachments')
      .select('attachment_type, attachment_kind, document_type, file_name, candidate_id, linked_candidate_id')
      .or(`candidate_id.eq.${candidateId},linked_candidate_id.eq.${candidateId}`);

    if (inboxError) {
      console.warn(`  ⚠️  Error fetching inbox_attachments for ${candidateId}: ${inboxError.message}`);
    }

    // Check old documents table
    const { data: oldDocuments, error: oldDocsError } = await supabase
      .from('documents')
      .select('doc_type, file_name')
      .eq('candidate_id', candidateId);

    if (oldDocsError) {
      // This is OK - old documents table might not exist
    }

    // Combine all document sources
    const allDocs = [
      ...(documents || []).map(d => ({ 
        category: d.category, 
        type: null, 
        attachment_kind: null,
        document_type: null,
        file_name: d.file_name, 
        source: 'candidate_documents' 
      })),
      ...(inboxAttachments || []).map(d => ({ 
        category: null, 
        type: d.attachment_type, 
        attachment_kind: d.attachment_kind,
        document_type: d.document_type,
        file_name: d.file_name,
        source: 'inbox_attachments'
      })),
      ...(oldDocuments || []).map(d => ({ 
        category: null, 
        type: d.doc_type, 
        attachment_kind: null,
        document_type: null,
        file_name: d.file_name, 
        source: 'documents' 
      }))
    ];

    // Determine which flags to set
    const updateFlags = {};
    const now = new Date().toISOString();

    for (const doc of allDocs) {
      const category = (doc.category || '').toLowerCase();
      const docType = (doc.type || '').toLowerCase();
      const attachmentKind = (doc.attachment_kind || '').toLowerCase();
      const documentType = (doc.document_type || '').toLowerCase();
      const fileName = (doc.file_name || '').toLowerCase();

      // CV detection
      if (category === 'cv_resume' || category === 'cv' || 
          attachmentKind === 'cv' || 
          docType === 'cv' || docType.includes('resume') ||
          fileName.includes('cv') || fileName.includes('resume')) {
        if (!updateFlags.cv_received) {
          updateFlags.cv_received = true;
          updateFlags.cv_received_at = now;
        }
      }
      
      // Passport detection
      if (category === 'passport' || 
          documentType === 'passport' ||
          docType.includes('passport') ||
          fileName.includes('passport')) {
        if (!updateFlags.passport_received) {
          updateFlags.passport_received = true;
          updateFlags.passport_received_at = now;
        }
      }
      
      // CNIC detection
      if (documentType === 'cnic' ||
          docType.includes('cnic') || docType.includes('id card')) {
        if (!updateFlags.cnic_received) {
          updateFlags.cnic_received = true;
          updateFlags.cnic_received_at = now;
        }
      }
      
      // Certificate/Degree detection
      if (category === 'certificates' ||
          documentType === 'certificate' || documentType === 'degree' ||
          docType.includes('certificate') || docType.includes('degree') || docType.includes('diploma')) {
        if (!updateFlags.certificate_received && !updateFlags.degree_received) {
          updateFlags.certificate_received = true;
          updateFlags.certificate_received_at = now;
          updateFlags.degree_received = true;
          updateFlags.degree_received_at = now;
        }
      }
      
      // Photo detection
      if (category === 'photos' ||
          docType === 'photo' || docType.includes('profile photo')) {
        if (!updateFlags.photo_received) {
          updateFlags.photo_received = true;
          updateFlags.photo_received_at = now;
        }
      }
      
      // Medical detection
      if (category === 'medical_reports' ||
          documentType === 'medical' ||
          docType.includes('medical')) {
        if (!updateFlags.medical_received) {
          updateFlags.medical_received = true;
          updateFlags.medical_received_at = now;
        }
      }
      
      // Visa detection
      if (documentType === 'visa' ||
          docType.includes('visa')) {
        if (!updateFlags.visa_received) {
          updateFlags.visa_received = true;
          updateFlags.visa_received_at = now;
        }
      }
    }

    // Reset flags that should be false (if no documents found)
    const flagsToReset = {
      cv_received: false,
      passport_received: false,
      cnic_received: false,
      certificate_received: false,
      degree_received: false,
      photo_received: false,
      medical_received: false,
      visa_received: false,
    };

    // Merge: set true flags, reset false flags
    const finalFlags = { ...flagsToReset, ...updateFlags };

    // Update candidate
    const { error: updateError } = await supabase
      .from('candidates')
      .update(finalFlags)
      .eq('id', candidateId);

    if (updateError) {
      throw updateError;
    }

    const flagsSet = Object.keys(updateFlags).filter(k => k.endsWith('_received') && updateFlags[k]);
    return { success: true, flagsSet: flagsSet.length, flags: flagsSet };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function recalculateAllFlags() {
  console.log('🔄 Recalculating document flags for all candidates...\n');
  console.log('='.repeat(60));

  // Get all candidates
  const { data: candidates, error } = await supabase
    .from('candidates')
    .select('id, name, candidate_code')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Failed to fetch candidates:', error);
    process.exit(1);
  }

  if (!candidates || candidates.length === 0) {
    console.log('ℹ️  No candidates found. Nothing to recalculate.');
    return;
  }

  console.log(`\n📊 Found ${candidates.length} candidates to process...\n`);

  let successCount = 0;
  let failCount = 0;
  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    process.stdout.write(`  [${i + 1}/${candidates.length}] ${candidate.name || candidate.candidate_code}... `);
    
    const result = await recalculateFlagsForCandidate(candidate.id);
    
    if (result.success) {
      console.log(`✅ (${result.flagsSet} flags set: ${result.flags?.join(', ') || 'none'})`);
      successCount++;
    } else {
      console.log(`❌ ${result.error}`);
      failCount++;
    }
    
    results.push({ candidate: candidate.name || candidate.candidate_code, ...result });
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Summary:\n');
  console.log(`  ✅ Successfully updated: ${successCount}/${candidates.length}`);
  if (failCount > 0) {
    console.log(`  ❌ Failed: ${failCount}/${candidates.length}`);
  }

  // Show candidates with flags
  const withFlags = results.filter(r => r.success && r.flagsSet > 0);
  if (withFlags.length > 0) {
    console.log(`\n📄 Candidates with documents:`);
    withFlags.forEach(r => {
      console.log(`  - ${r.candidate}: ${r.flags?.join(', ') || 'none'}`);
    });
  }

  console.log('\n✅ Flag recalculation complete!');
  console.log('\nNote: Refresh the frontend to see updated flags.');
}

// Run the recalculation
recalculateAllFlags()
  .then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
