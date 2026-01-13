// Clear Redis BullMQ Queues
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://default:sBtnDrpJrbASwbGejzqByuCroCidLUVI@shuttle.proxy.rlwy.net:41056';

console.log('🔌 Connecting to Redis...');
console.log('Redis URL:', REDIS_URL.replace(/:[^@]*@/, ':***@'));

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

redis.on('connect', () => {
  console.log('✅ Connected to Redis');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

async function clearQueues() {
  try {
    console.log('\n🧹 Clearing all BullMQ queue data...\n');

    // Get current DB size
    const sizeBefore = await redis.dbsize();
    console.log(`📊 Database size before: ${sizeBefore} keys`);

    // Get all BullMQ keys
    const keys = await redis.keys('bull:*');
    console.log(`📝 Found ${keys.length} BullMQ keys`);

    if (keys.length > 0) {
      console.log('\n🗑️  Deleting BullMQ keys...');
      await redis.del(...keys);
      console.log(`✅ Deleted ${keys.length} keys`);
    }

    // Get final DB size
    const sizeAfter = await redis.dbsize();
    console.log(`📊 Database size after: ${sizeAfter} keys`);

    console.log('\n✅ Queues cleared successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Verify backend worker is running');
    console.log('   2. Try uploading a CV');
    console.log('   3. Job should process: queued → processing → completed');

  } catch (error) {
    console.error('❌ Error clearing queues:', error);
  } finally {
    await redis.quit();
    console.log('\n👋 Disconnected from Redis');
  }
}

clearQueues().catch(console.error);
