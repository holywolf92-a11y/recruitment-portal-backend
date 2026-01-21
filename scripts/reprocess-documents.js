const { Queue } = require('bullmq');
const Redis = require('ioredis');
const fetch = require('node-fetch');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const BACKEND_URL = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
const QUEUE_NAME = 'document-verification';

// Candidate ID for Hamna Ghouri (you may need to update this)
const CANDIDATE_ID = process.argv[2] || '40d44087-ca8f-4db8-a2ce-43d329efc8cb';

async function reprocessDocuments() {
  console.log('\n🔄 ========================================');
  console.log('🔄 Re-processing Documents for Candidate');
  console.log('🔄 ========================================\n');
  
  console.log(`📍 Backend URL: ${BACKEND_URL}`);
  console.log(`📍 Candidate ID: ${CANDIDATE_ID}\n`);

  let redis;
  let queue;

  try {
    // Connect to Redis
    console.log('📡 Connecting to Redis...');
    redis = new Redis(REDIS_URL);
    
    await new Promise((resolve, reject) => {
      redis.once('ready', resolve);
      redis.once('error', reject);
      setTimeout(() => reject(new Error('Redis connection timeout')), 5000);
    });

    console.log('✅ Redis connected\n');

    // Get documents for candidate
    console.log('📋 Fetching documents for candidate...');
    const response = await fetch(`${BACKEND_URL}/api/documents/candidates/${CANDIDATE_ID}/documents`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch documents: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const documents = data.documents || [];

    console.log(`✅ Found ${documents.length} documents\n`);

    // Filter for documents that need reprocessing (pending_ai or needs_review)
    const documentsToReprocess = documents.filter(doc => 
      doc.verification_status === 'pending_ai' || 
      doc.verification_status === 'needs_review' ||
      doc.file_name?.includes('hamna') || 
      doc.file_name?.includes('Hamna')
    );

    if (documentsToReprocess.length === 0) {
      console.log('⚠️  No documents found that need reprocessing\n');
      return;
    }

    console.log(`📄 Documents to reprocess: ${documentsToReprocess.length}\n`);

    // Create queue
    queue = new Queue(QUEUE_NAME, { connection: redis });

    // Reprocess each document
    for (const doc of documentsToReprocess) {
      console.log(`\n🔄 Processing: ${doc.file_name}`);
      console.log(`   Document ID: ${doc.id}`);
      console.log(`   Current Status: ${doc.verification_status || 'unknown'}`);
      console.log(`   Category: ${doc.category || 'unknown'}`);

      try {
        // Get full document details
        const docResponse = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${doc.id}`);
        if (!docResponse.ok) {
          console.log(`   ❌ Failed to fetch document details: ${docResponse.status}`);
          continue;
        }

        const docData = await docResponse.json();
        const fullDoc = docData.document;

        // Create job data
        const jobData = {
          requestId: `reprocess-${Date.now()}-${doc.id}`,
          documentId: doc.id,
          candidateId: fullDoc.candidate_id || CANDIDATE_ID,
          storageBucket: 'documents',
          storagePath: fullDoc.storage_path,
          fileName: fullDoc.file_name,
          mimeType: fullDoc.mime_type || 'application/pdf',
        };

        // Add job to queue
        const job = await queue.add('verify-document', jobData, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        });

        console.log(`   ✅ Job enqueued: ${job.id}`);
        console.log(`   📊 Job will be processed by worker...`);

      } catch (error) {
        console.error(`   ❌ Error reprocessing document: ${error.message}`);
      }
    }

    console.log('\n✅ ========================================');
    console.log('✅ Reprocessing Complete');
    console.log('✅ ========================================\n');
    console.log('💡 Check Railway logs to see processing results');
    console.log('💡 Documents should update status automatically\n');

  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('❌ Error:', error.message);
    console.error('❌ ========================================\n');
  } finally {
    if (queue) {
      await queue.close();
    }
    if (redis) {
      await redis.quit();
    }
  }
}

reprocessDocuments();
