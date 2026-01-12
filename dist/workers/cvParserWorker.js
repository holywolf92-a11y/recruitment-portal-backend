"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCvParserWorker = startCvParserWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const crypto_1 = __importDefault(require("crypto"));
const parsingJobsService_1 = require("../services/parsingJobsService");
const PY_URL = process.env.PYTHON_CV_PARSER_URL;
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET;
function signHmac(body) {
    return crypto_1.default.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}
function startCvParserWorker() {
    const parsingJobs = new parsingJobsService_1.ParsingJobsService();
    const worker = new bullmq_1.Worker('cv-parsing', async (job) => {
        const { jobId, attachmentId, fileUrl, fileHash } = job.data;
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
        }
        catch (err) {
            await parsingJobs.setStatus(jobId, 'failed', {
                finished_at: new Date().toISOString(),
                error_code: 'PARSING_FAILED',
                error_message: err?.message ?? 'Unknown error',
            });
            throw err;
        }
    }, {
        connection: redis_1.redis,
        concurrency: 5,
        limiter: { max: 10, duration: 60000 },
    });
    worker.on('failed', (job, err) => {
        console.error('cv-parsing failed', job?.id, err?.message);
    });
    return worker;
}
