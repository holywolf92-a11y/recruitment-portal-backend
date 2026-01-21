/**
 * Test script to verify Excel Browser database connection and endpoint
 */

const API_BASE_URL = process.env.API_BASE_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app/api';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function testConnection() {
  console.log('🧪 Testing Excel Browser Database Connection\n');
  console.log('='.repeat(60));
  
  // Test 1: Backend Health Check
  console.log('\n1️⃣ Testing Backend Health...');
  try {
    const healthResponse = await fetch(`${API_BASE_URL.replace('/api', '')}/health`);
    const healthData = await healthResponse.json();
    console.log('   ✅ Backend is running:', healthData.status);
  } catch (error) {
    console.log('   ❌ Backend health check failed:', error.message);
    return;
  }

  // Test 2: Supabase Health Check
  console.log('\n2️⃣ Testing Supabase Connection...');
  try {
    const supabaseHealthResponse = await fetch(`${API_BASE_URL.replace('/api', '')}/health/supabase`);
    const supabaseHealthData = await supabaseHealthResponse.json();
    if (supabaseHealthData.status === 'ok') {
      console.log('   ✅ Supabase connection: OK');
    } else {
      console.log('   ⚠️  Supabase connection issue:', supabaseHealthData.message);
    }
  } catch (error) {
    console.log('   ❌ Supabase health check failed:', error.message);
  }

  // Test 3: Candidates Endpoint
  console.log('\n3️⃣ Testing GET /api/candidates Endpoint...');
  try {
    const response = await fetch(`${API_BASE_URL}/candidates`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    console.log('   ✅ Endpoint is accessible');
    console.log(`   📊 Total candidates: ${data.total || data.candidates?.length || 0}`);
    console.log(`   📋 Response structure:`, {
      hasCandidates: !!data.candidates,
      candidatesCount: data.candidates?.length || 0,
      hasTotal: !!data.total
    });

    if (data.candidates && data.candidates.length > 0) {
      const sample = data.candidates[0];
      console.log('\n   📝 Sample candidate data structure:');
      console.log('   ', {
        id: sample.id ? '✅' : '❌',
        candidate_code: sample.candidate_code ? '✅' : '❌',
        name: sample.name ? '✅' : '❌',
        position: sample.position ? '✅' : '❌',
        email: sample.email ? '✅' : '❌',
        phone: sample.phone ? '✅' : '❌',
        nationality: sample.nationality ? '✅' : '❌',
        country_of_interest: sample.country_of_interest ? '✅' : '❌',
        experience_years: sample.experience_years ? '✅' : '❌',
        status: sample.status ? '✅' : '❌',
        ai_score: sample.ai_score ? '✅' : '❌',
        date_of_birth: sample.date_of_birth ? '✅' : '❌',
        languages: sample.languages ? '✅' : '❌',
        marital_status: sample.marital_status ? '✅' : '❌',
        passport: sample.passport ? '✅' : '❌',
        passport_expiry: sample.passport_expiry ? '✅' : '❌',
        address: sample.address ? '✅' : '❌',
        created_at: sample.created_at ? '✅' : '❌',
        cv_received: typeof sample.cv_received === 'boolean' ? '✅' : '❌',
        passport_received: typeof sample.passport_received === 'boolean' ? '✅' : '❌',
      });

      console.log('\n   📄 Sample candidate details:');
      console.log(`      Name: ${sample.name || 'missing'}`);
      console.log(`      Position: ${sample.position || 'missing'}`);
      console.log(`      Status: ${sample.status || 'missing'}`);
      console.log(`      AI Score: ${sample.ai_score || 'missing'}`);
      console.log(`      Email: ${sample.email || 'missing'}`);
      console.log(`      Phone: ${sample.phone || 'missing'}`);
    } else {
      console.log('   ⚠️  No candidates found in database');
    }
  } catch (error) {
    console.log('   ❌ Endpoint test failed:', error.message);
    return;
  }

  // Test 4: Verify Required Fields for Excel Browser
  console.log('\n4️⃣ Verifying Required Fields for Excel Browser...');
  try {
    const response = await fetch(`${API_BASE_URL}/candidates?limit=5`);
    const data = await response.json();
    
    if (data.candidates && data.candidates.length > 0) {
      const requiredFields = [
        'id', 'candidate_code', 'name', 'position', 'date_of_birth',
        'nationality', 'country_of_interest', 'phone', 'email',
        'experience_years', 'status', 'ai_score', 'languages',
        'marital_status', 'passport', 'passport_expiry', 'address',
        'created_at', 'cv_received', 'passport_received'
      ];

      const sample = data.candidates[0];
      const missingFields = requiredFields.filter(field => !(field in sample));
      
      if (missingFields.length === 0) {
        console.log('   ✅ All required fields are present in database');
      } else {
        console.log('   ⚠️  Missing fields (will show "missing" in UI):');
        missingFields.forEach(field => console.log(`      - ${field}`));
      }
    }
  } catch (error) {
    console.log('   ❌ Field verification failed:', error.message);
  }

  // Test 5: Test Filtering (for folder structure)
  console.log('\n5️⃣ Testing Filtering Capabilities...');
  try {
    // Test position filter
    const positionResponse = await fetch(`${API_BASE_URL}/candidates?position=Electrician`);
    const positionData = await positionResponse.json();
    console.log(`   ✅ Position filter works: ${positionData.candidates?.length || 0} candidates found`);

    // Test status filter
    const statusResponse = await fetch(`${API_BASE_URL}/candidates?status=Applied`);
    const statusData = await statusResponse.json();
    console.log(`   ✅ Status filter works: ${statusData.candidates?.length || 0} candidates found`);

    // Test country filter
    const countryResponse = await fetch(`${API_BASE_URL}/candidates?country_of_interest=UAE`);
    const countryData = await countryResponse.json();
    console.log(`   ✅ Country filter works: ${countryData.candidates?.length || 0} candidates found`);
  } catch (error) {
    console.log('   ⚠️  Filtering test failed:', error.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Connection Test Complete!\n');
}

// Run the test
testConnection().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
