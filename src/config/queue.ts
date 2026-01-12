import { Queue } from 'bullmq';
import { redis } from './redis';

export const cvParsingQueue = new Queue('cv-parsing', {
  connection: redis,
});
