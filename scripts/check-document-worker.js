const { Queue } = require('bullmq');
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'document-verification';

async function checkWorkerStatus() {
  console.log('\n🔍 ========================================');
  console.log('🔍 Document Verification Worker Status');
  console.log('🔍 ========================================\n');
  
  console.log(`📍 Redis URL: ${REDIS_URL.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`📍 Queue Name: ${QUEUE_NAME}\n`);

  let redis;
  let queue;

  try {
    // Connect to Redis
    console.log('📡 Connecting to Redis...');
    redis = new Redis(REDIS_URL);
    
    redis.on('error', (err) => {
      console.error('❌ Redis connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('✅ Redis connected');
    });

    // Wait for connection
    await new Promise((resolve, reject) => {
      redis.once('ready', resolve);
      redis.once('error', reject);
      setTimeout(() => reject(new Error('Redis connection timeout')), 5000);
    });

    console.log('✅ Redis connection established\n');

    // Check queue
    queue = new Queue(QUEUE_NAME, { connection: redis });

    // Get queue stats
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    console.log('📊 Queue Statistics:');
    console.log(`   Waiting: ${waiting}`);
    console.log(`   Active: ${active}`);
    console.log(`   Completed: ${completed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Delayed: ${delayed}\n`);

    // Get recent jobs
    if (waiting > 0 || active > 0) {
      console.log('📋 Recent Jobs:');
      
      const waitingJobs = await queue.getWaiting(0, 10);
      const activeJobs = await queue.getActive(0, 10);
      const failedJobs = await queue.getFailed(0, 10);

      if (waitingJobs.length > 0) {
        console.log(`\n   ⏳ Waiting Jobs (${waitingJobs.length}):`);
        waitingJobs.forEach((job, idx) => {
          console.log(`      ${idx + 1}. Job ${job.id} - Document: ${job.data?.documentId || 'N/A'}`);
          console.log(`         Created: ${new Date(job.timestamp).toISOString()}`);
        });
      }

      if (activeJobs.length > 0) {
        console.log(`\n   🔄 Active Jobs (${activeJobs.length}):`);
        activeJobs.forEach((job, idx) => {
          console.log(`      ${idx + 1}. Job ${job.id} - Document: ${job.data?.documentId || 'N/A'}`);
          console.log(`         Started: ${job.processedOn ? new Date(job.processedOn).toISOString() : 'N/A'}`);
        });
      }

      if (failedJobs.length > 0) {
        console.log(`\n   ❌ Failed Jobs (${failedJobs.length}):`);
        failedJobs.forEach((job, idx) => {
          console.log(`      ${idx + 1}. Job ${job.id} - Document: ${job.data?.documentId || 'N/A'}`);
          console.log(`         Error: ${job.failedReason || 'Unknown'}`);
          console.log(`         Failed: ${job.finishedOn ? new Date(job.finishedOn).toISOString() : 'N/A'}`);
        });
      }
    }

    // Check if worker is running (by checking if there are active workers)
    const workers = await redis.keys('bull:document-verification:*:workers');
    if (workers.length > 0) {
      console.log(`\n✅ Worker appears to be running (${workers.length} worker(s) detected)`);
    } else {
      console.log('\n⚠️  No workers detected! The worker may not be running.');
      console.log('   Check that RUN_WORKER=true is set in Railway environment variables.');
    }

    console.log('\n✅ ========================================');
    console.log('✅ Diagnostic Complete');
    console.log('✅ ========================================\n');

  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('❌ Error:', error.message);
    console.error('❌ ========================================\n');
    
    if (error.message.includes('ECONNREFUSED')) {
      console.error('💡 Redis connection refused. Check:');
      console.error('   1. REDIS_URL is correct');
      console.error('   2. Redis service is running');
      console.error('   3. Network connectivity\n');
    }
  } finally {
    if (queue) {
      await queue.close();
    }
    if (redis) {
      await redis.quit();
    }
  }
}

checkWorkerStatus();
