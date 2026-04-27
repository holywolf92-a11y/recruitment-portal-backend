"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const multer_1 = __importDefault(require("multer"));
const express_1 = require("express");
const database_1 = require("../config/database");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const errorHandling_1 = require("../utils/errorHandling");
const router = (0, express_1.Router)();
const logger = (0, errorHandling_1.createLogger)('DatabankRoutes');
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
});
const DATABANK_BUCKET = 'documents';
const DATABANK_ROOT = 'databank';
const DATABANK_MANIFEST_PATH = `${DATABANK_ROOT}/_folders.json`;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
router.use(auth_1.authenticate);
router.use((0, rbac_1.requireRole)('admin', 'manager', 'recruiter'));
function getFolderPrefix(folderId) {
    return `${DATABANK_ROOT}/${folderId}`;
}
function getKeepFilePath(folderId) {
    return `${getFolderPrefix(folderId)}/.keep`;
}
function isHiddenDatabankObject(name) {
    return !name || name.startsWith('.');
}
function inferMimeType(fileName) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.pdf'))
        return 'application/pdf';
    if (lower.endsWith('.png'))
        return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))
        return 'image/jpeg';
    if (lower.endsWith('.webp'))
        return 'image/webp';
    if (lower.endsWith('.gif'))
        return 'image/gif';
    if (lower.endsWith('.doc'))
        return 'application/msword';
    if (lower.endsWith('.docx'))
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.txt'))
        return 'text/plain';
    return 'application/octet-stream';
}
function ensureFolderName(name) {
    const normalized = String(name || '').trim();
    if (!normalized) {
        throw new errorHandling_1.AppError('Folder name is required', errorHandling_1.ErrorType.VALIDATION, 400);
    }
    if (normalized.length > 120) {
        throw new errorHandling_1.AppError('Folder name must be 120 characters or fewer', errorHandling_1.ErrorType.VALIDATION, 400);
    }
    return normalized;
}
function sanitizeFileNameSegment(name) {
    const trimmed = name.trim();
    const collapsed = trimmed.replace(/\s+/g, ' ');
    const sanitized = collapsed.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/[\/\\]/g, '_');
    return sanitized || 'file';
}
function toStoredFileName(displayName) {
    return `${crypto_1.default.randomUUID()}__${sanitizeFileNameSegment(displayName)}`;
}
function toDisplayFileName(storedName) {
    const separatorIndex = storedName.indexOf('__');
    if (separatorIndex < 0) {
        return storedName;
    }
    return storedName.slice(separatorIndex + 2) || storedName;
}
function ensureDisplayNameWithExtension(displayName, originalFileName) {
    const safeDisplayName = sanitizeFileNameSegment(displayName);
    const originalExtIndex = originalFileName.lastIndexOf('.');
    const originalExtension = originalExtIndex >= 0 ? originalFileName.slice(originalExtIndex) : '';
    const hasExtension = safeDisplayName.lastIndexOf('.') > 0;
    return hasExtension ? safeDisplayName : `${safeDisplayName}${originalExtension}`;
}
function encodeDatabankFileId(storagePath) {
    return Buffer.from(JSON.stringify({ storagePath }), 'utf8').toString('base64url');
}
function decodeDatabankFileId(fileId) {
    try {
        const decoded = JSON.parse(Buffer.from(fileId, 'base64url').toString('utf8'));
        if (!decoded.storagePath || !decoded.storagePath.startsWith(`${DATABANK_ROOT}/`)) {
            throw new Error('Invalid storage path');
        }
        return { storagePath: decoded.storagePath };
    }
    catch {
        throw new errorHandling_1.AppError('Invalid databank file id', errorHandling_1.ErrorType.VALIDATION, 400);
    }
}
async function readJsonBlob(path) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db.storage.from(DATABANK_BUCKET).download(path);
    if (error) {
        const message = String(error.message || '').toLowerCase();
        if (message.includes('not found') || message.includes('404') || message.includes('does not exist')) {
            return null;
        }
        throw new errorHandling_1.AppError(`Failed to read storage object ${path}: ${error.message}`, errorHandling_1.ErrorType.DATABASE, 500);
    }
    const text = await data.text();
    return JSON.parse(text);
}
async function writeJsonBlob(path, payload) {
    const db = (0, database_1.supabaseAdminClient)();
    const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    const { error } = await db.storage.from(DATABANK_BUCKET).upload(path, buffer, {
        upsert: true,
        contentType: 'application/json',
    });
    if (error) {
        throw new errorHandling_1.AppError(`Failed to write storage object ${path}: ${error.message}`, errorHandling_1.ErrorType.DATABASE, 500);
    }
}
async function getFolderManifest() {
    const manifest = await readJsonBlob(DATABANK_MANIFEST_PATH);
    if (!manifest)
        return [];
    if (!Array.isArray(manifest.folders))
        return [];
    return manifest.folders;
}
async function saveFolderManifest(folders) {
    await writeJsonBlob(DATABANK_MANIFEST_PATH, { folders });
}
async function listFolderObjects(folderId) {
    const db = (0, database_1.supabaseAdminClient)();
    const folderPrefix = getFolderPrefix(folderId);
    const objects = [];
    let offset = 0;
    const pageSize = 100;
    while (true) {
        const { data, error } = await db.storage.from(DATABANK_BUCKET).list(folderPrefix, {
            limit: pageSize,
            offset,
            sortBy: { column: 'name', order: 'asc' },
        });
        if (error) {
            throw new errorHandling_1.AppError(`Failed to list databank folder ${folderId}: ${error.message}`, errorHandling_1.ErrorType.DATABASE, 500);
        }
        const page = data || [];
        objects.push(...page);
        if (page.length < pageSize) {
            break;
        }
        offset += pageSize;
    }
    return objects;
}
async function createSignedUrl(storagePath) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db.storage.from(DATABANK_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (error) {
        logger.warn('Failed to create databank signed URL', { storagePath, error: error.message });
        return null;
    }
    return data?.signedUrl || null;
}
async function mapFolderRecord(folder) {
    const objects = await listFolderObjects(folder.id);
    const visibleFiles = objects.filter((item) => !isHiddenDatabankObject(item.name));
    return {
        ...folder,
        file_count: visibleFiles.length,
    };
}
async function mapFileRecord(folderId, item) {
    const storagePath = `${getFolderPrefix(folderId)}/${item.name}`;
    const signedUrl = await createSignedUrl(storagePath);
    const displayFileName = toDisplayFileName(item.name);
    const mimeType = item.metadata?.mimetype || item.metadata?.contentType || inferMimeType(displayFileName);
    const size = typeof item.metadata?.size === 'number' ? item.metadata.size : null;
    const createdAt = item.created_at || item.updated_at || new Date().toISOString();
    return {
        id: encodeDatabankFileId(storagePath),
        folder_id: folderId,
        file_name: displayFileName,
        file_type: mimeType,
        storage_path: storagePath,
        file_url: signedUrl || '',
        file_size: size,
        uploaded_by: 'unknown',
        created_at: createdAt,
        signed_url: signedUrl,
    };
}
router.get('/folders', (0, errorHandling_1.asyncHandler)(async (_req, res) => {
    const folders = await getFolderManifest();
    const mappedFolders = await Promise.all(folders.map((folder) => mapFolderRecord(folder)));
    mappedFolders.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ folders: mappedFolders });
}));
router.post('/folders', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const name = ensureFolderName(req.body?.name);
    const folders = await getFolderManifest();
    const duplicate = folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
        throw new errorHandling_1.AppError('A databank folder with that name already exists', errorHandling_1.ErrorType.DUPLICATE, 409);
    }
    const folder = {
        id: crypto_1.default.randomUUID(),
        name,
        parent_id: null,
        created_by: req.user?.id || 'unknown',
        created_at: new Date().toISOString(),
    };
    folders.push(folder);
    await saveFolderManifest(folders);
    const db = (0, database_1.supabaseAdminClient)();
    const { error } = await db.storage.from(DATABANK_BUCKET).upload(getKeepFilePath(folder.id), Buffer.from(''), {
        upsert: true,
        contentType: 'text/plain',
    });
    if (error) {
        throw new errorHandling_1.AppError(`Failed to initialize databank folder storage: ${error.message}`, errorHandling_1.ErrorType.DATABASE, 500);
    }
    res.status(201).json({ folder: { ...folder, file_count: 0 } });
}));
router.delete('/folders/:id', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const folderId = req.params.id;
    const folders = await getFolderManifest();
    const folder = folders.find((entry) => entry.id === folderId);
    if (!folder) {
        throw new errorHandling_1.AppError('Databank folder not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
    }
    const objects = await listFolderObjects(folderId);
    const allPaths = objects.map((item) => `${getFolderPrefix(folderId)}/${item.name}`);
    if (!allPaths.includes(getKeepFilePath(folderId))) {
        allPaths.push(getKeepFilePath(folderId));
    }
    const db = (0, database_1.supabaseAdminClient)();
    if (allPaths.length > 0) {
        const { error } = await db.storage.from(DATABANK_BUCKET).remove(allPaths);
        if (error) {
            throw new errorHandling_1.AppError(`Failed to delete databank folder contents: ${error.message}`, errorHandling_1.ErrorType.DATABASE, 500);
        }
    }
    await saveFolderManifest(folders.filter((entry) => entry.id !== folderId));
    res.json({ success: true });
}));
router.get('/folders/:folderId/files', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const folderId = req.params.folderId;
    const folders = await getFolderManifest();
    const folderExists = folders.some((folder) => folder.id === folderId);
    if (!folderExists) {
        throw new errorHandling_1.AppError('Databank folder not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
    }
    const objects = await listFolderObjects(folderId);
    const visibleFiles = objects.filter((item) => !isHiddenDatabankObject(item.name));
    const files = await Promise.all(visibleFiles.map((item) => mapFileRecord(folderId, item)));
    files.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ files });
}));
router.post('/folders/:folderId/files', upload.single('file'), (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const folderId = req.params.folderId;
    const folders = await getFolderManifest();
    const folderExists = folders.some((folder) => folder.id === folderId);
    if (!folderExists) {
        throw new errorHandling_1.AppError('Databank folder not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
    }
    if (!req.file) {
        throw new errorHandling_1.AppError('File is required', errorHandling_1.ErrorType.VALIDATION, 400);
    }
    const requestedDisplayName = String(req.body?.file_name || req.file.originalname || '').trim();
    const finalFileName = ensureDisplayNameWithExtension(requestedDisplayName || req.file.originalname, req.file.originalname);
    const storageName = toStoredFileName(finalFileName);
    const storagePath = `${getFolderPrefix(folderId)}/${storageName}`;
    const db = (0, database_1.supabaseAdminClient)();
    const { error } = await db.storage.from(DATABANK_BUCKET).upload(storagePath, req.file.buffer, {
        upsert: false,
        contentType: req.file.mimetype || inferMimeType(finalFileName),
    });
    if (error) {
        throw new errorHandling_1.AppError(`Failed to upload databank file: ${error.message}`, errorHandling_1.ErrorType.DATABASE, 500);
    }
    const signedUrl = await createSignedUrl(storagePath);
    res.status(201).json({
        file: {
            id: encodeDatabankFileId(storagePath),
            folder_id: folderId,
            file_name: finalFileName,
            file_type: req.file.mimetype || inferMimeType(finalFileName),
            storage_path: storagePath,
            file_url: signedUrl || '',
            file_size: req.file.size,
            uploaded_by: req.user?.id || 'unknown',
            created_at: new Date().toISOString(),
            signed_url: signedUrl,
        },
    });
}));
router.delete('/files/:id', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const { storagePath } = decodeDatabankFileId(req.params.id);
    const db = (0, database_1.supabaseAdminClient)();
    const { error } = await db.storage.from(DATABANK_BUCKET).remove([storagePath]);
    if (error) {
        throw new errorHandling_1.AppError(`Failed to delete databank file: ${error.message}`, errorHandling_1.ErrorType.DATABASE, 500);
    }
    res.json({ success: true });
}));
exports.default = router;
