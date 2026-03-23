import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { validateEnv } from './config/env';
import { supabaseAdminClient } from './config/database';
import routes from './routes';
import { errorHandler, createLogger } from './utils/errorHandling';
import { isHostingerImapConfigured } from './services/hostingerMailboxService';
// Workers are lazy-imported inside their `if` guards below.
// Static imports would load bullmq, ioredis, googleapis & puppeteer
// into memory at startup even when workers are disabled, wasting ~150-200 MB.

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
  
  // Email feature fix: Ensure JSON middleware is properly configured

  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false, // Disable COEP to allow CORS
  }));
  app.use(cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-HMAC-Signature'],
    credentials: false,
  }));

  // Handle preflight OPTIONS requests explicitly
  app.options('*', cors());

  // Parse JSON bodies - MUST come before routes
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // Increase request timeout for file uploads (5 minutes)
  app.use((req, res, next) => {
    req.setTimeout(300000, () => {
      if (!res.headersSent) {
        res.status(408).json({ error: 'Request timeout' });
      }
    });
    next();
  });

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

    // Log email provider status
    if (process.env.HOSTINGER_SMTP_USER && process.env.HOSTINGER_SMTP_PASSWORD) {
      logger.info(`Email provider: Hostinger SMTP (${process.env.HOSTINGER_SMTP_USER})`);
    } else {
      logger.warn('Email provider: Hostinger SMTP credentials not set (HOSTINGER_SMTP_USER / HOSTINGER_SMTP_PASSWORD)');
    }

    import('./workers/hostingerPollingWorker').then(({ ensureHostingerPollingStarted, getHostingerPollingIntervalMinutes, isHostingerPollingEnabled }) => {
      if (!isHostingerPollingEnabled()) {
        logger.info('Hostinger mailbox polling worker disabled');
        return;
      }

      if (!isHostingerImapConfigured()) {
        logger.warn('Hostinger mailbox polling enabled but IMAP credentials are missing; polling disabled');
        return;
      }

      ensureHostingerPollingStarted(getHostingerPollingIntervalMinutes()).catch((err) => {
        logger.error('Failed to start Hostinger mailbox polling', err);
      });
    }).catch((err) => logger.error('Failed to load Hostinger mailbox polling worker', err));
    
    // Gmail polling is disabled — outgoing email now uses Hostinger SMTP
    if (process.env.RUN_GMAIL_POLLING === 'true') {
      if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN) {
        import('./workers/gmailPollingWorker').then(({ startGmailPolling }) => {
          startGmailPolling(5).catch((err) => {
            logger.error('Failed to start Gmail polling', err);
          });
        }).catch((err) => logger.error('Failed to load Gmail polling worker', err));
      } else {
        logger.warn('RUN_GMAIL_POLLING=true but Gmail credentials are missing; polling disabled');
      }
    } else {
      logger.info('Gmail polling worker disabled');
    }

    // Start workers if explicitly enabled
    if (process.env.RUN_WORKER === 'true' && process.env.REDIS_URL) {
      // Workers are lazy-imported here so their heavy dependencies (bullmq,
      // ioredis, puppeteer) are only loaded into memory when actually needed.
      import('./workers/cvParserWorker').then(({ startCvParserWorker }) => {
        if (process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET) {
          startCvParserWorker();
          logger.info('CV Parser worker started');
        } else {
          logger.warn('CV Parser worker not started (PYTHON_CV_PARSER_URL or PYTHON_HMAC_SECRET missing)');
        }
      }).catch((err) => logger.error('Failed to load CV Parser worker', err));

      import('./workers/documentLinkWorker').then(({ startDocumentLinkWorker }) => {
        startDocumentLinkWorker();
        logger.info('Document Link worker started');
      }).catch((err: any) => logger.error('Failed to start Document Link worker:', err));

      if (process.env.WHATSAPP_ACCESS_TOKEN) {
        import('./workers/whatsappMediaWorker').then(({ startWhatsAppMediaWorker }) => {
          startWhatsAppMediaWorker();
          logger.info('WhatsApp Media worker started');
        }).catch((err: any) => logger.error('Failed to start WhatsApp Media worker:', err));
      } else {
        logger.warn('WhatsApp Media worker not started (WHATSAPP_ACCESS_TOKEN missing)');
      }

      if (process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET) {
        import('./workers/whatsappAttachmentVerificationWorker').then(({ startWhatsAppAttachmentVerificationWorker }) => {
          startWhatsAppAttachmentVerificationWorker();
          logger.info('WhatsApp Attachment Verification worker started');
        }).catch((err: any) => logger.error('Failed to start WhatsApp Attachment Verification worker:', err));

        import('./workers/documentVerificationWorker').then(({ startDocumentVerificationWorker }) => {
          startDocumentVerificationWorker();
          logger.info('Document Verification worker started');
        }).catch((err: any) => {
          logger.error('Failed to start Document Verification worker:', err);
          logger.warn('Document verification will not run automatically. Use reprocess endpoint to trigger manually.');
        });
      } else {
        logger.warn('Document Verification worker not started (PYTHON_CV_PARSER_URL or PYTHON_HMAC_SECRET missing)');
        logger.warn('Documents will remain in "Pending" status. Configure Python service or use reprocess endpoint.');
      }
    } else {
      logger.info('Workers not started (set RUN_WORKER=true and configure REDIS_URL)');
      logger.warn('Document verification will not run automatically. Use POST /api/documents/candidate-documents/:id/reprocess to trigger manually.');
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
