import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function supabaseAdminClient(): SupabaseClient {
  if (!process.env.SUPABASE_URL) {
    throw new Error('Missing SUPABASE_URL');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('SUPABASE_SERVICE_ROLE_KEY not found, using anon key for admin operations (not recommended for production)');
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || '');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function supabaseUserClient(jwt: string): SupabaseClient {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  return client;
}
