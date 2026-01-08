import { AppError, ErrorType } from '../utils/errorHandling';

interface Message {
  id: string;
  source: string;
  external_message_id: string;
  payload?: any;
  status?: string;
  received_at?: string;
  created_at?: string;
}

interface Attachment {
  id: string;
  inbox_message_id: string;
  candidate_id?: string | null;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type?: string | null;
  sha256?: string | null;
  attachment_type?: string | null;
  created_at?: string;
}

const messages = new Map<string, Message>();
const messagesByExternalId = new Map<string, string>();
const attachments = new Map<string, Attachment>();
const cvDedupIndex = new Set<string>(); // `${sha256}|cv`

function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function memCreateMessage(input: {
  source: string;
  externalMessageId: string;
  payload?: any;
  status?: string;
  receivedAt?: string;
}) {
  if (messagesByExternalId.has(input.externalMessageId)) {
    throw new AppError('external_message_id already exists', ErrorType.DUPLICATE, 409);
  }
  const id = newId('msg');
  const m: Message = {
    id,
    source: input.source,
    external_message_id: input.externalMessageId,
    payload: input.payload ?? null,
    status: input.status ?? 'pending',
    received_at: input.receivedAt ?? new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  messages.set(id, m);
  messagesByExternalId.set(input.externalMessageId, id);
  return m;
}

export async function memListMessages(filters: { source?: string; status?: string; limit?: number; offset?: number }) {
  let arr = Array.from(messages.values());
  if (filters.source) arr = arr.filter((m) => m.source === filters.source);
  if (filters.status) arr = arr.filter((m) => m.status === filters.status);
  arr = arr.sort((a, b) => (b.received_at || '').localeCompare(a.received_at || ''));

  const total = arr.length;
  if (filters.limit !== undefined && filters.offset !== undefined) {
    arr = arr.slice(filters.offset, filters.offset + filters.limit);
  } else if (filters.limit !== undefined) {
    arr = arr.slice(0, filters.limit);
  }

  return { messages: arr, total, limit: filters.limit, offset: filters.offset };
}

export async function memGetMessage(id: string) {
  const m = messages.get(id);
  if (!m) throw new AppError('Inbox message not found', ErrorType.NOT_FOUND, 404);
  return m;
}

export async function memUpdateMessage(id: string, input: { status?: string; payload?: any }) {
  const m = messages.get(id);
  if (!m) throw new AppError('Inbox message not found', ErrorType.NOT_FOUND, 404);
  if (input.status !== undefined) m.status = input.status;
  if (input.payload !== undefined) m.payload = input.payload;
  return m;
}

export async function memDeleteMessage(id: string) {
  const m = messages.get(id);
  if (!m) throw new AppError('Inbox message not found', ErrorType.NOT_FOUND, 404);
  messages.delete(id);
  messagesByExternalId.delete(m.external_message_id);
  // Remove related attachments
  for (const [aid, a] of attachments) {
    if (a.inbox_message_id === id) attachments.delete(aid);
  }
  return m;
}

export async function memCreateAttachment(input: {
  inboxMessageId: string;
  fileName: string;
  mimeType?: string;
  attachmentType?: string;
  storageBucket: string;
  storagePath: string;
  sha256?: string;
  candidateId?: string;
}) {
  const msg = messages.get(input.inboxMessageId);
  if (!msg) throw new AppError('Inbox message not found', ErrorType.NOT_FOUND, 404);
  const id = newId('att');
  const att: Attachment = {
    id,
    inbox_message_id: input.inboxMessageId,
    candidate_id: input.candidateId ?? null,
    storage_bucket: input.storageBucket,
    storage_path: input.storagePath,
    file_name: input.fileName,
    mime_type: input.mimeType ?? null,
    sha256: input.sha256 ?? null,
    attachment_type: input.attachmentType ?? 'cv',
    created_at: new Date().toISOString(),
  };

  // Dedup on sha256 + type=cv
  if (att.sha256 && att.attachment_type === 'cv') {
    const key = `${att.sha256}|cv`;
    if (cvDedupIndex.has(key)) {
      throw new AppError('Duplicate attachment (sha256 + type)', ErrorType.DUPLICATE, 409);
    }
    cvDedupIndex.add(key);
  }

  attachments.set(id, att);
  return att;
}

export async function memListAttachmentsForMessage(messageId: string) {
  return Array.from(attachments.values()).filter((a) => a.inbox_message_id === messageId);
}

export async function memDeleteAttachment(id: string) {
  const a = attachments.get(id);
  if (!a) throw new AppError('Inbox attachment not found', ErrorType.NOT_FOUND, 404);
  attachments.delete(id);
  return a;
}
