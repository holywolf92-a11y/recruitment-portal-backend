import { Queue } from 'bullmq';
import { redis } from './redis';

export const cvParsingQueue = new Queue('cv-parsing', {
  connection: redis,
});

export const documentVerificationQueue = new Queue('document-verification', {
  connection: redis,
});
