/**
 * Test script to check if candidate record was updated with passport data
 * Run: node scripts/test-candidate-update.js <candidate_id>
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testCandidateUpdate(candidateId) {
  console.log(`\n🔍 Checking candidate record for: ${candidateId}\n`);
  
  // Get candidate record
  const { data: candidate, error } = await supabase
    .from('candidates')
    .select('id, name, nationality, profile_photo_url, profile_photo_bucket, profile_photo_path, passport_expiry, date_of_birth, created_at, updated_at')
    .eq('id', candidateId)
    .single();
  
  if (error) {
    console.error('❌ Error fetching candidate:', error.message);
    return;
  }
  
  if (!candidate) {
    console.error('❌ Candidate not found');
    return;
  }
  
  console.log('📋 Candidate Record:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Name:              ${candidate.name || '❌ MISSING'}`);
  console.log(`Nationality:       ${candidate.nationality || '❌ MISSING'}`);
  console.log(`Profile Photo URL: ${candidate.profile_photo_url || '❌ MISSING'}`);
  console.log(`Photo Bucket:      ${candidate.profile_photo_bucket || '❌ MISSING'}`);
  console.log(`Photo Path:        ${candidate.profile_photo_path || '❌ MISSING'}`);
  console.log(`Passport Expiry:   ${candidate.passport_expiry || '❌ MISSING'}`);
  console.log(`Date of Birth:     ${candidate.date_of_birth || '❌ MISSING'}`);
  console.log(`Created:           ${candidate.created_at}`);
  console.log(`Updated:           ${candidate.updated_at}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Check documents
  console.log('📄 Checking documents...\n');
  const { data: documents, error: docError } = await supabase
    .from('candidate_documents')
    .select('id, file_name, category, verification_status, extracted_identity_json, ai_processing_completed_at')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false });
  
  if (docError) {
    console.error('❌ Error fetching documents:', docError.message);
    return;
  }
  
  if (documents && documents.length > 0) {
    console.log(`Found ${documents.length} document(s):\n`);
    documents.forEach((doc, index) => {
      console.log(`Document ${index + 1}:`);
      console.log(`  File: ${doc.file_name}`);
      console.log(`  Category: ${doc.category || 'N/A'}`);
      console.log(`  Status: ${doc.verification_status || 'N/A'}`);
      console.log(`  Processed: ${doc.ai_processing_completed_at || 'N/A'}`);
      
      if (doc.extracted_identity_json) {
        const identity = doc.extracted_identity_json;
        console.log(`  Extracted Data:`);
        console.log(`    Name: ${identity.name || 'N/A'}`);
        console.log(`    Nationality: ${identity.nationality || 'N/A'}`);
        console.log(`    Passport: ${identity.passport_no || 'N/A'}`);
        console.log(`    Passport Expiry: ${identity.passport_expiry || identity.expiry_date || 'N/A'}`);
        console.log(`    Date of Birth: ${identity.date_of_birth || 'N/A'}`);
      }
      console.log('');
    });
  } else {
    console.log('❌ No documents found\n');
  }
  
  // Summary
  console.log('📊 Summary:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const hasNationality = !!candidate.nationality;
  const hasPhotoUrl = !!candidate.profile_photo_url;
  const hasPhotoBucket = !!candidate.profile_photo_bucket;
  const hasPhotoPath = !!candidate.profile_photo_path;
  const hasExpiry = !!candidate.passport_expiry;
  const hasDOB = !!candidate.date_of_birth;

  console.log(`Nationality:         ${hasNationality ? '✅' : '❌'}`);
  console.log(`Profile Photo URL:   ${hasPhotoUrl ? '✅' : '❌'}`);
  console.log(`Photo Bucket:        ${hasPhotoBucket ? '✅' : '❌'}`);
  console.log(`Photo Path:          ${hasPhotoPath ? '✅' : '❌'}`);
  console.log(`Passport Expiry:     ${hasExpiry ? '✅' : '❌'}`);
  console.log(`Date of Birth:       ${hasDOB ? '✅' : '❌'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (hasPhotoUrl && hasPhotoBucket && hasPhotoPath) {
    console.log('✅ SUCCESS: Candidate record has profile photo fields set!');
  } else {
    console.log('⚠️  WARNING: Profile photo fields are missing. Check extraction and backend logic.');
  }
}

const candidateId = process.argv[2] || 'f6773426-f1e3-4e26-bfc7-ff385c118b4a'; // Farhan's ID
testCandidateUpdate(candidateId).catch(console.error);
