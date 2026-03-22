/**
 * Test script to process CV file and verify extraction
 * Tests the new CV processing code with actual CV file
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CV_FILE_PATH = path.join(__dirname, '../../FARHAN (1).pdf');
const PY_URL = process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-python-parser-production.up.railway.app';
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET;

if (!HMAC_SECRET) {
  console.error('❌ Missing PYTHON_HMAC_SECRET environment variable');
  process.exit(1);
}

function signHmac(body) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

async function testCVProcessing() {
  console.log('\n🧪 Testing CV Processing with New Code\n');
  console.log(`CV File: ${CV_FILE_PATH}`);
  console.log(`Python Parser URL: ${PY_URL}\n`);

  // Check if file exists
  if (!fs.existsSync(CV_FILE_PATH)) {
    console.error(`❌ CV file not found: ${CV_FILE_PATH}`);
    console.log('\n💡 Make sure the CV file is in the correct location');
    process.exit(1);
  }

  // Read and encode file
  console.log('📄 Reading CV file...');
  const fileBuffer = fs.readFileSync(CV_FILE_PATH);
  const fileBase64 = fileBuffer.toString('base64');
  const fileName = path.basename(CV_FILE_PATH);
  const fileSize = (fileBuffer.length / 1024).toFixed(2);
  
  console.log(`✅ File read: ${fileName} (${fileSize} KB)`);
  console.log(`✅ Base64 encoded: ${(fileBase64.length / 1024).toFixed(2)} KB\n`);

  // Test 1: Parse CV (professional fields)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 1: Parse CV (Professional Fields)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const parsePayload = JSON.stringify({
      file_content: fileBase64,
      file_name: fileName,
      mime_type: 'application/pdf',
    });

    const parseRes = await fetch(`${PY_URL}/parse-cv`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': signHmac(parsePayload),
      },
      body: parsePayload,
    });

    if (!parseRes.ok) {
      const errorText = await parseRes.text();
      console.error(`❌ Parse CV failed (${parseRes.status}):`, errorText.slice(0, 300));
      return;
    }

    const parsed = await parseRes.json();
    const candidate = parsed.candidate || parsed;

    console.log('✅ CV Parsed Successfully!');
    console.log('\nProfessional Fields:');
    console.log(`  Name: ${candidate.full_name || '❌ MISSING'}`);
    console.log(`  Email: ${candidate.email || '❌ MISSING'}`);
    console.log(`  Phone: ${candidate.phone || '❌ MISSING'}`);
    console.log(`  Position: ${candidate.position || '❌ MISSING'}`);
    console.log(`  Nationality: ${candidate.nationality || '❌ MISSING'}`);
    console.log(`  Experience: ${candidate.experience_years || '❌ MISSING'} years`);
    console.log(`  Country of Interest: ${candidate.country_of_interest || '❌ MISSING'}\n`);
  } catch (error) {
    console.error('❌ Error parsing CV:', error.message);
    return;
  }

  // Test 2: Categorize Document (Identity Fields)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 2: Categorize Document (Identity Fields)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const categorizePayload = JSON.stringify({
      file_content: fileBase64,
      file_name: fileName,
      mime_type: 'application/pdf',
    });

    const categorizeRes = await fetch(`${PY_URL}/categorize-document`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': signHmac(categorizePayload),
      },
      body: categorizePayload,
    });

    if (!categorizeRes.ok) {
      const errorText = await categorizeRes.text();
      console.error(`❌ Categorize Document failed (${categorizeRes.status}):`, errorText.slice(0, 300));
      return;
    }

    const categorizeResult = await categorizeRes.json();
    const identityFields = categorizeResult.identity_fields || {};

    console.log('✅ Document Categorized Successfully!');
    console.log(`  Category: ${categorizeResult.category || 'N/A'}`);
    console.log(`  Confidence: ${(categorizeResult.confidence * 100).toFixed(1)}%\n`);

    console.log('Identity Fields Extracted:');
    console.log(`  Name: ${identityFields.name || '❌ MISSING'}`);
    console.log(`  Father Name: ${identityFields.father_name || '❌ MISSING'}`);
    console.log(`  CNIC: ${identityFields.cnic || '❌ MISSING'}`);
    console.log(`  Passport: ${identityFields.passport_no || '❌ MISSING'}`);
    console.log(`  Date of Birth: ${identityFields.date_of_birth || identityFields.dob || '❌ MISSING'}`);
    console.log(`  Nationality: ${identityFields.nationality || '❌ MISSING'}`);
    console.log(`  Email: ${identityFields.email || '❌ MISSING'}`);
    console.log(`  Phone: ${identityFields.phone || '❌ MISSING'}\n`);

    // Summary
    const hasAllFields = 
      identityFields.name &&
      identityFields.father_name &&
      identityFields.cnic &&
      identityFields.passport_no &&
      (identityFields.date_of_birth || identityFields.dob) &&
      identityFields.nationality;

    if (hasAllFields) {
      console.log('✅ SUCCESS: All identity fields extracted!');
    } else {
      console.log('⚠️  WARNING: Some identity fields are missing');
      console.log('   Expected: Father Name, CNIC, Passport, DOB, Nationality');
    }
  } catch (error) {
    console.error('❌ Error categorizing document:', error.message);
    return;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ CV Processing Test Complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

testCVProcessing().catch(console.error);
