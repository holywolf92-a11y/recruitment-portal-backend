/**
 * Test script to verify candidate data and endpoints
 * Tests:
 * 1. Database connection
 * 2. Candidate record fields
 * 3. Document extraction data
 * 4. API endpoint response
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Please set these in .env.local or environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Farhan's candidate ID
const CANDIDATE_ID = 'f6773426-f1e3-4e26-bfc7-ff385c118b4a';

async function testDatabaseConnection() {
  console.log('\n🔍 Testing Database Connection...\n');
  
  try {
    const { data, error } = await supabase
      .from('candidates')
      .select('id, name')
      .limit(1);
    
    if (error) {
      console.error('❌ Database connection failed:', error.message);
      return false;
    }
    
    console.log('✅ Database connection successful');
    return true;
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
    return false;
  }
}

async function testCandidateRecord() {
  console.log('\n📋 Testing Candidate Record...\n');
  
  const { data: candidate, error } = await supabase
    .from('candidates')
    .select('*')
    .eq('id', CANDIDATE_ID)
    .single();
  
  if (error) {
    console.error('❌ Error fetching candidate:', error.message);
    return null;
  }
  
  if (!candidate) {
    console.error('❌ Candidate not found');
    return null;
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Candidate Record:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`ID:                ${candidate.id}`);
  console.log(`Name:              ${candidate.name || '❌ MISSING'}`);
  console.log(`Nationality:       ${candidate.nationality || '❌ MISSING'}`);
  console.log(`Passport:          ${candidate.passport || '❌ MISSING'}`);
  console.log(`Passport (norm):   ${candidate.passport_normalized || '❌ MISSING'}`);
  console.log(`Passport Expiry:   ${candidate.passport_expiry || '❌ MISSING'}`);
  console.log(`Date of Birth:     ${candidate.date_of_birth || '❌ MISSING'}`);
  console.log(`Phone:             ${candidate.phone || '❌ MISSING'}`);
  console.log(`Email:             ${candidate.email || '❌ MISSING'}`);
  console.log(`Country Interest:  ${candidate.country_of_interest || '❌ MISSING'}`);
  console.log(`Created:           ${candidate.created_at}`);
  console.log(`Updated:           ${candidate.updated_at}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  return candidate;
}

async function testDocuments() {
  console.log('📄 Testing Documents...\n');
  
  const { data: documents, error } = await supabase
    .from('candidate_documents')
    .select('id, file_name, category, verification_status, extracted_identity_json, ai_processing_completed_at, created_at')
    .eq('candidate_id', CANDIDATE_ID)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('❌ Error fetching documents:', error.message);
    return [];
  }
  
  console.log(`Found ${documents.length} document(s):\n`);
  
  documents.forEach((doc, index) => {
    console.log(`Document ${index + 1}:`);
    console.log(`  File: ${doc.file_name}`);
    console.log(`  Category: ${doc.category || 'N/A'}`);
    console.log(`  Status: ${doc.verification_status || 'N/A'}`);
    console.log(`  Processed: ${doc.ai_processing_completed_at || 'N/A'}`);
    console.log(`  Created: ${doc.created_at}`);
    
    if (doc.extracted_identity_json) {
      const identity = doc.extracted_identity_json;
      console.log(`  Extracted Data:`);
      console.log(`    Name: ${identity.name || 'N/A'}`);
      console.log(`    Nationality: ${identity.nationality || 'N/A'}`);
      console.log(`    Passport: ${identity.passport_no || 'N/A'}`);
      console.log(`    Passport Expiry: ${identity.passport_expiry || identity.expiry_date || 'N/A'}`);
      console.log(`    Date of Birth: ${identity.date_of_birth || 'N/A'}`);
    } else {
      console.log(`  Extracted Data: ❌ NONE`);
    }
    console.log('');
  });
  
  return documents;
}

async function testAPIEndpoint() {
  console.log('🌐 Testing API Endpoint...\n');
  
  const API_URL = process.env.BACKEND_URL || 'http://localhost:4000';
  const url = `${API_URL}/api/candidates/${CANDIDATE_ID}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      console.error(`❌ API Error (${response.status}):`, data);
      return null;
    }
    
    console.log('✅ API Response:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Name:              ${data.name || '❌ MISSING'}`);
    console.log(`Nationality:       ${data.nationality || '❌ MISSING'}`);
    console.log(`Passport:          ${data.passport || '❌ MISSING'}`);
    console.log(`Passport Expiry:   ${data.passport_expiry || '❌ MISSING'}`);
    console.log(`Date of Birth:     ${data.date_of_birth || '❌ MISSING'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    return data;
  } catch (err) {
    console.error('❌ API request failed:', err.message);
    console.log('⚠️  Skipping API test (backend might not be running locally)\n');
    return null;
  }
}

async function checkLatestDocument() {
  console.log('🔍 Checking Latest Passport Document...\n');
  
  const { data: documents, error } = await supabase
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', CANDIDATE_ID)
    .eq('category', 'passport')
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (error || !documents || documents.length === 0) {
    console.log('❌ No passport documents found\n');
    return null;
  }
  
  const doc = documents[0];
  console.log('Latest Passport Document:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`ID: ${doc.id}`);
  console.log(`File: ${doc.file_name}`);
  console.log(`Status: ${doc.verification_status}`);
  console.log(`Category: ${doc.category}`);
  console.log(`Confidence: ${doc.confidence || 'N/A'}`);
  console.log(`Processed: ${doc.ai_processing_completed_at || 'NOT PROCESSED'}`);
  console.log(`Created: ${doc.created_at}`);
  
  if (doc.extracted_identity_json) {
    console.log('\nExtracted Identity:');
    console.log(JSON.stringify(doc.extracted_identity_json, null, 2));
  } else {
    console.log('\n❌ No extracted identity data');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  return doc;
}

async function runAllTests() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🧪 CANDIDATE DATA TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Testing candidate: ${CANDIDATE_ID} (Farhan)\n`);
  
  // Test 1: Database connection
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    console.error('❌ Cannot proceed - database connection failed');
    process.exit(1);
  }
  
  // Test 2: Candidate record
  const candidate = await testCandidateRecord();
  
  // Test 3: Documents
  const documents = await testDocuments();
  
  // Test 4: Latest passport document
  const latestPassport = await checkLatestDocument();
  
  // Test 5: API endpoint (optional)
  await testAPIEndpoint();
  
  // Summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('📊 SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  
  if (candidate) {
    const hasNationality = !!candidate.nationality;
    const hasPassport = !!candidate.passport;
    const hasExpiry = !!candidate.passport_expiry;
    const hasDOB = !!candidate.date_of_birth;
    
    console.log(`Nationality:       ${hasNationality ? '✅' : '❌ MISSING'}`);
    console.log(`Passport Number:   ${hasPassport ? '✅' : '❌ MISSING'}`);
    console.log(`Passport Expiry:   ${hasExpiry ? '✅' : '❌ MISSING'}`);
    console.log(`Date of Birth:     ${hasDOB ? '✅' : '❌ MISSING'}`);
    
    if (latestPassport && latestPassport.extracted_identity_json) {
      const identity = latestPassport.extracted_identity_json;
      console.log('\n📄 Document Has Extracted Data:');
      console.log(`  Name: ${identity.name || 'N/A'}`);
      console.log(`  Nationality: ${identity.nationality || 'N/A'}`);
      console.log(`  Passport: ${identity.passport_no || 'N/A'}`);
      console.log(`  Expiry: ${identity.passport_expiry || identity.expiry_date || 'N/A'}`);
      
      if (identity.nationality && !candidate.nationality) {
        console.log('\n⚠️  ISSUE: Document has nationality but candidate record does not!');
      }
      if (identity.passport_no && !candidate.passport) {
        console.log('\n⚠️  ISSUE: Document has passport number but candidate record does not!');
      }
      if ((identity.passport_expiry || identity.expiry_date) && !candidate.passport_expiry) {
        console.log('\n⚠️  ISSUE: Document has passport expiry but candidate record does not!');
      }
    }
  }
  
  console.log('═══════════════════════════════════════════════════════\n');
}

runAllTests().catch(console.error);
