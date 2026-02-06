"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnv = validateEnv;
function validateEnv() {
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
        'BREVO_SMTP_HOST',
        'BREVO_SMTP_PORT',
        'BREVO_SMTP_USER',
        'BREVO_SMTP_PASSWORD',
        'BREVO_FROM_EMAIL',
        'BREVO_FROM_NAME',
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
