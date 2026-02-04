/**
 * Delete Hamna Ghouri's certificate document
 */

const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
const CERTIFICATE_DOCUMENT_ID = '75b16737-b981-4e0a-8ba1-9b450ab01fda'; // certificate_hamna_ghouri_v2.pdf
const CANDIDATE_ID = '40d44087-ca8f-4db8-a2ce-43d329efc8cb'; // Hamna Ghouri

async function deleteCertificate() {
  console.log('\n🗑️  Deleting Hamna Ghouri Certificate');
  console.log('======================================\n');

  try {
    console.log(`📡 Deleting document ${CERTIFICATE_DOCUMENT_ID}...`);
    
    const deleteResponse = await axios.delete(
      `${BACKEND_URL}/api/documents/candidate-documents/${CERTIFICATE_DOCUMENT_ID}`
    );

    console.log('✅ Document deleted successfully!\n');
    console.log('Response:', JSON.stringify(deleteResponse.data, null, 2));
    
    // Wait a moment for backend to update flags
    console.log('\n⏳ Waiting for backend to update flags...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Now update flags
    console.log('📡 Updating document flags...');
    const flagResponse = await axios.post(
      `${BACKEND_URL}/api/candidates/${CANDIDATE_ID}/update-document-flags`
    );

    console.log('\n✅ Flags updated!\n');
    console.log('Response:', JSON.stringify(flagResponse.data, null, 2));
    
    if (flagResponse.data.found_documents) {
      console.log('\n📄 Remaining Documents:');
      flagResponse.data.found_documents.forEach(doc => {
        console.log(`   - ${doc}`);
      });
      
      const hasCertificate = flagResponse.data.found_documents.some(d => 
        d.toLowerCase().includes('certificate') || d.toLowerCase().includes('cert')
      );
      
      if (!hasCertificate) {
        console.log('\n✅ Certificate flag is now FALSE (no certificate found)');
      } else {
        console.log('\n⚠️  Certificate still found!');
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

deleteCertificate();
