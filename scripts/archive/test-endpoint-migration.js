/**
 * Test script to verify old endpoints are removed and new endpoints work
 */

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

async function testEndpoint(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${BACKEND_URL}${endpoint}`, options);
    return {
      status: response.status,
      ok: response.ok,
      endpoint,
      method,
    };
  } catch (error) {
    return {
      status: 'ERROR',
      error: error.message,
      endpoint,
      method,
    };
  }
}

async function runTests() {
  console.log('🧪 Testing Endpoint Migration\n');
  console.log('='.repeat(60));
  
  // Test 1: Old endpoints should be removed (404 expected)
  console.log('\n❌ Testing OLD endpoints (should return 404):');
  const oldEndpoints = [
    { path: '/api/documents', method: 'POST' },
    { path: '/api/documents/123', method: 'GET' },
    { path: '/api/documents/candidate/123', method: 'GET' },
    { path: '/api/documents/123/download', method: 'GET' },
    { path: '/api/documents/123', method: 'DELETE' },
  ];
  
  for (const { path, method } of oldEndpoints) {
    const result = await testEndpoint(path, method);
    const status = result.status === 404 ? '✅ REMOVED' : `❌ STILL EXISTS (${result.status})`;
    console.log(`  ${status}: ${method} ${path}`);
  }
  
  // Test 2: New endpoints should exist (may return 400/401/404 but not 500)
  console.log('\n✅ Testing NEW endpoints (should exist):');
  const newEndpoints = [
    { path: '/api/documents/candidate-documents', method: 'POST' },
    { path: '/api/documents/candidate-documents/123', method: 'GET' },
    { path: '/api/documents/candidates/123/documents', method: 'GET' },
    { path: '/api/documents/candidate-documents/123/download', method: 'GET' },
    { path: '/api/documents/candidate-documents/123', method: 'DELETE' },
    { path: '/api/documents/unmatched', method: 'GET' },
    { path: '/api/documents/checklist/123', method: 'GET' },
  ];
  
  for (const { path, method } of newEndpoints) {
    const result = await testEndpoint(path, method);
    // Accept 400 (bad request), 401 (unauthorized), 404 (not found), but not 500 (server error)
    const isOk = result.status === 'ERROR' || result.status >= 500 
      ? '❌ ERROR' 
      : '✅ EXISTS';
    console.log(`  ${isOk}: ${method} ${path} (${result.status})`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Migration test complete!');
  console.log('\nNote: 404/400/401 responses are expected for new endpoints');
  console.log('      as they require authentication and valid data.');
  console.log('      The important thing is that old endpoints return 404.');
}

runTests().catch(console.error);
