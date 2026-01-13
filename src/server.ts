import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { validateEnv } from './config/env';
import routes from './routes';
import { errorHandler, createLogger } from './utils/errorHandling';
import { startGmailPolling } from './workers/gmailPollingWorker';
import { startCvParserWorker } from './workers/cvParserWorker';
import { startDocumentLinkWorker } from './workers/documentLinkWorker';

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
    limit: '50mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  logger.info('Loading routes...');
  app.use('/api', routes);
  logger.info('Routes loaded successfully');

  // Global error handler
  app.use(errorHandler);

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server listening on port ${PORT}`);
    
    // Start Gmail polling worker only when explicitly enabled.
    // This prevents noisy log spam (e.g. invalid_client) when creds are present but not valid.
    if (process.env.RUN_GMAIL_POLLING === 'true') {
      if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN) {
        startGmailPolling(5).catch((err) => {
          logger.error('Failed to start Gmail polling', err);
        });
      } else {
        logger.warn('RUN_GMAIL_POLLING=true but Gmail credentials are missing; polling disabled');
      }
    } else {
      logger.info('Gmail polling worker disabled (set RUN_GMAIL_POLLING=true to enable)');
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
        
        // Start Document Link worker alongside CV parser
        startDocumentLinkWorker();
        logger.info('Document Link worker started');
      } catch (err) {
        logger.error('Failed to start workers', err);
      }
    } else {
      logger.info('Workers not started (set RUN_WORKER=true and configure REDIS_URL + PYTHON vars)');
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
