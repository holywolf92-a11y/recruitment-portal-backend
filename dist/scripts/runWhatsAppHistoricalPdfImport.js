"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const whatsappHistoricalPdfImportWorker_1 = require("../workers/whatsappHistoricalPdfImportWorker");
function parseInteger(value, flag) {
    if (!value)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid value for ${flag}: ${value}`);
    }
    return parsed;
}
function parseDate(value, flag) {
    if (!value) {
        throw new Error(`${flag} is required`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid date for ${flag}: ${value}`);
    }
    return parsed;
}
function parseArgs(argv) {
    const args = new Map();
    for (let index = 0; index < argv.length; index += 1) {
        const current = argv[index];
        if (!current.startsWith('--')) {
            continue;
        }
        const key = current.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            args.set(key, ['true']);
            continue;
        }
        const existing = args.get(key) || [];
        existing.push(next);
        args.set(key, existing);
        index += 1;
    }
    const manifestPath = args.get('manifest')?.[0];
    const batchId = args.get('batch-id')?.[0];
    if (!manifestPath)
        throw new Error('--manifest is required');
    if (!batchId)
        throw new Error('--batch-id is required');
    const checkpointPath = args.get('checkpoint')?.[0]
        || path_1.default.resolve(process.cwd(), 'tmp', `${batchId}.checkpoint.json`);
    const allowedChatIds = args.get('allowed-chat-id')?.flatMap((value) => value.split(',').map((item) => item.trim()).filter(Boolean));
    return {
        manifestPath: path_1.default.resolve(process.cwd(), manifestPath),
        batchId,
        startDate: parseDate(args.get('start-date')?.[0], '--start-date'),
        endDate: parseDate(args.get('end-date')?.[0], '--end-date'),
        checkpointPath: path_1.default.resolve(process.cwd(), checkpointPath),
        reviewReportPath: args.get('review-report')?.[0]
            ? path_1.default.resolve(process.cwd(), args.get('review-report')[0])
            : undefined,
        dryRun: args.has('dry-run'),
        maxFiles: parseInteger(args.get('max-files')?.[0], '--max-files'),
        maxChats: parseInteger(args.get('max-chats')?.[0], '--max-chats'),
        allowedChatIds,
        throttleMsBetweenDownloads: parseInteger(args.get('throttle-ms-between-downloads')?.[0], '--throttle-ms-between-downloads'),
        stopOnErrorThreshold: parseInteger(args.get('stop-on-error-threshold')?.[0], '--stop-on-error-threshold'),
        resumeFromCheckpoint: args.has('resume-from-checkpoint'),
    };
}
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = await (0, whatsappHistoricalPdfImportWorker_1.startWhatsAppHistoricalPdfImport)(options);
    console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => {
    console.error('[runWhatsAppHistoricalPdfImport] Failed:', error?.message || error);
    process.exitCode = 1;
});
