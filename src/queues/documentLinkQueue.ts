import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('DocumentLinkQueue');

export const documentLinkQueue = new Queue('document-linking', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
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
