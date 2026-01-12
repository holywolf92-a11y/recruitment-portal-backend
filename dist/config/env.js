"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnv = validateEnv;
function validateEnv() {
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
