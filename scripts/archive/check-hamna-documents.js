/**
 * Check all documents for Hamna Ghouri to see what's actually in the database
 */

const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
const CANDIDATE_ID = '40d44087-ca8f-4db8-a2ce-43d329efc8cb'; // Hamna Ghouri

async function checkDocuments() {
  console.log('\n🔍 Checking All Documents for Hamna Ghouri');
  console.log('==========================================\n');

  try {
    // Get all candidate documents
    const response = await axios.get(
      `${BACKEND_URL}/api/documents/candidates/${CANDIDATE_ID}/documents`
    );

    const documents = response.data.documents || [];
    
    console.log(`📄 Found ${documents.length} documents:\n`);
    
    documents.forEach((doc, index) => {
      console.log(`${index + 1}. ${doc.file_name}`);
      console.log(`   ID: ${doc.id}`);
      console.log(`   Category: ${doc.category || 'N/A'}`);
      console.log(`   Status: ${doc.verification_status || 'N/A'}`);
      console.log(`   Created: ${doc.created_at || 'N/A'}`);
      console.log('');
    });
    
    // Check for certificates specifically
    const certificates = documents.filter(d => 
      (d.category && (d.category.toLowerCase().includes('cert') || d.category.toLowerCase().includes('certificate'))) ||
      (d.file_name && d.file_name.toLowerCase().includes('cert'))
    );
    
    if (certificates.length > 0) {
      console.log(`\n📜 Found ${certificates.length} certificate document(s):\n`);
      certificates.forEach(cert => {
        console.log(`   - ${cert.file_name} (ID: ${cert.id})`);
      });
      console.log('\n💡 These certificate documents are still in the database.');
      console.log('   If you deleted one, it might not have been fully deleted, or there are multiple certificates.');
    } else {
      console.log('\n✅ No certificate documents found in candidate_documents table.');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

checkDocuments();
