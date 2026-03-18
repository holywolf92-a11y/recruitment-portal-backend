import { Queue } from 'bullmq';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('DocumentLinkQueue');

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

// Lazy singleton — only connects Redis when first job is actually enqueued
let _queue: Queue | undefined;
function getQueue(): Queue {
  if (!_queue) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { redis } = require('../config/redis') as { redis: import('ioredis').default };
    _queue = new Queue('document-linking', { connection: redis, defaultJobOptions: JOB_OPTIONS });
  }
  return _queue;
}

/** Kept for any code that references the queue object directly */
export const documentLinkQueue = new Proxy({} as Queue, {
  get(_t, prop: string | symbol) { return (getQueue() as any)[prop]; },
});

export async function enqueueDocumentLink(attachmentId: string): Promise<void> {
  try {
    await documentLinkQueue.add(
      'link-document',
      { attachmentId },
      {
        jobId: `doc-link-${attachmentId}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    logger.info(`Enqueued document link job`, { attachmentId });
  } catch (error: any) {
    logger.error(`Failed to enqueue document link`, { attachmentId, error: error.message });
    throw error;
  }
}
