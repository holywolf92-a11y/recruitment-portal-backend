#!/usr/bin/env node
/**
 * Clear BullMQ Queues
 * This script clears all jobs from the Redis queues
 */

import Redis from 'ioredis';
import { Queue } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL || 'redis://default:sBtnDrpJrbASwbGejzqByuCroCidLUVI@redis.railway.internal:6379';

console.log('Connecting to Redis:', REDIS_URL.replace(/:[^@]*@/, ':***@'));

const redis = new Redis(REDIS_URL);

async function clearQueues() {
  try {
    // Define all queues
    const queueNames = [
      'cv-parsing',
      'document-link',
      'cv-inbox',
      'email-processing'
    ];

    for (const queueName of queueNames) {
      console.log(`\n📋 Clearing queue: ${queueName}`);
      
      const queue = new Queue(queueName, { connection: redis });
      
      // Get counts before clearing
      const counts = await queue.getJobCounts();
      console.log(`  Before clear:`, counts);
      
      // Clear all jobs
      await queue.drain();
      await queue.obliterate({ force: true });
      
      // Get counts after clearing
      const countsAfter = await queue.getJobCounts();
      console.log(`  After clear:`, countsAfter);
      
      await queue.close();
    }

    console.log('\n✅ All queues cleared successfully!');
    
  } catch (error) {
    console.error('❌ Error clearing queues:', error);
  } finally {
    await redis.quit();
  }
}

clearQueues();
