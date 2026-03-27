"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorkerStatus = getWorkerStatus;
const database_1 = require("../config/database");
const queue_1 = require("../config/queue");
const WORKER_STATUS_CACHE_TTL_MS = Number(process.env.WORKER_STATUS_CACHE_TTL_MS || 60000);
let workerStatusCache = null;
/**
 * Get worker status and queue health
 * GET /api/worker-status
 */
async function getWorkerStatus(req, res) {
    try {
        if (workerStatusCache && workerStatusCache.expiresAt > Date.now()) {
            return res.json({
                ...workerStatusCache.payload,
                cached: true,
            });
        }
        const serviceStartCommand = process.env.SERVICE_START_COMMAND || 'start';
        const deploymentRole = serviceStartCommand === 'start:worker'
            ? 'worker'
            : serviceStartCommand === 'start:api'
                ? 'api'
                : 'combined';
        const splitArchitecture = deploymentRole === 'api';
        const status = {
            timestamp: new Date().toISOString(),
            cached: false,
            deployment: {
                role: deploymentRole,
                service: process.env.RAILWAY_SERVICE_NAME || 'unknown',
                splitArchitecture,
            },
            environment: {
                RUN_WORKER: process.env.RUN_WORKER || 'not set',
                SERVICE_START_COMMAND: serviceStartCommand,
                REDIS_URL: process.env.REDIS_URL ? '✅ set' : '❌ not set',
                PYTHON_CV_PARSER_URL: process.env.PYTHON_CV_PARSER_URL ? '✅ set' : '❌ not set',
                PYTHON_HMAC_SECRET: process.env.PYTHON_HMAC_SECRET ? '✅ set' : '❌ not set',
            },
            workers: {
                enabled: process.env.RUN_WORKER === 'true' && !!process.env.REDIS_URL,
                mode: splitArchitecture ? 'dedicated-service' : deploymentRole,
                cvParser: {
                    configured: !!(process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET),
                },
                documentVerification: {
                    configured: !!(process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET),
                },
            },
            queues: {
                available: false,
                jobs: {},
            },
        };
        // Try to get queue stats if Redis is available
        if (process.env.REDIS_URL) {
            try {
                const [cvCounts, docVerifCounts, waMediaCounts, waVerifyCounts] = await Promise.all([
                    queue_1.cvParsingQueue.getJobCounts(),
                    queue_1.documentVerificationQueue.getJobCounts(),
                    queue_1.whatsappMediaQueue.getJobCounts(),
                    queue_1.whatsappAttachmentVerificationQueue.getJobCounts(),
                ]);
                status.queues.available = true;
                status.queues.jobs = {
                    cvParsing: cvCounts,
                    documentVerification: docVerifCounts,
                    whatsappMedia: waMediaCounts,
                    whatsappAttachmentVerification: waVerifyCounts,
                };
            }
            catch (queueError) {
                status.queues.error = queueError.message;
            }
        }
        // Get stuck documents (queued for more than 5 minutes)
        const db = (0, database_1.supabaseAdminClient)();
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: stuckDocs, error: stuckError } = await db
            .from('candidate_documents')
            .select('id, file_name, candidate_id, created_at')
            .eq('verification_status', 'pending_ai')
            .lt('created_at', fiveMinutesAgo)
            .order('created_at', { ascending: true })
            .limit(10);
        if (!stuckError && stuckDocs) {
            status.stuckDocuments = {
                count: stuckDocs.length,
                documents: stuckDocs.map(doc => ({
                    id: doc.id,
                    name: doc.file_name,
                    candidate_id: doc.candidate_id,
                    stuck_since: doc.created_at,
                    stuck_duration_minutes: Math.floor((Date.now() - new Date(doc.created_at).getTime()) / 60000),
                })),
            };
        }
        // Get total pending documents
        const { count: pendingCount } = await db
            .from('candidate_documents')
            .select('id', { count: 'exact', head: true })
            .eq('verification_status', 'pending_ai');
        status.pendingDocuments = pendingCount || 0;
        // Overall health check
        status.health = {
            workersRunning: status.workers.enabled,
            dedicatedWorkerArchitecture: splitArchitecture,
            redisConnected: status.queues.available,
            pythonServiceConfigured: status.workers.cvParser.configured,
            stuckDocuments: status.stuckDocuments?.count || 0,
            pendingDocuments: status.pendingDocuments,
        };
        // Determine overall status
        if (splitArchitecture && status.health.redisConnected && status.health.pythonServiceConfigured) {
            status.overall = '✅ API service healthy; queue workers run in dedicated worker service';
        }
        else if (status.health.workersRunning && status.health.redisConnected && status.health.pythonServiceConfigured) {
            status.overall = '✅ All systems operational';
        }
        else if (!status.health.workersRunning) {
            status.overall = '⚠️ Workers not enabled (set RUN_WORKER=true)';
        }
        else if (!status.health.redisConnected) {
            status.overall = '❌ Redis not connected';
        }
        else if (!status.health.pythonServiceConfigured) {
            status.overall = '❌ Python service not configured';
        }
        else {
            status.overall = '⚠️ Partial configuration';
        }
        workerStatusCache = {
            expiresAt: Date.now() + WORKER_STATUS_CACHE_TTL_MS,
            payload: status,
        };
        res.json(status);
    }
    catch (error) {
        console.error('[WorkerStatus] Error getting worker status:', error);
        res.status(500).json({
            error: error.message || 'Failed to get worker status',
            overall: '❌ Error checking status',
        });
    }
}
