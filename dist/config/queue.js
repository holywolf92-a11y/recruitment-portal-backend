"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappAttachmentVerificationQueue = exports.whatsappMediaQueue = exports.documentVerificationQueue = exports.cvParsingQueue = void 0;
const bullmq_1 = require("bullmq");
// ---------------------------------------------------------------------------
// Lazy Queue instances
// ---------------------------------------------------------------------------
// Previously this file eagerly imported `redis` and created all 4 Queue
// instances at module-load time. Because `routes/index.ts` statically imports
// every route file, and those route files statically import this module, the
// IORedis connection was opened at server startup even when RUN_WORKER=false —
// wasting ~80-150 MB of idle RAM and billed Railway memory minutes.
//
// Now each Queue is wrapped in a Proxy that defers both the `require('./redis')`
// call and the `new Queue(...)` construction until the very first method on
// that queue is actually invoked (e.g. `.add()`).  All call-sites remain
// identical — no changes needed in routes, services, or workers.
// ---------------------------------------------------------------------------
function lazyQueue(name) {
    let _instance;
    const getInstance = () => {
        if (!_instance) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { redis } = require('./redis');
            _instance = new bullmq_1.Queue(name, { connection: redis });
        }
        return _instance;
    };
    return new Proxy({}, {
        get(_t, prop) {
            return getInstance()[prop];
        },
    });
}
exports.cvParsingQueue = lazyQueue('cv-parsing');
exports.documentVerificationQueue = lazyQueue('document-verification');
exports.whatsappMediaQueue = lazyQueue('whatsapp-media');
// Identity-first WhatsApp flow: verify/extract identity from inbox_attachments BEFORE linking/binding.
exports.whatsappAttachmentVerificationQueue = lazyQueue('whatsapp-attachment-verification');
