const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

// Try to load .env file from backend root
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  // Try .env.local
  const envLocalPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envLocalPath)) {
    require('dotenv').config({ path: envLocalPath });
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hncvsextwmvjydcukdwx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                              process.env.SUPABASE_ANON_KEY ||
                              'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkPassportVerification() {
  console.log('🔍 Checking Farhan\'s passport verification...\n');

  // Find Farhan's candidate ID
  const { data: farhan } = await supabase
    .from('candidates')
    .select('id, name, passport_normalized, email, phone')
    .eq('candidate_code', 'FL-2026-192')
    .single();

  if (!farhan) {
    console.error('❌ Farhan not found');
    return;
  }

  console.log('📊 Candidate Data:');
  console.log(`   ID: ${farhan.id}`);
  console.log(`   Name: ${farhan.name}`);
  console.log(`   Passport (normalized): ${farhan.passport_normalized || 'NULL'}`);
  console.log(`   Email: ${farhan.email || 'NULL'}`);
  console.log(`   Phone: ${farhan.phone || 'NULL'}\n`);

  // Find passport documents for Farhan
  const { data: passportDocs } = await supabase
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', farhan.id)
    .eq('category', 'passport')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!passportDocs || passportDocs.length === 0) {
    console.log('⚠️  No passport documents found');
    return;
  }

  console.log(`📄 Found ${passportDocs.length} passport document(s):\n`);

  for (const doc of passportDocs) {
    console.log(`📋 Document: ${doc.file_name}`);
    console.log(`   ID: ${doc.id}`);
    console.log(`   Status: ${doc.verification_status}`);
    console.log(`   Category: ${doc.category || doc.detected_category}`);
    console.log(`   Confidence: ${doc.confidence || 'N/A'}`);
    console.log(`   Created: ${doc.created_at}`);
    
    if (doc.extracted_identity_json) {
      console.log(`\n   📝 Extracted Identity Fields:`);
      const identity = doc.extracted_identity_json;
      console.log(`      Name: ${identity.name || 'NULL'}`);
      console.log(`      Passport No: ${identity.passport_no || identity.document_number || 'NULL'}`);
      console.log(`      Nationality: ${identity.nationality || 'NULL'}`);
      console.log(`      DOB: ${identity.date_of_birth || identity.dob || 'NULL'}`);
      console.log(`      Passport Expiry: ${identity.passport_expiry || identity.expiry_date || 'NULL'}`);
      console.log(`      Email: ${identity.email || 'NULL'}`);
      console.log(`      Phone: ${identity.phone || 'NULL'}`);
      
      // Check if passport number matches
      const extractedPassport = identity.passport_no || identity.document_number;
      if (extractedPassport && farhan.passport_normalized) {
        const normalizedExtracted = extractedPassport.trim().toUpperCase();
        const normalizedCandidate = farhan.passport_normalized.trim().toUpperCase();
        console.log(`\n   🔍 Passport Matching:`);
        console.log(`      Extracted (normalized): "${normalizedExtracted}"`);
        console.log(`      Candidate (normalized): "${normalizedCandidate}"`);
        console.log(`      Match: ${normalizedExtracted === normalizedCandidate ? '✅ YES' : '❌ NO'}`);
      }
      
      // Check name matching
      if (identity.name && farhan.name) {
        const extractedName = identity.name.trim().toLowerCase();
        const candidateName = farhan.name.trim().toLowerCase();
        console.log(`\n   🔍 Name Matching:`);
        console.log(`      Extracted: "${extractedName}"`);
        console.log(`      Candidate: "${candidateName}"`);
        console.log(`      Match: ${extractedName === candidateName ? '✅ EXACT' : extractedName.includes(candidateName) || candidateName.includes(extractedName) ? '⚠️  PARTIAL' : '❌ NO'}`);
      }
    }
    
    console.log(`\n   🔍 Verification Details:`);
    console.log(`      Reason Code: ${doc.verification_reason_code || 'N/A'}`);
    console.log(`      Mismatch Fields: ${doc.mismatch_fields ? JSON.stringify(doc.mismatch_fields) : 'N/A'}`);
    
    // Get verification logs
    const { data: logs } = await supabase
      .from('document_verification_logs')
      .select('*')
      .eq('document_id', doc.id)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (logs && logs.length > 0) {
      console.log(`\n   📜 Verification Logs (${logs.length}):`);
      for (const log of logs) {
        console.log(`      - ${log.event_type}: ${log.verification_status || log.status} (${new Date(log.created_at).toLocaleString()})`);
        if (log.reason_code) {
          console.log(`        Reason: ${log.reason_code}`);
        }
        if (log.mismatch_fields && log.mismatch_fields.length > 0) {
          console.log(`        Mismatches: ${log.mismatch_fields.join(', ')}`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
  }
}

checkPassportVerification().catch(console.error);
