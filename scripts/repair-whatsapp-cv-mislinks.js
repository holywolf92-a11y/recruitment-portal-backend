const { createClient } = require('@supabase/supabase-js');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

require('dotenv').config();

const WRONG_CANDIDATE_ID = 'f2b714eb-3a35-4b46-8298-f1023d64ac62';
const TARGET_FILE_NAMES = [
  'BEATRICE JELAGAT CV.pdf',
  'LONAH ASWANI MAHENDE CV.pdf',
  'REBECCA JEPKORIR CHUMBA CV.pdf',
  'AGNES MALEMBA JULIUS CV.pdf',
  'SHARON JEPNGETICH CV.pdf',
  'JULIET WAIRIMU BARAZA CV.pdf',
  'WINFRIDAH NYABWIRE JUMA CV (1).pdf',
  'PHILICE WAKHU CV.pdf',
];

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

if (!process.env.REDIS_URL) {
  throw new Error('Missing REDIS_URL');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function createRedisConnection(redisUrl) {
  const parsed = new URL(redisUrl);
  const isTLS = parsed.protocol === 'rediss:';

  return new IORedis({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : (isTLS ? 6380 : 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 15000,
    family: 4,
    lazyConnect: true,
    retryStrategy: (times) => (times >= 5 ? null : Math.min(times * 2000, 10000)),
    ...(isTLS ? { tls: { rejectUnauthorized: false } } : {}),
  });
}

async function createParsingJobRow(attachmentId, fileHash) {
  const now = new Date().toISOString();

  const attempt1 = await supabase
    .from('parsing_jobs')
    .insert({
      inbox_attachment_id: attachmentId,
      status: 'queued',
      created_at: now,
    })
    .select()
    .single();

  if (!attempt1.error) {
    return attempt1.data;
  }

  const message = String(attempt1.error?.message || '');
  const shouldFallback =
    /column.*inbox_attachment_id.*does\s+not\s+exist/i.test(message) ||
    /does\s+not\s+exist.*inbox_attachment_id/i.test(message) ||
    /null value in column.*attachment_id.*violates\s+not-null\s+constraint/i.test(message);

  if (!shouldFallback) {
    throw attempt1.error;
  }

  const attempt2 = await supabase
    .from('parsing_jobs')
    .insert({
      attachment_id: attachmentId,
      file_hash: fileHash || null,
      status: 'queued',
      attempts: 0,
      created_at: now,
    })
    .select()
    .single();

  if (attempt2.error) {
    throw attempt2.error;
  }

  return attempt2.data;
}

async function main() {
  const redis = createRedisConnection(process.env.REDIS_URL);
  const queue = new Queue('cv-parsing', { connection: redis });

  try {
    const { data: attachments, error } = await supabase
      .from('inbox_attachments')
      .select('id, file_name, candidate_id, linked_candidate_id, sha256, inbox_message_id, created_at')
      .in('file_name', TARGET_FILE_NAMES)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    const targets = (attachments || []).filter((attachment) => {
      return attachment.candidate_id === WRONG_CANDIDATE_ID || attachment.candidate_id === null;
    });

    if (targets.length === 0) {
      console.log('No matching wrongly linked attachments found.');
      return;
    }

    console.log(`Found ${targets.length} target attachments.`);

    for (const attachment of targets) {
      console.log(`\nRepairing ${attachment.file_name} (${attachment.id})`);

      let clearError = null;
      if (attachment.candidate_id === WRONG_CANDIDATE_ID || attachment.linked_candidate_id) {
        const clearResult = await supabase
          .from('inbox_attachments')
          .update({
            candidate_id: null,
            linked_candidate_id: null,
          })
          .eq('id', attachment.id);

        clearError = clearResult.error;
      }

      if (clearError) {
        throw clearError;
      }

      const jobRow = await createParsingJobRow(attachment.id, attachment.sha256 || null);

      await queue.add(
        'parse',
        {
          jobId: jobRow.id,
          attachmentId: attachment.id,
          fileHash: attachment.sha256 || null,
          force: true,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 200,
          removeOnFail: 200,
        }
      );

      console.log(`Queued parsing job ${jobRow.id}`);
    }

    console.log('\nRepair complete.');
  } finally {
    await queue.close();
    await redis.quit();
  }
}

main().catch((error) => {
  console.error('Repair failed:', error?.message || error);
  process.exitCode = 1;
});