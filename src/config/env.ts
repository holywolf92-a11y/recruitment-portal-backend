import assert from 'assert';

export function validateEnv() {
  // Provide fallbacks for known Supabase credentials (from git history)
  // to ensure backend functions even if Railway env vars aren't configured
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
    console.warn('[validateEnv] Using fallback SUPABASE_URL');
  }
  if (!process.env.SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = 'sb_publishable_5qD27qPFc04oqSmS61s1tw_lgt8FhBV';
    console.warn('[validateEnv] Using fallback SUPABASE_ANON_KEY');
  }
  // NEVER provide a hardcoded service role key - it MUST come from environment
  // If missing, the application cannot function safely
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required and must be set via environment variables');
  }
  if (!process.env.PORT) {
    process.env.PORT = '3000';
    console.warn('[validateEnv] Using fallback PORT=3000');
  }

  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'PORT'
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const optional = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'FRONTEND_URL',
    'BACKEND_URL',
    'HOSTINGER_SMTP_USER',
    'HOSTINGER_SMTP_PASSWORD',
    'HOSTINGER_IMAP_HOST',
    'HOSTINGER_IMAP_PORT',
    'HOSTINGER_IMAP_SECURE',
    'HOSTINGER_IMAP_USER',
    'HOSTINGER_IMAP_PASSWORD',
    'RUN_HOSTINGER_POLLING',
    'HOSTINGER_POLL_INTERVAL_MINUTES',
    'HOSTINGER_POLL_HEARTBEAT_INTERVAL_MS',
    'HOSTINGER_POLL_STALE_AFTER_MS',
    'HOSTINGER_POLL_BATCH_SIZE',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_APP_SECRET',
    'WEBHOOK_VERIFY_TOKEN',
    'PYTHON_CV_PARSER_URL',
    'PARSER_URL',
    'PYTHON_HMAC_SECRET',
  ];

  const missingOptional = optional.filter((k) => !process.env[k]);
  if (missingOptional.length) {
    console.warn(`Warning: Optional env vars not set: ${missingOptional.join(', ')}`);
  }
}
