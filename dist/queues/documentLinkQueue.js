"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentLinkQueue = void 0;
exports.enqueueDocumentLink = enqueueDocumentLink;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('DocumentLinkQueue');
exports.documentLinkQueue = new bullmq_1.Queue('document-linking', {
    connection: redis_1.redis,
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
async function enqueueDocumentLink(attachmentId) {
    try {
        await exports.documentLinkQueue.add('link-document', { attachmentId }, {
            jobId: `doc-link-${attachmentId}`,
            removeOnComplete: true,
            removeOnFail: false,
        });
        logger.info(`Enqueued document link job`, { attachmentId });
    }
    catch (error) {
        logger.error(`Failed to enqueue document link`, { attachmentId, error: error.message });
        throw error;
    }
}
