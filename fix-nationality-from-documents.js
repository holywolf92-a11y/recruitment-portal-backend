/**
 * Fix Nationality from Verified Documents
 * 
 * This script finds candidates with NULL nationality who have verified CNIC or Passport documents,
 * and updates their nationality based on the document's extracted identity information.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixNationalityFromDocuments(candidateId = null) {
  try {
    console.log('🔍 Finding candidates with missing nationality...\n');

    // Get candidates with NULL nationality
    let query = supabase
      .from('candidates')
      .select('id, name, nationality, candidate_code')
      .is('nationality', null);

    if (candidateId) {
      query = query.eq('candidate_code', candidateId);
    }

    const { data: candidates, error: candidatesError } = await query;

    if (candidatesError) {
      throw candidatesError;
    }

    console.log(`Found ${candidates.length} candidates with NULL nationality\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const candidate of candidates) {
      console.log(`\n📋 Processing: ${candidate.candidate_code} - ${candidate.name}`);

      // Get verified CNIC or Passport documents for this candidate
      const { data: documents, error: docsError } = await supabase
        .from('candidate_documents')
        .select('id, file_name, category, extracted_data, verification_status')
        .eq('candidate_id', candidate.id)
        .in('category', ['cnic', 'passport'])
        .eq('verification_status', 'verified');

      if (docsError) {
        console.error(`  ❌ Error fetching documents: ${docsError.message}`);
        continue;
      }

      if (!documents || documents.length === 0) {
        console.log(`  ⏭️  No verified CNIC/Passport documents found`);
        skippedCount++;
        continue;
      }

      console.log(`  Found ${documents.length} verified identity documents:`);
      documents.forEach(doc => {
        console.log(`    - ${doc.category}: ${doc.file_name}`);
      });

      // Try to extract nationality from documents
      let nationalityFound = null;
      let sourceDoc = null;

      for (const doc of documents) {
        if (doc.extracted_data && doc.extracted_data.nationality) {
          nationalityFound = doc.extracted_data.nationality;
          sourceDoc = doc;
          break;
        }
      }

      if (!nationalityFound) {
        // If no nationality in extracted_data, assume Pakistani for CNIC/Pakistani passport
        for (const doc of documents) {
          if (doc.category === 'cnic') {
            nationalityFound = 'Pakistani';
            sourceDoc = doc;
            console.log(`  🇵🇰 Inferring Pakistani nationality from CNIC document`);
            break;
          }
          
          // Check if passport number starts with PA (Pakistani passport)
          if (doc.category === 'passport' && doc.extracted_data?.passport_no) {
            const passportNo = doc.extracted_data.passport_no.toUpperCase();
            if (passportNo.startsWith('PA') || passportNo.startsWith('AB')) {
              nationalityFound = 'Pakistani';
              sourceDoc = doc;
              console.log(`  🇵🇰 Inferring Pakistani nationality from passport number: ${passportNo}`);
              break;
            }
          }
        }
      }

      if (!nationalityFound) {
        console.log(`  ⚠️  Could not extract nationality from documents`);
        skippedCount++;
        continue;
      }

      // Update candidate nationality
      console.log(`  ✅ Updating nationality to: ${nationalityFound} (from ${sourceDoc.category}: ${sourceDoc.file_name})`);

      const { error: updateError } = await supabase
        .from('candidates')
        .update({
          nationality: nationalityFound,
          field_sources: {
            nationality: {
              source: sourceDoc.category === 'cnic' ? 'passport' : 'passport', // Use 'passport' for both
              document_id: sourceDoc.id,
              document_type: sourceDoc.category,
              updated_at: new Date().toISOString(),
            }
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id);

      if (updateError) {
        console.error(`  ❌ Failed to update: ${updateError.message}`);
        skippedCount++;
      } else {
        console.log(`  ✅ Successfully updated ${candidate.candidate_code}`);
        updatedCount++;
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`   Total candidates processed: ${candidates.length}`);
    console.log(`   ✅ Updated: ${updatedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Get candidate ID from command line arguments
const targetCandidateId = process.argv[2];

if (targetCandidateId) {
  console.log(`🎯 Targeting specific candidate: ${targetCandidateId}\n`);
  fixNationalityFromDocuments(targetCandidateId);
} else {
  console.log(`🌍 Processing all candidates with NULL nationality\n`);
  fixNationalityFromDocuments();
}
