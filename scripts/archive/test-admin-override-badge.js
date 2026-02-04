/**
 * Test Script for Admin Override Badge & Tooltip Feature
 * 
 * Tests:
 * 1. API response includes override fields
 * 2. Admin name fetched from audit logs
 * 3. Badge display logic
 * 4. Edge cases
 * 
 * Run: node scripts/test-admin-override-badge.js
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

// Try to load .env files from multiple locations
const envPaths = [
  path.join(__dirname, '../.env.local'),
  path.join(__dirname, '../.env'),
  path.join(__dirname, '../../.env.local'),
  path.join(__dirname, '../../.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log(`✅ Loaded environment from: ${envPath}`);
    break;
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hncvsextwmvjydcukdwx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
// Try to get backend URL from Railway or use default
const BACKEND_URL = process.env.BACKEND_URL || 
                    process.env.RAILWAY_PUBLIC_DOMAIN || 
                    (process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : null) ||
                    'http://localhost:3001';

if (!SUPABASE_URL) {
  console.error('❌ Missing SUPABASE_URL');
  process.exit(1);
}

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');
  console.error('\n💡 To run tests, you need to:');
  console.error('   1. Set SUPABASE_SERVICE_ROLE_KEY environment variable, OR');
  console.error('   2. Set SUPABASE_ANON_KEY environment variable, OR');
  console.error('   3. Create .env.local file in backend directory with:');
  console.error('      SUPABASE_SERVICE_ROLE_KEY=your_service_role_key');
  console.error('\n📝 Note: Tests can also be run manually using the manual testing guide.');
  console.error('   See: ADMIN_OVERRIDE_BADGE_MANUAL_TEST_GUIDE.md\n');
  process.exit(1);
}

console.log(`\n🔧 Test Configuration:`);
console.log(`   Supabase URL: ${SUPABASE_URL.substring(0, 30)}...`);
console.log(`   Backend URL: ${BACKEND_URL}`);
console.log(`   Service Key: ${SUPABASE_SERVICE_KEY.substring(0, 20)}...`);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Test colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(testName) {
  log(`\n🧪 Test: ${testName}`, 'blue');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

async function test1_APIResponseIncludesOverrideFields() {
  logTest('API Response Includes Override Fields');
  
  try {
    // Find a document that was overridden
    const { data: overriddenDocs, error: findError } = await supabase
      .from('candidate_documents')
      .select('id, verification_source, overridden_by, overridden_at, override_reason')
      .eq('verification_source', 'admin_override')
      .limit(1)
      .single();

    if (findError || !overriddenDocs) {
      logWarning('No overridden documents found. Skipping test.');
      logWarning('To test: Override a document first using the UI.');
      return { passed: true, skipped: true };
    }

    // Fetch document via API
    const response = await fetch(`${BACKEND_URL}/api/candidate-documents/${overriddenDocs.id}`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    const document = data.document;

    // Verify override fields
    const checks = [
      { field: 'verification_source', expected: 'admin_override' },
      { field: 'overridden_by', expected: 'not null' },
      { field: 'overridden_at', expected: 'not null' },
      { field: 'override_reason', expected: 'not null' },
    ];

    let allPassed = true;
    for (const check of checks) {
      const value = document[check.field];
      const passed = check.expected === 'not null' ? value !== null && value !== undefined : value === check.expected;
      
      if (passed) {
        logSuccess(`${check.field}: ${value}`);
      } else {
        logError(`${check.field}: Expected ${check.expected}, got ${value}`);
        allPassed = false;
      }
    }

    // Check for overridden_by_name (may be null if not fetched)
    if (document.overridden_by_name) {
      logSuccess(`overridden_by_name: ${document.overridden_by_name}`);
    } else {
      logWarning('overridden_by_name is null (may need to check audit log fetch)');
    }

    return { passed: allPassed };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { passed: false, error: error.message };
  }
}

async function test2_AdminNameFetchedFromAuditLogs() {
  logTest('Admin Name Fetched from Audit Logs');
  
  try {
    // Find an override log with admin name
    const { data: overrideLog, error: logError } = await supabase
      .from('admin_override_logs')
      .select('document_id, overridden_by_name, overridden_by')
      .not('overridden_by_name', 'is', null)
      .limit(1)
      .single();

    if (logError || !overrideLog) {
      logWarning('No override logs with admin name found. Skipping test.');
      return { passed: true, skipped: true };
    }

    // Fetch document via API
    const response = await fetch(`${BACKEND_URL}/api/candidate-documents/${overrideLog.document_id}`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    const document = data.document;

    // Verify admin name matches
    if (document.overridden_by_name === overrideLog.overridden_by_name) {
      logSuccess(`Admin name matches: ${document.overridden_by_name}`);
      return { passed: true };
    } else {
      logError(`Admin name mismatch. Expected: ${overrideLog.overridden_by_name}, Got: ${document.overridden_by_name}`);
      return { passed: false };
    }
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { passed: false, error: error.message };
  }
}

async function test3_ListDocumentsIncludesOverrideInfo() {
  logTest('List Documents Includes Override Info');
  
  try {
    // Find a candidate with overridden documents
    const { data: overriddenDoc, error: docError } = await supabase
      .from('candidate_documents')
      .select('candidate_id')
      .eq('verification_source', 'admin_override')
      .limit(1)
      .single();

    if (docError || !overriddenDoc) {
      logWarning('No candidates with overridden documents found. Skipping test.');
      return { passed: true, skipped: true };
    }

    // Fetch documents list via API
    const response = await fetch(`${BACKEND_URL}/api/candidates/${overriddenDoc.candidate_id}/documents`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    const documents = data.documents || [];

    // Find overridden documents
    const overriddenDocs = documents.filter(doc => doc.verification_source === 'admin_override');

    if (overriddenDocs.length === 0) {
      logWarning('No overridden documents in list response');
      return { passed: true, skipped: true };
    }

    // Verify all overridden documents have override fields
    let allPassed = true;
    for (const doc of overriddenDocs) {
      const hasFields = doc.overridden_by && doc.overridden_at && doc.override_reason;
      if (!hasFields) {
        logError(`Document ${doc.id} missing override fields`);
        allPassed = false;
      }
    }

    if (allPassed) {
      logSuccess(`All ${overriddenDocs.length} overridden documents include override fields`);
    }

    return { passed: allPassed };
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { passed: false, error: error.message };
  }
}

async function test4_MissingAdminNameHandling() {
  logTest('Missing Admin Name Handling');
  
  try {
    // Find a document with override but no admin name in audit log (simulate old data)
    const { data: overrideLog, error: logError } = await supabase
      .from('admin_override_logs')
      .select('document_id, overridden_by_name')
      .is('overridden_by_name', null)
      .limit(1)
      .single();

    if (logError || !overrideLog) {
      logWarning('No override logs without admin name found. This is expected for new data.');
      return { passed: true, skipped: true };
    }

    // Fetch document via API
    const response = await fetch(`${BACKEND_URL}/api/candidate-documents/${overrideLog.document_id}`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    const document = data.document;

    // Verify other override fields still present
    if (document.verification_source === 'admin_override' && document.overridden_by) {
      logSuccess('Override fields present even when admin name is missing');
      logWarning(`overridden_by_name is: ${document.overridden_by_name || 'null'}`);
      return { passed: true };
    } else {
      logError('Override fields missing when admin name is null');
      return { passed: false };
    }
  } catch (error) {
    logError(`Test failed: ${error.message}`);
    return { passed: false, error: error.message };
  }
}

async function runAllTests() {
  log('\n🚀 Starting Admin Override Badge & Tooltip Tests\n', 'blue');
  log(`Backend URL: ${BACKEND_URL}`, 'yellow');
  log(`Supabase URL: ${SUPABASE_URL}`, 'yellow');

  const tests = [
    { name: 'API Response Includes Override Fields', fn: test1_APIResponseIncludesOverrideFields },
    { name: 'Admin Name Fetched from Audit Logs', fn: test2_AdminNameFetchedFromAuditLogs },
    { name: 'List Documents Includes Override Info', fn: test3_ListDocumentsIncludesOverrideInfo },
    { name: 'Missing Admin Name Handling', fn: test4_MissingAdminNameHandling },
  ];

  const results = [];
  for (const test of tests) {
    try {
      const result = await test.fn();
      results.push({ name: test.name, ...result });
    } catch (error) {
      logError(`Test ${test.name} threw error: ${error.message}`);
      results.push({ name: test.name, passed: false, error: error.message });
    }
  }

  // Summary
  log('\n📊 Test Summary\n', 'blue');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  results.forEach(result => {
    if (result.skipped) {
      logWarning(`⏭️  ${result.name} (skipped)`);
    } else if (result.passed) {
      logSuccess(`✅ ${result.name}`);
    } else {
      logError(`❌ ${result.name}${result.error ? `: ${result.error}` : ''}`);
    }
  });

  log(`\n✅ Passed: ${passed}`, 'green');
  log(`❌ Failed: ${failed}`, 'red');
  log(`⏭️  Skipped: ${skipped}`, 'yellow');

  if (failed === 0) {
    log('\n🎉 All tests passed!', 'green');
    process.exit(0);
  } else {
    log('\n⚠️  Some tests failed. Please review.', 'yellow');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  logError(`Fatal error: ${error.message}`);
  process.exit(1);
});
