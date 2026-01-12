"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAdminClient = supabaseAdminClient;
exports.supabaseUserClient = supabaseUserClient;
const supabase_js_1 = require("@supabase/supabase-js");
function supabaseAdminClient() {
    if (!process.env.SUPABASE_URL) {
        throw new Error('Missing SUPABASE_URL');
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn('SUPABASE_SERVICE_ROLE_KEY not found, using anon key for admin operations (not recommended for production)');
        return (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || '');
    }
    return (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
function supabaseUserClient(jwt) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    }
    const client = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } }
    });
    return client;
}
