import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { validateEnv } from './config/env';
import { supabaseAdminClient } from './config/database';
import routes from './routes';
import { errorHandler, createLogger } from './utils/errorHandling';
import { startGmailPolling } from './workers/gmailPollingWorker';
import { startCvParserWorker } from './workers/cvParserWorker';
import { startDocumentLinkWorker } from './workers/documentLinkWorker';
import { startDocumentVerificationWorker } from './workers/documentVerificationWorker';

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
  
  // Increase request timeout for file uploads (5 minutes)
  app.use((req, res, next) => {
    // Set timeout to 5 minutes for file uploads
    req.setTimeout(300000, () => {
      if (!res.headersSent) {
        res.status(408).json({ error: 'Request timeout' });
      }
    });
    next();
  });
  
  // Increase body size limits for file uploads (base64-encoded PDFs, etc.)
  // Skip body parsing for multipart/form-data (handled by multer)
  app.use((req, res, next) => {
    if (req.headers['content-type']?.startsWith('multipart/form-data')) {
      return next();
    }
    express.json({
      limit: '100mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      }
    })(req, res, next);
  });
  app.use((req, res, next) => {
    if (req.headers['content-type']?.startsWith('multipart/form-data')) {
      return next();
    }
    express.urlencoded({ extended: true, limit: '100mb' })(req, res, next);
  });
  app.use(express.text({ limit: '100mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/health/supabase', async (_req, res) => {
    try {
      const supabase = supabaseAdminClient();
      // Lightweight connectivity/permission check. Avoid returning any data.
      const { error } = await supabase
        .from('candidates')
        .select('id', { head: true, count: 'exact' })
        .limit(1);

      if (error) {
        return res.status(500).json({
          status: 'error',
          service: 'supabase',
          message: error.message,
          code: error.code || null
        });
      }

      return res.json({ status: 'ok', service: 'supabase' });
    } catch (err: any) {
      return res.status(500).json({
        status: 'error',
        service: 'supabase',
        message: err?.message || 'Unknown error'
      });
    }
  });

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
        
        // Start Document Verification worker
        startDocumentVerificationWorker();
        logger.info('Document Verification worker started');
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
