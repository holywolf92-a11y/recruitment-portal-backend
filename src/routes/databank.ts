import crypto from 'crypto';
import multer from 'multer';
import { Router, Response } from 'express';
import { supabaseAdminClient } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { asyncHandler, AppError, ErrorType, createLogger } from '../utils/errorHandling';

const router = Router();
const logger = createLogger('DatabankRoutes');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const DATABANK_BUCKET = 'documents';
const DATABANK_ROOT = 'databank';
const DATABANK_MANIFEST_PATH = `${DATABANK_ROOT}/_folders.json`;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

interface DatabankFolderRecord {
  id: string;
  name: string;
  parent_id: string | null;
  created_by: string;
  created_at: string;
}

interface DatabankFileRecord {
  id: string;
  folder_id: string;
  file_name: string;
  file_type: string;
  storage_path: string;
  file_url: string;
  file_size: number | null;
  uploaded_by: string;
  created_at: string;
  signed_url: string | null;
}

router.use(authenticate);
router.use(requireRole('admin', 'manager', 'recruiter'));

function getFolderPrefix(folderId: string): string {
  return `${DATABANK_ROOT}/${folderId}`;
}

function getKeepFilePath(folderId: string): string {
  return `${getFolderPrefix(folderId)}/.keep`;
}

function isHiddenDatabankObject(name: string): boolean {
  return !name || name.startsWith('.');
}

function inferMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

function ensureFolderName(name: unknown): string {
  const normalized = String(name || '').trim();
  if (!normalized) {
    throw new AppError('Folder name is required', ErrorType.VALIDATION, 400);
  }
  if (normalized.length > 120) {
    throw new AppError('Folder name must be 120 characters or fewer', ErrorType.VALIDATION, 400);
  }
  return normalized;
}

function sanitizeFileNameSegment(name: string): string {
  const trimmed = name.trim();
  const collapsed = trimmed.replace(/\s+/g, ' ');
  const sanitized = collapsed.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/[\/\\]/g, '_');
  return sanitized || 'file';
}

function toStoredFileName(displayName: string): string {
  return `${crypto.randomUUID()}__${sanitizeFileNameSegment(displayName)}`;
}

function toDisplayFileName(storedName: string): string {
  const separatorIndex = storedName.indexOf('__');
  if (separatorIndex < 0) {
    return storedName;
  }
  return storedName.slice(separatorIndex + 2) || storedName;
}

function ensureDisplayNameWithExtension(displayName: string, originalFileName: string): string {
  const safeDisplayName = sanitizeFileNameSegment(displayName);
  const originalExtIndex = originalFileName.lastIndexOf('.');
  const originalExtension = originalExtIndex >= 0 ? originalFileName.slice(originalExtIndex) : '';
  const hasExtension = safeDisplayName.lastIndexOf('.') > 0;
  return hasExtension ? safeDisplayName : `${safeDisplayName}${originalExtension}`;
}

function encodeDatabankFileId(storagePath: string): string {
  return Buffer.from(JSON.stringify({ storagePath }), 'utf8').toString('base64url');
}

function decodeDatabankFileId(fileId: string): { storagePath: string } {
  try {
    const decoded = JSON.parse(Buffer.from(fileId, 'base64url').toString('utf8')) as { storagePath?: string };
    if (!decoded.storagePath || !decoded.storagePath.startsWith(`${DATABANK_ROOT}/`)) {
      throw new Error('Invalid storage path');
    }
    return { storagePath: decoded.storagePath };
  } catch {
    throw new AppError('Invalid databank file id', ErrorType.VALIDATION, 400);
  }
}

async function readJsonBlob(path: string): Promise<any | null> {
  const db = supabaseAdminClient();
  const { data, error } = await db.storage.from(DATABANK_BUCKET).download(path);
  if (error) {
    const message = String(error.message || '').toLowerCase();
    if (message.includes('not found') || message.includes('404') || message.includes('does not exist')) {
      return null;
    }
    throw new AppError(`Failed to read storage object ${path}: ${error.message}`, ErrorType.DATABASE, 500);
  }
  const text = await data.text();
  return JSON.parse(text);
}

async function writeJsonBlob(path: string, payload: unknown): Promise<void> {
  const db = supabaseAdminClient();
  const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  const { error } = await db.storage.from(DATABANK_BUCKET).upload(path, buffer, {
    upsert: true,
    contentType: 'application/json',
  });
  if (error) {
    throw new AppError(`Failed to write storage object ${path}: ${error.message}`, ErrorType.DATABASE, 500);
  }
}

async function storageObjectExists(path: string): Promise<boolean> {
  const db = supabaseAdminClient();
  const lastSlashIndex = path.lastIndexOf('/');
  const prefix = lastSlashIndex >= 0 ? path.slice(0, lastSlashIndex) : '';
  const fileName = lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path;

  const { data, error } = await db.storage.from(DATABANK_BUCKET).list(prefix, {
    limit: 100,
    search: fileName,
  });

  if (error) {
    throw new AppError(`Failed to inspect storage object ${path}: ${error.message}`, ErrorType.DATABASE, 500);
  }

  return (data || []).some((item) => item.name === fileName);
}

async function getFolderManifest(): Promise<DatabankFolderRecord[]> {
  const manifestExists = await storageObjectExists(DATABANK_MANIFEST_PATH);
  if (!manifestExists) {
    return [];
  }

  const manifest = await readJsonBlob(DATABANK_MANIFEST_PATH);
  if (!manifest) return [];
  if (!Array.isArray(manifest.folders)) return [];
  return manifest.folders as DatabankFolderRecord[];
}

async function saveFolderManifest(folders: DatabankFolderRecord[]): Promise<void> {
  await writeJsonBlob(DATABANK_MANIFEST_PATH, { folders });
}

async function listFolderObjects(folderId: string): Promise<any[]> {
  const db = supabaseAdminClient();
  const folderPrefix = getFolderPrefix(folderId);
  const objects: any[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const { data, error } = await db.storage.from(DATABANK_BUCKET).list(folderPrefix, {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error) {
      throw new AppError(`Failed to list databank folder ${folderId}: ${error.message}`, ErrorType.DATABASE, 500);
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

async function createSignedUrl(storagePath: string): Promise<string | null> {
  const db = supabaseAdminClient();
  const { data, error } = await db.storage.from(DATABANK_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) {
    logger.warn('Failed to create databank signed URL', { storagePath, error: error.message });
    return null;
  }
  return data?.signedUrl || null;
}

async function mapFolderRecord(folder: DatabankFolderRecord) {
  const objects = await listFolderObjects(folder.id);
  const visibleFiles = objects.filter((item) => !isHiddenDatabankObject(item.name));
  return {
    ...folder,
    file_count: visibleFiles.length,
  };
}

async function mapFileRecord(folderId: string, item: any): Promise<DatabankFileRecord> {
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

router.get(
  '/folders',
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const folders = await getFolderManifest();
    const mappedFolders = await Promise.all(folders.map((folder) => mapFolderRecord(folder)));
    mappedFolders.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ folders: mappedFolders });
  })
);

router.post(
  '/folders',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const name = ensureFolderName(req.body?.name);
    const folders = await getFolderManifest();
    const duplicate = folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      throw new AppError('A databank folder with that name already exists', ErrorType.DUPLICATE, 409);
    }

    const folder: DatabankFolderRecord = {
      id: crypto.randomUUID(),
      name,
      parent_id: null,
      created_by: req.user?.id || 'unknown',
      created_at: new Date().toISOString(),
    };

    folders.push(folder);
    await saveFolderManifest(folders);

    const db = supabaseAdminClient();
    const { error } = await db.storage.from(DATABANK_BUCKET).upload(getKeepFilePath(folder.id), Buffer.from(''), {
      upsert: true,
      contentType: 'text/plain',
    });
    if (error) {
      throw new AppError(`Failed to initialize databank folder storage: ${error.message}`, ErrorType.DATABASE, 500);
    }

    res.status(201).json({ folder: { ...folder, file_count: 0 } });
  })
);

router.delete(
  '/folders/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const folderId = req.params.id;
    const folders = await getFolderManifest();
    const folder = folders.find((entry) => entry.id === folderId);
    if (!folder) {
      throw new AppError('Databank folder not found', ErrorType.NOT_FOUND, 404);
    }

    const objects = await listFolderObjects(folderId);
    const allPaths = objects.map((item) => `${getFolderPrefix(folderId)}/${item.name}`);
    if (!allPaths.includes(getKeepFilePath(folderId))) {
      allPaths.push(getKeepFilePath(folderId));
    }

    const db = supabaseAdminClient();
    if (allPaths.length > 0) {
      const { error } = await db.storage.from(DATABANK_BUCKET).remove(allPaths);
      if (error) {
        throw new AppError(`Failed to delete databank folder contents: ${error.message}`, ErrorType.DATABASE, 500);
      }
    }

    await saveFolderManifest(folders.filter((entry) => entry.id !== folderId));
    res.json({ success: true });
  })
);

router.get(
  '/folders/:folderId/files',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const folderId = req.params.folderId;
    const folders = await getFolderManifest();
    const folderExists = folders.some((folder) => folder.id === folderId);
    if (!folderExists) {
      throw new AppError('Databank folder not found', ErrorType.NOT_FOUND, 404);
    }

    const objects = await listFolderObjects(folderId);
    const visibleFiles = objects.filter((item) => !isHiddenDatabankObject(item.name));
    const files = await Promise.all(visibleFiles.map((item) => mapFileRecord(folderId, item)));
    files.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ files });
  })
);

router.post(
  '/folders/:folderId/files',
  upload.single('file'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const folderId = req.params.folderId;
    const folders = await getFolderManifest();
    const folderExists = folders.some((folder) => folder.id === folderId);
    if (!folderExists) {
      throw new AppError('Databank folder not found', ErrorType.NOT_FOUND, 404);
    }
    if (!req.file) {
      throw new AppError('File is required', ErrorType.VALIDATION, 400);
    }

    const requestedDisplayName = String(req.body?.file_name || req.file.originalname || '').trim();
    const finalFileName = ensureDisplayNameWithExtension(requestedDisplayName || req.file.originalname, req.file.originalname);
    const storageName = toStoredFileName(finalFileName);
    const storagePath = `${getFolderPrefix(folderId)}/${storageName}`;
    const db = supabaseAdminClient();

    const { error } = await db.storage.from(DATABANK_BUCKET).upload(storagePath, req.file.buffer, {
      upsert: false,
      contentType: req.file.mimetype || inferMimeType(finalFileName),
    });
    if (error) {
      throw new AppError(`Failed to upload databank file: ${error.message}`, ErrorType.DATABASE, 500);
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
      } satisfies DatabankFileRecord,
    });
  })
);

router.delete(
  '/files/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storagePath } = decodeDatabankFileId(req.params.id);
    const db = supabaseAdminClient();
    const { error } = await db.storage.from(DATABANK_BUCKET).remove([storagePath]);
    if (error) {
      throw new AppError(`Failed to delete databank file: ${error.message}`, ErrorType.DATABASE, 500);
    }
    res.json({ success: true });
  })
);

export default router;