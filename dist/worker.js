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
    logger.info('Dedicated worker service started', { workers: startedWorkers });
}
main().catch((error) => {
    logger.error('Failed to start worker service', error);
    process.exit(1);
});
