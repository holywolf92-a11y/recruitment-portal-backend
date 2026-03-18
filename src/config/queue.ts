import { Queue } from 'bullmq';

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

function lazyQueue(name: string): Queue {
  let _instance: Queue | undefined;

  const getInstance = (): Queue => {
    if (!_instance) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { redis } = require('./redis') as { redis: import('ioredis').default };
      _instance = new Queue(name, { connection: redis });
    }
    return _instance;
  };

  return new Proxy({} as Queue, {
    get(_t, prop: string | symbol) {
      return (getInstance() as any)[prop];
    },
  });
}

export const cvParsingQueue = lazyQueue('cv-parsing');
export const documentVerificationQueue = lazyQueue('document-verification');
export const whatsappMediaQueue = lazyQueue('whatsapp-media');
// Identity-first WhatsApp flow: verify/extract identity from inbox_attachments BEFORE linking/binding.
export const whatsappAttachmentVerificationQueue = lazyQueue('whatsapp-attachment-verification');
