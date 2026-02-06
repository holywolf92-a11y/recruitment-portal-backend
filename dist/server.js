"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const dotenv_1 = __importDefault(require("dotenv"));
const env_1 = require("./config/env");
const database_1 = require("./config/database");
const routes_1 = __importDefault(require("./routes"));
const errorHandling_1 = require("./utils/errorHandling");
const gmailPollingWorker_1 = require("./workers/gmailPollingWorker");
const cvParserWorker_1 = require("./workers/cvParserWorker");
const documentLinkWorker_1 = require("./workers/documentLinkWorker");
const documentVerificationWorker_1 = require("./workers/documentVerificationWorker");
dotenv_1.default.config();
(0, env_1.validateEnv)();
const logger = (0, errorHandling_1.createLogger)('Server');
logger.info('Environment variables loaded', {
    supabaseUrl: process.env.SUPABASE_URL ? 'loaded' : 'missing',
    supabaseKey: process.env.SUPABASE_ANON_KEY ? 'loaded' : 'missing',
    port: process.env.PORT
});
try {
    const app = (0, express_1.default)();
    const PORT = parseInt(process.env.PORT || '1000', 10);
    app.use((0, helmet_1.default)({
        crossOriginResourcePolicy: { policy: "cross-origin" },
        crossOriginEmbedderPolicy: false, // Disable COEP to allow CORS
    }));
    app.use((0, cors_1.default)({
        origin: '*', // Allow all origins
        methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-HMAC-Signature'],
        credentials: false,
    }));
    // Handle preflight OPTIONS requests explicitly
    app.options('*', (0, cors_1.default)());
    // Simple JSON/Form body parsing middleware - MUST come before routes
    app.use(express_1.default.json({ limit: '100mb' }));
    // Log what we received after parsing
    app.use((req, res, next) => {
        if (req.path.includes('/email/send-to-employer')) {
            console.log('[MIDDLEWARE] POST /email/send-to-employer received');
            console.log('[MIDDLEWARE] Method:', req.method);
            console.log('[MIDDLEWARE] Content-Type:', req.headers['content-type']);
            console.log('[MIDDLEWARE] Content-Length:', req.headers['content-length']);
            console.log('[MIDDLEWARE] req.body:', JSON.stringify(req.body));
            console.log('[MIDDLEWARE] req.body keys:', Object.keys(req.body || {}));
            console.log('[MIDDLEWARE] candidateIds in body:', req.body?.candidateIds);
            console.log('[MIDDLEWARE] candidateIds type:', typeof req.body?.candidateIds);
            console.log('[MIDDLEWARE] candidateIds is array?:', Array.isArray(req.body?.candidateIds));
        }
        next();
    });
    app.use(express_1.default.urlencoded({ extended: true, limit: '100mb' }));
    app.use(express_1.default.text({ limit: '100mb' }));
    // Increase request timeout for file uploads (5 minutes)
    app.use((req, res, next) => {
        req.setTimeout(300000, () => {
            if (!res.headersSent) {
                res.status(408).json({ error: 'Request timeout' });
            }
        });
        next();
    });
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.get('/health/supabase', async (_req, res) => {
        try {
            const supabase = (0, database_1.supabaseAdminClient)();
            // Lightweight connectivity/permission check. Avoid returning any data.
            const { error } = await supabase
                .from('candidates')
                .select('id', { head: true, count: 'exact' })
                .limit(1);
            if (error) {
                return res.status(500).json({
                    status: 'error',
                    service: 'supabase',
                    message: error.message,
                    code: error.code || null
                });
            }
            return res.json({ status: 'ok', service: 'supabase' });
        }
        catch (err) {
            return res.status(500).json({
                status: 'error',
                service: 'supabase',
                message: err?.message || 'Unknown error'
            });
        }
    });
    logger.info('Loading routes...');
    app.use('/api', routes_1.default);
    logger.info('Routes loaded successfully');
    // Global error handler
    app.use(errorHandling_1.errorHandler);
    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server listening on port ${PORT}`);
        // Start Gmail polling worker only when explicitly enabled.
        // This prevents noisy log spam (e.g. invalid_client) when creds are present but not valid.
        if (process.env.RUN_GMAIL_POLLING === 'true') {
            if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN) {
                (0, gmailPollingWorker_1.startGmailPolling)(5).catch((err) => {
                    logger.error('Failed to start Gmail polling', err);
                });
            }
            else {
                logger.warn('RUN_GMAIL_POLLING=true but Gmail credentials are missing; polling disabled');
            }
        }
        else {
            logger.info('Gmail polling worker disabled (set RUN_GMAIL_POLLING=true to enable)');
        }
        // Start workers if explicitly enabled
        if (process.env.RUN_WORKER === 'true' && process.env.REDIS_URL) {
            try {
                // Start CV parser worker (requires Python service)
                if (process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET) {
                    (0, cvParserWorker_1.startCvParserWorker)();
                    logger.info('CV Parser worker started');
                }
                else {
                    logger.warn('CV Parser worker not started (PYTHON_CV_PARSER_URL or PYTHON_HMAC_SECRET missing)');
                }
                // Start Document Link worker (only needs Redis)
                try {
                    (0, documentLinkWorker_1.startDocumentLinkWorker)();
                    logger.info('Document Link worker started');
                }
                catch (linkErr) {
                    logger.error('Failed to start Document Link worker:', linkErr);
                }
                // Start Document Verification worker (requires Python service)
                if (process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET) {
                    try {
                        (0, documentVerificationWorker_1.startDocumentVerificationWorker)();
                        logger.info('Document Verification worker started');
                    }
                    catch (verifyErr) {
                        logger.error('Failed to start Document Verification worker:', verifyErr);
                        logger.warn('Document verification will not run automatically. Use reprocess endpoint to trigger manually.');
                    }
                }
                else {
                    logger.warn('Document Verification worker not started (PYTHON_CV_PARSER_URL or PYTHON_HMAC_SECRET missing)');
                    logger.warn('Documents will remain in "Pending" status. Configure Python service or use reprocess endpoint.');
                }
            }
            catch (err) {
                logger.error('Failed to start workers', err);
            }
        }
        else {
            logger.info('Workers not started (set RUN_WORKER=true and configure REDIS_URL)');
            logger.warn('Document verification will not run automatically. Use POST /api/documents/candidate-documents/:id/reprocess to trigger manually.');
        }
    }).on('error', (err) => {
        logger.error('Server failed to start', err);
        process.exit(1);
    }).on('listening', () => {
        logger.info('Server is now listening for connections');
    });
}
catch (error) {
    logger.error('Failed to initialize server', error);
    process.exit(1);
}
