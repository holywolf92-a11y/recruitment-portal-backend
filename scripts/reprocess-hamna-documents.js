const { Queue } = require('bullmq');
const Redis = require('ioredis');
const fetch = require('node-fetch');

const REDIS_URL = process.env.REDIS_URL || 'redis://default:IUXNckigedCSKhFdBAIFoMJyoWinkuGt@redis-w02s.railway.internal:6379';
const BACKEND_URL = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
const QUEUE_NAME = 'document-verification';

// Document IDs to reprocess
const DOCUMENT_IDS = [
  'ee157535-27f5-4147-ba4c-c2d5f44181ef', // certificate_hamna_ghouri_v2.pdf
  '878bb30e-5180-4384-9d6b-7ac65e25f82e'  // passport_hamna_ghouri_v2.pdf
];

const CANDIDATE_ID = '40d44087-ca8f-4db8-a2ce-43d329efc8cb'; // Hamna Ghouri

async function reprocessDocuments() {
  console.log('\n🔄 ========================================');
  console.log('🔄 Re-processing Hamna Ghouri Documents');
  console.log('🔄 ========================================\n');
  
  console.log(`📍 Backend URL: ${BACKEND_URL}`);
  console.log(`📍 Candidate ID: ${CANDIDATE_ID}`);
  console.log(`📍 Documents to reprocess: ${DOCUMENT_IDS.length}\n`);

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

    // Create queue
    queue = new Queue(QUEUE_NAME, { connection: redis });

    // Reprocess each document
    for (const documentId of DOCUMENT_IDS) {
      console.log(`\n🔄 Processing document: ${documentId}`);

      try {
        // Get full document details
        const docResponse = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${documentId}`);
        if (!docResponse.ok) {
          console.log(`   ❌ Failed to fetch document: ${docResponse.status} ${docResponse.statusText}`);
          continue;
        }

        const docData = await docResponse.json();
        const doc = docData.document;

        console.log(`   📄 File: ${doc.file_name}`);
        console.log(`   📊 Current Status: ${doc.verification_status}`);
        console.log(`   📁 Category: ${doc.category || 'unknown'}`);
        console.log(`   📍 Storage Path: ${doc.storage_path}`);

        // Create job data
        const requestId = `reprocess-${Date.now()}-${documentId}`;
        const jobData = {
          requestId,
          documentId: doc.id,
          candidateId: doc.candidate_id || CANDIDATE_ID,
          storageBucket: 'documents',
          storagePath: doc.storage_path,
          fileName: doc.file_name,
          mimeType: doc.mime_type || 'application/pdf',
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
        console.log(`   📊 Job will be processed with new matching logic...`);

      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
      }
    }

    console.log('\n✅ ========================================');
    console.log('✅ Reprocessing Complete');
    console.log('✅ ========================================\n');
    console.log('💡 Check Railway logs to see processing results');
    console.log('💡 Documents should update status automatically');
    console.log('💡 New matching logic should find Hamna by name\n');

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
