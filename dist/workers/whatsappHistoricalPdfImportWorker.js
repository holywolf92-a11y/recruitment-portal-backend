"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWhatsAppHistoricalPdfImportState = getWhatsAppHistoricalPdfImportState;
exports.cancelWhatsAppHistoricalPdfImport = cancelWhatsAppHistoricalPdfImport;
exports.startWhatsAppHistoricalPdfImport = startWhatsAppHistoricalPdfImport;
const fs_1 = require("fs");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const hashing_1 = require("../utils/hashing");
const inboxService_1 = require("../services/inboxService");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const logger = (0, errorHandling_1.createLogger)('WhatsAppHistoricalPdfImportWorker');
const CV_FILENAME_REGEX = /\b(cv|resume|biodata|bio[\s_-]?data|curriculum[\s_-]?vitae|profile)\b/i;
const CV_TEXT_HINTS = [
    'education',
    'experience',
    'skills',
    'objective',
    'summary',
    'curriculum vitae',
    'passport',
    'cnic',
    'email',
    'phone',
];
const PY_URL = (process.env.PYTHON_CV_PARSER_URL || '').trim();
const HMAC_SECRET = (process.env.PYTHON_HMAC_SECRET || '').trim();
let state = {
    running: false,
    cancelled: false,
    startedAt: null,
    finishedAt: null,
    batchId: null,
    manifestPath: null,
    currentIndex: -1,
    discovered: 0,
    eligible: 0,
    imported: 0,
    duplicates: 0,
    review: 0,
    skipped: 0,
    errors: 0,
    dryRun: false,
    lastError: null,
    lastProcessedChatId: null,
    lastProcessedMessageId: null,
    lastProcessedTimestamp: null,
};
function getWhatsAppHistoricalPdfImportState() {
    return { ...state };
}
function cancelWhatsAppHistoricalPdfImport() {
    if (state.running) {
        state.cancelled = true;
        logger.info('Historical WhatsApp PDF import cancellation requested');
    }
}
function resetState(options) {
    state = {
        running: true,
        cancelled: false,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        batchId: options.batchId,
        manifestPath: options.manifestPath,
        currentIndex: -1,
        discovered: 0,
        eligible: 0,
        imported: 0,
        duplicates: 0,
        review: 0,
        skipped: 0,
        errors: 0,
        dryRun: Boolean(options.dryRun),
        lastError: null,
        lastProcessedChatId: null,
        lastProcessedMessageId: null,
        lastProcessedTimestamp: null,
    };
}
function sanitizeFileName(fileName) {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function normalizeString(value) {
    const str = String(value ?? '').trim();
    return str ? str : undefined;
}
function normalizeDate(value) {
    const str = normalizeString(value);
    if (!str)
        return undefined;
    const date = new Date(str);
    if (Number.isNaN(date.getTime()))
        return undefined;
    return date.toISOString();
}
function isPdfMime(mimeType, fileName) {
    if (mimeType.toLowerCase() === 'application/pdf')
        return true;
    return path_1.default.extname(fileName).toLowerCase() === '.pdf';
}
function looksLikeCvByFilename(fileName) {
    return CV_FILENAME_REGEX.test(fileName);
}
function sortEntries(entries) {
    return entries.sort((left, right) => {
        const byTime = left.messageTimestamp.localeCompare(right.messageTimestamp);
        if (byTime !== 0)
            return byTime;
        const byChat = left.chatId.localeCompare(right.chatId);
        if (byChat !== 0)
            return byChat;
        const leftKey = left.messageId || left.originalFilename || left.localFilePath;
        const rightKey = right.messageId || right.originalFilename || right.localFilePath;
        return leftKey.localeCompare(rightKey);
    });
}
async function ensureParentDirectory(filePath) {
    await fs_1.promises.mkdir(path_1.default.dirname(filePath), { recursive: true });
}
function parseCsvRow(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];
        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                index += 1;
            }
            else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === ',' && !inQuotes) {
            values.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    values.push(current);
    return values.map((value) => value.trim());
}
function parseCsvManifest(csvRaw) {
    const lines = csvRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length < 2) {
        throw new errorHandling_1.AppError('CSV manifest must include a header row and at least one data row', errorHandling_1.ErrorType.VALIDATION, 400);
    }
    const headers = parseCsvRow(lines[0]);
    return lines.slice(1).map((line) => {
        const columns = parseCsvRow(line);
        return headers.reduce((accumulator, header, index) => {
            accumulator[header] = columns[index] ?? '';
            return accumulator;
        }, {});
    });
}
function normalizeManifestRecords(records, manifestDir) {
    return sortEntries(records.map((record, index) => {
        const chatId = normalizeString(record.chatId || record.chat_id || record.chat);
        const senderNumber = normalizeString(record.senderNumber || record.sender_number || record.fromPhone || record.from_phone);
        const messageTimestamp = normalizeDate(record.messageTimestamp || record.message_timestamp || record.timestamp || record.sentAt);
        const localFilePathRaw = normalizeString(record.localFilePath || record.local_file_path || record.filePath || record.file_path);
        const originalFilename = normalizeString(record.originalFilename || record.original_filename || record.fileName || record.file_name) || (localFilePathRaw ? path_1.default.basename(localFilePathRaw) : undefined);
        const mimeType = normalizeString(record.mimeType || record.mime_type) || 'application/pdf';
        if (!chatId || !senderNumber || !messageTimestamp || !localFilePathRaw || !originalFilename) {
            throw new errorHandling_1.AppError(`Manifest entry ${index} is missing required fields`, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        return {
            chatId,
            senderNumber,
            messageTimestamp,
            messageId: normalizeString(record.messageId || record.message_id),
            originalFilename,
            mimeType,
            localFilePath: path_1.default.isAbsolute(localFilePathRaw)
                ? localFilePathRaw
                : path_1.default.resolve(manifestDir, localFilePathRaw),
        };
    }));
}
async function readManifestFile(manifestPath) {
    const manifestDir = path_1.default.dirname(manifestPath);
    const extension = path_1.default.extname(manifestPath).toLowerCase();
    if (extension === '.json') {
        const manifestRaw = await fs_1.promises.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestRaw);
        const records = Array.isArray(manifest) ? manifest : Array.isArray(manifest?.entries) ? manifest.entries : null;
        if (!records) {
            throw new errorHandling_1.AppError('JSON manifest must be an array or an object with an entries array', errorHandling_1.ErrorType.VALIDATION, 400);
        }
        return normalizeManifestRecords(records, manifestDir);
    }
    if (extension === '.csv') {
        const csvRaw = await fs_1.promises.readFile(manifestPath, 'utf-8');
        return normalizeManifestRecords(parseCsvManifest(csvRaw), manifestDir);
    }
    throw new errorHandling_1.AppError(`Unsupported manifest file type: ${extension}`, errorHandling_1.ErrorType.VALIDATION, 400);
}
async function listFilesRecursive(dirPath) {
    const entries = await fs_1.promises.readdir(dirPath, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const fullPath = path_1.default.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            return listFilesRecursive(fullPath);
        }
        return [fullPath];
    }));
    return files.flat();
}
async function loadManifest(manifestPath, batchId) {
    const extension = path_1.default.extname(manifestPath).toLowerCase();
    if (extension === '.json' || extension === '.csv') {
        return {
            entries: await readManifestFile(manifestPath),
            resolvedManifestPath: manifestPath,
        };
    }
    if (extension !== '.zip') {
        throw new errorHandling_1.AppError(`Unsupported manifest source: ${manifestPath}`, errorHandling_1.ErrorType.VALIDATION, 400);
    }
    const extractionRoot = path_1.default.join(os_1.default.tmpdir(), 'falisha-whatsapp-backfill', `${sanitizeFileName(batchId)}-${Date.now()}`);
    await fs_1.promises.mkdir(extractionRoot, { recursive: true });
    const zip = new adm_zip_1.default(manifestPath);
    zip.extractAllTo(extractionRoot, true);
    const extractedFiles = await listFilesRecursive(extractionRoot);
    const manifestCandidates = extractedFiles.filter((filePath) => {
        const baseName = path_1.default.basename(filePath).toLowerCase();
        return baseName === 'manifest.json' || baseName === 'manifest.csv' || (baseName.includes('manifest') && ['.json', '.csv'].includes(path_1.default.extname(baseName)));
    });
    if (manifestCandidates.length === 0) {
        throw new errorHandling_1.AppError('ZIP import requires a manifest.json or manifest.csv file inside the archive', errorHandling_1.ErrorType.VALIDATION, 400);
    }
    const resolvedManifestPath = manifestCandidates.sort()[0];
    logger.info('Loaded WhatsApp historical ZIP package', {
        manifestPath,
        extractionRoot,
        resolvedManifestPath,
    });
    return {
        entries: await readManifestFile(resolvedManifestPath),
        resolvedManifestPath,
        extractedWorkingDir: extractionRoot,
    };
}
async function readCheckpoint(checkpointPath) {
    try {
        const raw = await fs_1.promises.readFile(checkpointPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
async function writeCheckpoint(checkpointPath, options, currentIndex) {
    const checkpoint = {
        batchId: options.batchId,
        manifestPath: options.manifestPath,
        windowStart: options.startDate.toISOString(),
        windowEnd: options.endDate.toISOString(),
        lastProcessedIndex: currentIndex,
        lastProcessedChatId: state.lastProcessedChatId,
        lastProcessedMessageId: state.lastProcessedMessageId,
        lastProcessedTimestamp: state.lastProcessedTimestamp,
        imported: state.imported,
        duplicates: state.duplicates,
        review: state.review,
        skipped: state.skipped,
        errors: state.errors,
        updatedAt: new Date().toISOString(),
    };
    await ensureParentDirectory(checkpointPath);
    await fs_1.promises.writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf-8');
}
async function appendReviewItem(reportPath, item) {
    await ensureParentDirectory(reportPath);
    await fs_1.promises.appendFile(reportPath, `${JSON.stringify(item)}\n`, 'utf-8');
}
function filterEntries(entries, options) {
    const allowedChatIds = new Set(options.allowedChatIds || []);
    const maxChats = options.maxChats ?? Number.MAX_SAFE_INTEGER;
    const seenChats = new Set();
    return entries.filter((entry) => {
        const entryTime = new Date(entry.messageTimestamp).getTime();
        if (entryTime < options.startDate.getTime() || entryTime > options.endDate.getTime()) {
            return false;
        }
        if (allowedChatIds.size > 0 && !allowedChatIds.has(entry.chatId)) {
            return false;
        }
        if (!seenChats.has(entry.chatId)) {
            if (seenChats.size >= maxChats) {
                return false;
            }
            seenChats.add(entry.chatId);
        }
        return true;
    });
}
function createReviewReportPath(options) {
    return options.reviewReportPath || `${options.checkpointPath}.review.ndjson`;
}
function hasCvHintsInText(text) {
    const lowered = text.toLowerCase();
    const matchedHints = CV_TEXT_HINTS.filter((hint) => lowered.includes(hint));
    return matchedHints.length >= 3;
}
function signHmac(body) {
    return require('crypto').createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}
async function callAICategorizationService(fileContentBase64, fileName, mimeType) {
    if (!PY_URL || !HMAC_SECRET) {
        return { success: false, error: 'AI categorization is not configured' };
    }
    const requestBody = JSON.stringify({
        file_content: fileContentBase64,
        file_name: fileName,
        mime_type: mimeType,
        operation: 'categorize_document',
    });
    const response = await fetch(`${PY_URL.replace(/\/$/, '')}/categorize-document`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-HMAC-Signature': signHmac(requestBody),
        },
        body: requestBody,
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { success: false, error: `AI service HTTP ${response.status}: ${text}` };
    }
    const result = await response.json();
    return {
        success: Boolean(result?.success),
        raw_text: normalizeString(result?.raw_text),
        extracted_identity: {
            name: normalizeString(result?.extracted_identity?.name || result?.identity_fields?.name),
            cnic: normalizeString(result?.extracted_identity?.cnic || result?.identity_fields?.cnic),
            passport_no: normalizeString(result?.extracted_identity?.passport_no || result?.identity_fields?.passport_no),
            email: normalizeString(result?.extracted_identity?.email || result?.identity_fields?.email),
            phone: normalizeString(result?.extracted_identity?.phone || result?.identity_fields?.phone),
        },
        error: normalizeString(result?.error),
    };
}
async function evaluateCvLikelihood(entry, buffer) {
    if (looksLikeCvByFilename(entry.originalFilename)) {
        return {
            accepted: true,
            reviewRequired: false,
            confidence: 0.95,
            reason: 'filename_keyword_match',
        };
    }
    if (!PY_URL || !HMAC_SECRET) {
        return {
            accepted: false,
            reviewRequired: true,
            confidence: 0.3,
            reason: 'filename_unclear_ai_unavailable',
        };
    }
    try {
        const aiResult = await callAICategorizationService(buffer.toString('base64'), entry.originalFilename, entry.mimeType);
        if (!aiResult.success) {
            return {
                accepted: false,
                reviewRequired: true,
                confidence: 0.2,
                reason: aiResult.error || 'ai_failed',
            };
        }
        const rawText = aiResult.raw_text || '';
        const hasIdentity = Boolean(aiResult.extracted_identity?.name &&
            (aiResult.extracted_identity?.email || aiResult.extracted_identity?.phone || aiResult.extracted_identity?.cnic || aiResult.extracted_identity?.passport_no));
        if (hasIdentity || hasCvHintsInText(rawText)) {
            return {
                accepted: true,
                reviewRequired: false,
                confidence: hasIdentity ? 0.85 : 0.75,
                reason: hasIdentity ? 'ai_identity_detected' : 'ai_text_hints_detected',
                extractedTextSnippet: rawText.slice(0, 300),
            };
        }
        return {
            accepted: false,
            reviewRequired: true,
            confidence: 0.4,
            reason: 'ai_low_confidence',
            extractedTextSnippet: rawText.slice(0, 300),
        };
    }
    catch (error) {
        return {
            accepted: false,
            reviewRequired: true,
            confidence: 0.2,
            reason: error?.message || 'ai_exception',
        };
    }
}
async function getInboxMessageByExternalId(externalMessageId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('inbox_messages')
        .select('*')
        .eq('external_message_id', externalMessageId)
        .maybeSingle();
    if (error) {
        throw error;
    }
    return data;
}
async function persistAcceptedPdf(entry, buffer, fileHash, evaluation, options) {
    const externalMessageId = `whatsapp-backfill:${entry.chatId}:${entry.messageId || fileHash}`;
    const payload = {
        source: 'whatsapp_backfill_pdf',
        backfill: true,
        is_historical: true,
        batch_id: options.batchId,
        batch_window_start: options.startDate.toISOString(),
        batch_window_end: options.endDate.toISOString(),
        chat_id: entry.chatId,
        sender_number: entry.senderNumber,
        message_timestamp: entry.messageTimestamp,
        message_id: entry.messageId || null,
        original_filename: entry.originalFilename,
        mime_type: entry.mimeType,
        sha256_hash: fileHash,
        cv_confidence: evaluation.confidence,
        review_required: false,
        rawFields: {
            backfill: 'true',
            source: 'whatsapp_backfill_pdf',
        },
    };
    let inboxMessage = await getInboxMessageByExternalId(externalMessageId);
    if (!inboxMessage) {
        try {
            inboxMessage = await (0, inboxService_1.createInboxMessage)({
                source: 'whatsapp_backfill_pdf',
                externalMessageId,
                payload,
                status: 'pending',
                receivedAt: entry.messageTimestamp,
            });
        }
        catch (error) {
            if (error instanceof errorHandling_1.AppError && error.type === errorHandling_1.ErrorType.DUPLICATE) {
                inboxMessage = await getInboxMessageByExternalId(externalMessageId);
            }
            else {
                throw error;
            }
        }
    }
    if (!inboxMessage?.id) {
        throw new errorHandling_1.AppError(`Failed to resolve inbox message for ${externalMessageId}`, errorHandling_1.ErrorType.DATABASE, 500);
    }
    const storagePath = `whatsapp_backfill_pdf/${options.batchId}/${sanitizeFileName(entry.originalFilename)}-${Date.now()}.pdf`;
    try {
        const attachment = await (0, inboxAttachmentService_1.createAttachment)({
            inboxMessageId: inboxMessage.id,
            fileBuffer: buffer,
            fileName: entry.originalFilename,
            mimeType: entry.mimeType,
            attachmentType: 'cv',
            storageBucket: 'documents',
            storagePath,
            candidateId: undefined,
            messageSubject: 'Historical WhatsApp PDF CV Backfill',
            messageSource: 'whatsapp_backfill_pdf',
        });
        await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(attachment.id, {
            force: false,
            expiresInSeconds: 86400,
        });
        await (0, inboxService_1.updateInboxMessage)(inboxMessage.id, {
            status: 'processed',
            payload: {
                ...payload,
                attachment_id: attachment.id,
            },
        });
        return 'imported';
    }
    catch (error) {
        if (error instanceof errorHandling_1.AppError && error.type === errorHandling_1.ErrorType.DUPLICATE) {
            await (0, inboxService_1.updateInboxMessage)(inboxMessage.id, {
                status: 'processed',
                payload: {
                    ...payload,
                    duplicate: true,
                },
            });
            return 'duplicate';
        }
        throw error;
    }
}
async function startWhatsAppHistoricalPdfImport(options) {
    if (state.running) {
        throw new errorHandling_1.AppError('Historical WhatsApp PDF import is already running', errorHandling_1.ErrorType.VALIDATION, 409);
    }
    resetState(options);
    logger.info('Starting WhatsApp historical PDF import', {
        batchId: options.batchId,
        manifestPath: options.manifestPath,
        startDate: options.startDate.toISOString(),
        endDate: options.endDate.toISOString(),
        dryRun: Boolean(options.dryRun),
        maxFiles: options.maxFiles ?? null,
        maxChats: options.maxChats ?? null,
        allowedChatIds: options.allowedChatIds ?? [],
    });
    const loadedManifest = await loadManifest(options.manifestPath, options.batchId);
    const manifestEntries = loadedManifest.entries;
    const filteredEntries = filterEntries(manifestEntries, options);
    const checkpoint = options.resumeFromCheckpoint
        ? await readCheckpoint(options.checkpointPath)
        : null;
    const reviewReportPath = createReviewReportPath(options);
    state.manifestPath = loadedManifest.resolvedManifestPath;
    logger.info('Historical WhatsApp PDF manifest loaded', {
        batchId: options.batchId,
        resolvedManifestPath: loadedManifest.resolvedManifestPath,
        extractedWorkingDir: loadedManifest.extractedWorkingDir ?? null,
        discovered: manifestEntries.length,
        eligibleAfterWindowFilter: filteredEntries.length,
    });
    state.discovered = manifestEntries.length;
    state.eligible = filteredEntries.length;
    const startIndex = checkpoint?.lastProcessedIndex !== undefined ? checkpoint.lastProcessedIndex + 1 : 0;
    if (checkpoint) {
        state.imported = checkpoint.imported;
        state.duplicates = checkpoint.duplicates;
        state.review = checkpoint.review;
        state.skipped = checkpoint.skipped;
        state.errors = checkpoint.errors;
        state.lastProcessedChatId = checkpoint.lastProcessedChatId;
        state.lastProcessedMessageId = checkpoint.lastProcessedMessageId;
        state.lastProcessedTimestamp = checkpoint.lastProcessedTimestamp;
        logger.info('Resuming WhatsApp historical PDF import from checkpoint', {
            checkpointPath: options.checkpointPath,
            lastProcessedIndex: checkpoint.lastProcessedIndex,
            lastProcessedChatId: checkpoint.lastProcessedChatId,
            lastProcessedMessageId: checkpoint.lastProcessedMessageId,
        });
    }
    try {
        for (let index = startIndex; index < filteredEntries.length; index += 1) {
            const entry = filteredEntries[index];
            state.currentIndex = index;
            if (state.cancelled) {
                logger.warn('Historical WhatsApp PDF import cancelled by request', { batchId: options.batchId });
                break;
            }
            if (options.maxFiles && state.imported >= options.maxFiles) {
                logger.info('Historical WhatsApp PDF import reached maxFiles cap', {
                    batchId: options.batchId,
                    maxFiles: options.maxFiles,
                });
                break;
            }
            try {
                const fileBuffer = await fs_1.promises.readFile(entry.localFilePath);
                const fileHash = (0, hashing_1.hashFile)(fileBuffer);
                state.lastProcessedChatId = entry.chatId;
                state.lastProcessedMessageId = entry.messageId || (0, hashing_1.hashString)(`${entry.chatId}:${entry.messageTimestamp}:${entry.originalFilename}`);
                state.lastProcessedTimestamp = entry.messageTimestamp;
                if (!isPdfMime(entry.mimeType, entry.originalFilename)) {
                    state.skipped += 1;
                    await writeCheckpoint(options.checkpointPath, options, index);
                    continue;
                }
                const evaluation = await evaluateCvLikelihood(entry, fileBuffer);
                if (!evaluation.accepted) {
                    state.review += 1;
                    await appendReviewItem(reviewReportPath, {
                        batchId: options.batchId,
                        chatId: entry.chatId,
                        senderNumber: entry.senderNumber,
                        messageTimestamp: entry.messageTimestamp,
                        messageId: entry.messageId || null,
                        originalFilename: entry.originalFilename,
                        localFilePath: entry.localFilePath,
                        reason: evaluation.reason,
                        confidence: evaluation.confidence,
                        extractedTextSnippet: evaluation.extractedTextSnippet || null,
                    });
                    await writeCheckpoint(options.checkpointPath, options, index);
                    continue;
                }
                if (options.dryRun) {
                    state.imported += 1;
                    logger.info('Dry-run accepted WhatsApp historical PDF', {
                        batchId: options.batchId,
                        chatId: entry.chatId,
                        messageId: entry.messageId || null,
                        fileName: entry.originalFilename,
                        confidence: evaluation.confidence,
                        reason: evaluation.reason,
                    });
                    await writeCheckpoint(options.checkpointPath, options, index);
                    continue;
                }
                const result = await persistAcceptedPdf(entry, fileBuffer, fileHash, evaluation, options);
                if (result === 'duplicate') {
                    state.duplicates += 1;
                }
                else {
                    state.imported += 1;
                }
                await writeCheckpoint(options.checkpointPath, options, index);
                const throttleMs = options.throttleMsBetweenDownloads ?? 0;
                if (throttleMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, throttleMs));
                }
            }
            catch (error) {
                state.errors += 1;
                state.lastError = error?.message || String(error);
                logger.error('Failed to process historical WhatsApp PDF entry', error, {
                    batchId: options.batchId,
                    entry,
                    currentIndex: index,
                });
                await writeCheckpoint(options.checkpointPath, options, index);
                if (options.stopOnErrorThreshold && state.errors >= options.stopOnErrorThreshold) {
                    logger.warn('Stopping historical WhatsApp PDF import after reaching error threshold', {
                        batchId: options.batchId,
                        stopOnErrorThreshold: options.stopOnErrorThreshold,
                        errors: state.errors,
                    });
                    break;
                }
            }
        }
        return { ...state };
    }
    finally {
        state.running = false;
        state.finishedAt = new Date().toISOString();
        await writeCheckpoint(options.checkpointPath, options, Math.max(state.currentIndex, -1));
        logger.info('Historical WhatsApp PDF import finished', {
            batchId: options.batchId,
            imported: state.imported,
            duplicates: state.duplicates,
            review: state.review,
            skipped: state.skipped,
            errors: state.errors,
            dryRun: state.dryRun,
        });
    }
}
