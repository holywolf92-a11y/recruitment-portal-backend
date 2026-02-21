import { Queue } from 'bullmq';
import { redis } from './redis';

export const cvParsingQueue = new Queue('cv-parsing', {
  connection: redis,
});

export const documentVerificationQueue = new Queue('document-verification', {
  connection: redis,
});

export const whatsappMediaQueue = new Queue('whatsapp-media', {
  connection: redis,
});

// Identity-first WhatsApp flow: verify/extract identity from inbox_attachments BEFORE linking/binding.
export const whatsappAttachmentVerificationQueue = new Queue('whatsapp-attachment-verification', {
  connection: redis,
});
