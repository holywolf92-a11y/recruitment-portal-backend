import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { validateEnv } from './config/env';
import routes from './routes';
import { errorHandler, createLogger } from './utils/errorHandling';
import { startGmailPolling } from './workers/gmailPollingWorker';
import { startCvParserWorker } from './workers/cvParserWorker';

dotenv.config();
validateEnv();

const logger = createLogger('Server');

logger.info('Environment variables loaded', {
  supabaseUrl: process.env.SUPABASE_URL ? 'loaded' : 'missing',
  supabaseKey: process.env.SUPABASE_ANON_KEY ? 'loaded' : 'missing',
  port: process.env.PORT
});

try {
  const app = express();
  const PORT = parseInt(process.env.PORT || '1000', 10);

  app.use(helmet());
  app.use(cors());
  // Capture raw body for signature validation (e.g., Meta WhatsApp webhooks)
  app.use(express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  logger.info('Loading routes...');
  app.use('/api', routes);
  logger.info('Routes loaded successfully');

  // Global error handler
  app.use(errorHandler);

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server listening on port ${PORT}`);
    
    // Start Gmail polling worker if credentials available
    if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN) {
      startGmailPolling(5).catch((err) => {
        logger.error('Failed to start Gmail polling', err);
      });
    } else {
      logger.info('Gmail credentials not configured, polling worker disabled');
    }

    // Start CV parser worker if explicitly enabled and env configured
    if (
      process.env.RUN_WORKER === 'true' &&
      process.env.REDIS_URL &&
      process.env.PYTHON_CV_PARSER_URL &&
      process.env.PYTHON_HMAC_SECRET
    ) {
      try {
        startCvParserWorker();
        logger.info('CV Parser worker started');
      } catch (err) {
        logger.error('Failed to start CV parser worker', err);
      }
    } else {
      logger.info('CV Parser worker not started (set RUN_WORKER=true and configure REDIS_URL + PYTHON vars)');
    }
  }).on('error', (err) => {
    logger.error('Server failed to start', err);
    process.exit(1);
  }).on('listening', () => {
    logger.info('Server is now listening for connections');
  });
} catch (error) {
  logger.error('Failed to initialize server', error);
  process.exit(1);
}
