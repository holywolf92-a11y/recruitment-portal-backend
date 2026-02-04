/**
 * Fix Hamna Ghouri's certificate flag after deletion
 * This will recalculate and update all document flags based on actual documents
 */

const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
const CANDIDATE_ID = '40d44087-ca8f-4db8-a2ce-43d329efc8cb'; // Hamna Ghouri

async function fixCertificateFlag() {
  console.log('\n🔧 Fixing Hamna Ghouri Certificate Flag');
  console.log('==========================================\n');

  try {
    console.log(`📡 Calling update-document-flags endpoint for candidate ${CANDIDATE_ID}...`);
    
    const response = await axios.post(
      `${BACKEND_URL}/api/candidates/${CANDIDATE_ID}/update-document-flags`
    );

    console.log('✅ Success!\n');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
    if (response.data.flags) {
      console.log('\n📋 Updated Flags:');
      response.data.flags.forEach(flag => {
        console.log(`   - ${flag}`);
      });
    }
    
    if (response.data.found_documents) {
      console.log('\n📄 Found Documents:');
      response.data.found_documents.forEach(doc => {
        console.log(`   - ${doc}`);
      });
    }
    
    console.log(`\n📊 Total Documents: ${response.data.total_documents || 0}`);
    
    // Check if certificate_received is in the flags
    if (response.data.found_documents) {
      const hasCertificate = response.data.found_documents.some(d => 
        d.toLowerCase().includes('certificate') || d.toLowerCase().includes('cert')
      );
      
      if (!hasCertificate) {
        console.log('\n✅ Certificate flag should now be FALSE (no certificate found)');
      } else {
        console.log('\n⚠️  Certificate still found in documents!');
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

fixCertificateFlag();
