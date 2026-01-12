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
const routes_1 = __importDefault(require("./routes"));
const errorHandling_1 = require("./utils/errorHandling");
const gmailPollingWorker_1 = require("./workers/gmailPollingWorker");
const cvParserWorker_1 = require("./workers/cvParserWorker");
const documentLinkWorker_1 = require("./workers/documentLinkWorker");
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
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)());
    // Capture raw body for signature validation (e.g., Meta WhatsApp webhooks)
    app.use(express_1.default.json({
        limit: '10mb',
        verify: (req, _res, buf) => {
            req.rawBody = buf.toString('utf8');
        }
    }));
    app.use(express_1.default.urlencoded({ extended: true }));
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    logger.info('Loading routes...');
    app.use('/api', routes_1.default);
    logger.info('Routes loaded successfully');
    // Global error handler
    app.use(errorHandling_1.errorHandler);
    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server listening on port ${PORT}`);
        // Start Gmail polling worker if credentials available
        if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN) {
            (0, gmailPollingWorker_1.startGmailPolling)(5).catch((err) => {
                logger.error('Failed to start Gmail polling', err);
            });
        }
        else {
            logger.info('Gmail credentials not configured, polling worker disabled');
        }
        // Start CV parser worker if explicitly enabled and env configured
        if (process.env.RUN_WORKER === 'true' &&
            process.env.REDIS_URL &&
            process.env.PYTHON_CV_PARSER_URL &&
            process.env.PYTHON_HMAC_SECRET) {
            try {
                (0, cvParserWorker_1.startCvParserWorker)();
                logger.info('CV Parser worker started');
                // Start Document Link worker alongside CV parser
                (0, documentLinkWorker_1.startDocumentLinkWorker)();
                logger.info('Document Link worker started');
            }
            catch (err) {
                logger.error('Failed to start workers', err);
            }
        }
        else {
            logger.info('Workers not started (set RUN_WORKER=true and configure REDIS_URL + PYTHON vars)');
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
