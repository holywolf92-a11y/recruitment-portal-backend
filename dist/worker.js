"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const env_1 = require("./config/env");
const errorHandling_1 = require("./utils/errorHandling");
dotenv_1.default.config();
(0, env_1.validateEnv)();
const logger = (0, errorHandling_1.createLogger)('WorkerService');
async function main() {
    if (process.env.RUN_WORKER !== 'true') {
        logger.error('Worker service requires RUN_WORKER=true');
        process.exit(1);
    }
    if (!process.env.REDIS_URL) {
        logger.error('Worker service requires REDIS_URL');
        process.exit(1);
    }
    const startedWorkers = [];
    if (process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET) {
        const [cvParserModule, whatsappVerifyModule, documentVerifyModule] = await Promise.all([
            Promise.resolve().then(() => __importStar(require('./workers/cvParserWorker'))),
            Promise.resolve().then(() => __importStar(require('./workers/whatsappAttachmentVerificationWorker'))),
            Promise.resolve().then(() => __importStar(require('./workers/documentVerificationWorker'))),
        ]);
        cvParserModule.startCvParserWorker();
        startedWorkers.push('cv-parser');
        whatsappVerifyModule.startWhatsAppAttachmentVerificationWorker();
        startedWorkers.push('whatsapp-attachment-verification');
        documentVerifyModule.startDocumentVerificationWorker();
        startedWorkers.push('document-verification');
    }
    else {
        logger.warn('Skipping parser-dependent workers (PYTHON_CV_PARSER_URL or PYTHON_HMAC_SECRET missing)');
    }
    const { startDocumentLinkWorker } = await Promise.resolve().then(() => __importStar(require('./workers/documentLinkWorker')));
    startDocumentLinkWorker();
    startedWorkers.push('document-linking');
    if (process.env.WHATSAPP_ACCESS_TOKEN) {
        const { startWhatsAppMediaWorker } = await Promise.resolve().then(() => __importStar(require('./workers/whatsappMediaWorker')));
        startWhatsAppMediaWorker();
        startedWorkers.push('whatsapp-media');
    }
    else {
        logger.warn('Skipping WhatsApp media worker (WHATSAPP_ACCESS_TOKEN missing)');
    }
    // ── WhatsApp bridge disconnect monitor ───────────────────────────────────
    const { startWhatsAppMonitor } = await Promise.resolve().then(() => __importStar(require('./workers/whatsappMonitorWorker')));
    startWhatsAppMonitor();
    startedWorkers.push('whatsapp-monitor');
    // ── Gmail polling (Account 3: cv.falishaoep@gmail.com) ────────────────────
    if (process.env.RUN_GMAIL_POLLING === 'true') {
        if (process.env.GMAIL_CLIENT_ID && (process.env.GMAIL_REFRESH_TOKEN || process.env.GMAIL3_REFRESH_TOKEN)) {
            const { startGmailPolling } = await Promise.resolve().then(() => __importStar(require('./workers/gmailPollingWorker')));
            startGmailPolling(5).catch((err) => logger.error('Failed to start Gmail polling', err));
            startedWorkers.push('gmail-polling');
            // Historical backfill from 2024-01-01 — Account 3 only
            const { startGmailBackfill } = await Promise.resolve().then(() => __importStar(require('./workers/gmailBackfillWorker')));
            const { createOAuth2ClientForAccount3, isAccount3Configured } = await Promise.resolve().then(() => __importStar(require('./services/gmailService')));
            const since2024 = new Date('2024-01-01T00:00:00.000Z');
            if (isAccount3Configured()) {
                startGmailBackfill({ afterDate: since2024, account: 3, authClient: createOAuth2ClientForAccount3(), maxTotal: 50000 })
                    .then(() => logger.info('Gmail account 3 (cv.falishaoep@gmail.com) historical backfill started (2024-present)'))
                    .catch((err) => logger.warn('Gmail account 3 backfill skipped (may already be running)', { msg: err?.message }));
            }
            else {
                logger.warn('GMAIL3_REFRESH_TOKEN not set — skipping historical backfill for cv.falishaoep@gmail.com');
            }
        }
        else {
            logger.warn('RUN_GMAIL_POLLING=true but GMAIL_CLIENT_ID / refresh token missing');
        }
    }
    // ── Google Drive polling (cv.falishaoep@gmail.com Drive) ──────────────────
    if (process.env.RUN_GOOGLE_DRIVE_POLLING === 'true') {
        const { startGoogleDrivePolling } = await Promise.resolve().then(() => __importStar(require('./workers/googleDrivePollingWorker')));
        startGoogleDrivePolling(10).catch((err) => logger.error('Failed to start Google Drive polling', err));
        startedWorkers.push('google-drive-polling');
    }
    logger.info('Dedicated worker service started', { workers: startedWorkers });
}
main().catch((error) => {
    logger.error('Failed to start worker service', error);
    process.exit(1);
});
