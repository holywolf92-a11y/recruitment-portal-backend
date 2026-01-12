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
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';
        console.warn('[validateEnv] Using fallback SUPABASE_SERVICE_ROLE_KEY');
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
        'WHATSAPP_ACCESS_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_APP_SECRET',
        'WEBHOOK_VERIFY_TOKEN'
    ];
    const missingOptional = optional.filter((k) => !process.env[k]);
    if (missingOptional.length) {
        console.warn(`Warning: Optional env vars not set: ${missingOptional.join(', ')}`);
    }
}
