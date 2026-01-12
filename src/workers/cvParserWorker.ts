import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import crypto from 'crypto';
import { ParsingJobsService } from '../services/parsingJobsService';

const PY_URL = process.env.PYTHON_CV_PARSER_URL as string;
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET as string;

function signHmac(body: string) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

export function startCvParserWorker() {
  const parsingJobs = new ParsingJobsService();

  const worker = new Worker(
    'cv-parsing',
    async (job: Job) => {
      const { jobId, attachmentId, fileUrl, fileHash } = job.data as {
        jobId: string;
        attachmentId: string;
        fileUrl: string;
        fileHash?: string | null;
      };

      await parsingJobs.setStatus(jobId, 'processing', {
        started_at: new Date().toISOString(),
        attempts: (job.attemptsMade ?? 0) + 1,
      });

      try {
        const payloadObj = {
          attachment_id: attachmentId,
          file_url: fileUrl,
          file_hash: fileHash ?? null,
        };
        const payload = JSON.stringify(payloadObj);

        const res = await fetch(`${PY_URL}/parse-cv`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-signature': signHmac(payload),
          },
          body: payload,
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`PYTHON_${res.status}: ${text.slice(0, 300)}`);
        }

        const parsed = await res.json();

        await parsingJobs.setStatus(jobId, 'extracted', {
          finished_at: new Date().toISOString(),
          schema_version: parsed.schema_version ?? 'v1',
          result_json: parsed,
          error_code: null,
          error_message: null,
        });

        return { ok: true };
      } catch (err: any) {
        await parsingJobs.setStatus(jobId, 'failed', {
          finished_at: new Date().toISOString(),
          error_code: 'PARSING_FAILED',
          error_message: err?.message ?? 'Unknown error',
        });
        throw err;
      }
    },
    {
      connection: redis,
      concurrency: 5,
      limiter: { max: 10, duration: 60_000 },
    }
  );

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error('cv-parsing failed', job?.id, err?.message);
  });

  return worker;
}
