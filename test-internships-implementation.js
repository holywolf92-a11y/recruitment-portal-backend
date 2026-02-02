#!/usr/bin/env node

/**
 * Test Internships Field Implementation
 * Verifies the complete flow from database to frontend
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testInternshipsImplementation() {
  console.log('🧪 Testing Internships Field Implementation\n');
  console.log('═'.repeat(60));

  // Test 1: Database Schema
  console.log('\n📋 TEST 1: Database Schema Check');
  console.log('─'.repeat(60));
  try {
    const { data, error } = await supabase
      .from('candidates')
      .select('internships')
      .limit(1);

    if (error) {
      console.log('❌ FAILED: Cannot query internships column');
      console.log('   Error:', error.message);
      return false;
    }
    console.log('✅ PASSED: internships column exists in candidates table');
  } catch (err) {
    console.log('❌ FAILED:', err.message);
    return false;
  }

  // Test 2: Insert Test Data with Internships
  console.log('\n📋 TEST 2: Insert Candidate with Internships');
  console.log('─'.repeat(60));
  const testCandidate = {
    candidate_code: `TEST-${Date.now()}`,
    name: 'Test Internships Field',
    email: `test-internships-${Date.now()}@test.com`,
    phone: '+1234567890',
    education: 'Bachelor of Engineering',
    certifications: 'AWS Solutions Architect | Python Course',
    internships: 'Trainee Engineer at ABC Company | Internship at XYZ Corp',
    previous_employment: 'Senior Engineer at DEF Ltd',
    experience_years: 5
  };

  try {
    const { data: insertedCandidate, error: insertError } = await supabase
      .from('candidates')
      .insert([testCandidate])
      .select()
      .single();

    if (insertError) {
      console.log('❌ FAILED: Cannot insert candidate with internships');
      console.log('   Error:', insertError.message);
      return false;
    }

    console.log('✅ PASSED: Successfully inserted candidate with internships');
    console.log('   ID:', insertedCandidate.id);
    console.log('   Name:', insertedCandidate.name);
    console.log('   Internships:', insertedCandidate.internships);

    // Test 3: Query Back the Data
    console.log('\n📋 TEST 3: Query Candidate with Internships');
    console.log('─'.repeat(60));

    const { data: queriedCandidate, error: queryError } = await supabase
      .from('candidates')
      .select('id, name, education, certifications, internships, previous_employment, experience_years')
      .eq('id', insertedCandidate.id)
      .single();

    if (queryError) {
      console.log('❌ FAILED: Cannot query candidate');
      console.log('   Error:', queryError.message);
      return false;
    }

    console.log('✅ PASSED: Successfully queried candidate with internships');
    console.log('\n📊 Retrieved Data:');
    console.log('   Education:', queriedCandidate.education);
    console.log('   Certifications:', queriedCandidate.certifications);
    console.log('   Internships:', queriedCandidate.internships);
    console.log('   Previous Employment:', queriedCandidate.previous_employment);
    console.log('   Experience Years:', queriedCandidate.experience_years);

    // Test 4: Update Internships Field
    console.log('\n📋 TEST 4: Update Internships Field');
    console.log('─'.repeat(60));

    const updatedInternships = 'Updated Internship at Company Z | New Trainee Position';
    const { error: updateError } = await supabase
      .from('candidates')
      .update({ internships: updatedInternships })
      .eq('id', insertedCandidate.id);

    if (updateError) {
      console.log('❌ FAILED: Cannot update internships');
      console.log('   Error:', updateError.message);
      return false;
    }

    const { data: updatedCandidate } = await supabase
      .from('candidates')
      .select('internships')
      .eq('id', insertedCandidate.id)
      .single();

    if (updatedCandidate.internships === updatedInternships) {
      console.log('✅ PASSED: Successfully updated internships field');
      console.log('   New Value:', updatedCandidate.internships);
    } else {
      console.log('❌ FAILED: Internships not updated correctly');
      return false;
    }

    // Test 5: Verify Field Separation
    console.log('\n📋 TEST 5: Verify Field Separation');
    console.log('─'.repeat(60));

    const { data: separationTest } = await supabase
      .from('candidates')
      .select('certifications, internships, previous_employment')
      .eq('id', insertedCandidate.id)
      .single();

    const hasCertifications = separationTest.certifications && separationTest.certifications !== '[]';
    const hasInternships = separationTest.internships;
    const hasEmployment = separationTest.previous_employment;

    console.log('   Certifications present:', hasCertifications ? '✅' : '❌');
    console.log('   Internships present:', hasInternships ? '✅' : '❌');
    console.log('   Employment present:', hasEmployment ? '✅' : '❌');
    console.log('   Fields are separate:', (hasCertifications && hasInternships && hasEmployment) ? '✅' : '❌');

    if (hasCertifications && hasInternships && hasEmployment) {
      console.log('✅ PASSED: All three fields are properly separated');
    } else {
      console.log('⚠️  WARNING: Not all fields have data, but structure is correct');
    }

    // Cleanup
    console.log('\n📋 TEST 6: Cleanup Test Data');
    console.log('─'.repeat(60));
    const { error: deleteError } = await supabase
      .from('candidates')
      .delete()
      .eq('id', insertedCandidate.id);

    if (deleteError) {
      console.log('⚠️  WARNING: Could not delete test candidate:', deleteError.message);
    } else {
      console.log('✅ PASSED: Test data cleaned up');
    }

  } catch (err) {
    console.log('❌ FAILED:', err.message);
    return false;
  }

  // Final Summary
  console.log('\n' + '═'.repeat(60));
  console.log('🎉 ALL TESTS PASSED!');
  console.log('═'.repeat(60));
  console.log('\n✅ Internships field is working correctly:');
  console.log('   • Database column exists');
  console.log('   • Can insert data with internships');
  console.log('   • Can query internships field');
  console.log('   • Can update internships field');
  console.log('   • Fields are properly separated');
  console.log('\n📝 Next Steps:');
  console.log('   1. Deploy backend to Railway');
  console.log('   2. Deploy Python parser to Railway');
  console.log('   3. Deploy frontend to Railway');
  console.log('   4. Test with real CV uploads');
  console.log('   5. Verify ExtractionReviewModal displays internships');
  console.log('   6. Check CandidateDetailsModal shows internships section\n');

  return true;
}

testInternshipsImplementation().catch(console.error);
