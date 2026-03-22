"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentLinkQueue = void 0;
exports.enqueueDocumentLink = enqueueDocumentLink;
const bullmq_1 = require("bullmq");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('DocumentLinkQueue');
const JOB_OPTIONS = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
};
// Lazy singleton — only connects Redis when first job is actually enqueued
let _queue;
function getQueue() {
    if (!_queue) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { redis } = require('../config/redis');
        _queue = new bullmq_1.Queue('document-linking', { connection: redis, defaultJobOptions: JOB_OPTIONS });
    }
    return _queue;
}
/** Kept for any code that references the queue object directly */
exports.documentLinkQueue = new Proxy({}, {
    get(_t, prop) { return getQueue()[prop]; },
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
