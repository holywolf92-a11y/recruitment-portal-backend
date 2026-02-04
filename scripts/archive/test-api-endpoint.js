/**
 * Test API endpoint to verify candidate data
 * Uses Railway backend URL or localhost
 */

const CANDIDATE_ID = 'f6773426-f1e3-4e26-bfc7-ff385c118b4a'; // Farhan

// Try Railway URL first, then localhost
const BACKEND_URL = process.env.BACKEND_URL || 
                    'https://recruitment-portal-backend-production-d1f7.up.railway.app' ||
                    'http://localhost:4000';

async function testCandidateEndpoint() {
  console.log('\n🧪 Testing Candidate API Endpoint\n');
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log(`Candidate ID: ${CANDIDATE_ID}\n`);
  
  const url = `${BACKEND_URL}/api/candidates/${CANDIDATE_ID}`;
  
  try {
    console.log(`Fetching: ${url}\n`);
    const response = await fetch(url);
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ API Error (${response.status}):`, text);
      return null;
    }
    
    const candidate = await response.json();
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Candidate Data from API:');
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
    
    // Summary
    const hasNationality = !!candidate.nationality;
    const hasPassport = !!candidate.passport;
    const hasExpiry = !!candidate.passport_expiry;
    const hasDOB = !!candidate.date_of_birth;
    
    console.log('📊 Summary:');
    console.log(`  Nationality:     ${hasNationality ? '✅' : '❌ MISSING'}`);
    console.log(`  Passport #:      ${hasPassport ? '✅' : '❌ MISSING'}`);
    console.log(`  Passport Expiry: ${hasExpiry ? '✅' : '❌ MISSING'}`);
    console.log(`  Date of Birth:   ${hasDOB ? '✅' : '❌ MISSING'}\n`);
    
    if (!hasNationality || !hasPassport || !hasExpiry) {
      console.log('⚠️  WARNING: Some passport fields are missing in candidate record!');
      console.log('   This means the update process is not working correctly.\n');
    } else {
      console.log('✅ All passport fields are present!\n');
    }
    
    return candidate;
  } catch (err) {
    console.error('❌ API request failed:', err.message);
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      console.log('\n💡 Tip: Make sure the backend is running and accessible');
      console.log('   - Check Railway deployment status');
      console.log('   - Verify BACKEND_URL is correct');
      console.log('   - Try accessing the URL in a browser\n');
    }
    return null;
  }
}

async function testCandidatesListEndpoint() {
  console.log('\n🧪 Testing Candidates List API Endpoint\n');
  
  const url = `${BACKEND_URL}/api/candidates?search=Farhan`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ API Error (${response.status}):`, text);
      return null;
    }
    
    const data = await response.json();
    const candidates = data.candidates || [];
    const farhan = candidates.find(c => c.id === CANDIDATE_ID);
    
    if (farhan) {
      console.log('✅ Found Farhan in candidates list');
      console.log(`   Nationality: ${farhan.nationality || '❌ MISSING'}`);
      console.log(`   Passport: ${farhan.passport || '❌ MISSING'}`);
      console.log(`   Passport Expiry: ${farhan.passport_expiry || '❌ MISSING'}\n`);
    } else {
      console.log('⚠️  Farhan not found in candidates list\n');
    }
    
    return farhan;
  } catch (err) {
    console.error('❌ API request failed:', err.message);
    return null;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🧪 API ENDPOINT TEST SUITE');
  console.log('═══════════════════════════════════════════════════════\n');
  
  await testCandidateEndpoint();
  await testCandidatesListEndpoint();
  
  console.log('═══════════════════════════════════════════════════════\n');
}

runTests().catch(console.error);
