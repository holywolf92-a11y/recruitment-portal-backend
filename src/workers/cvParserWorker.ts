import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import crypto from 'crypto';
import { ParsingJobsService } from '../services/parsingJobsService';
import { createCandidate, CreateCandidateData } from '../services/candidateService';
import { supabaseAdminClient } from '../config/database';

const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-portal-python-parser-production.up.railway.app') as string;
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET as string;

function signHmac(body: string) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

// Helper to create candidate from parsed CV data
async function createCandidateFromParsedData(parsed: any, attachmentId: string) {
  try {
    const candidate = parsed.candidate || {};
    
    // Build candidate data from parsed CV
    const candidateData: CreateCandidateData = {
      name: candidate.full_name || 'Unknown',
      email: candidate.email || undefined,
      phone: candidate.phone || undefined,
      address: candidate.location || undefined,
    };

    // Create candidate (system-created, no specific userId)
    const newCandidate = await createCandidate(candidateData);

    // Link the attachment to the candidate
    const db = supabaseAdminClient();
    await db
      .from('inbox_attachments')
      .update({ candidate_id: newCandidate.id })
      .eq('id', attachmentId);

    console.log(`[CVParser] Created candidate ${newCandidate.id} for attachment ${attachmentId}`);
    return newCandidate;
  } catch (err) {
    console.error(`[CVParser] Failed to create candidate from parsed data:`, err);
    // Don't throw - parsing was successful, just candidate creation failed
  }
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

        // Create candidate from parsed data and link to attachment
        await createCandidateFromParsedData(parsed, attachmentId);

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
