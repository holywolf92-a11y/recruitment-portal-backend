import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Memory-leak fix (OOM root cause) ────────────────────────────────────────
// Every createClient() from @supabase/supabase-js spins up a GoTrueClient that,
// on Node, starts a 30-second auto-refresh setInterval and retains its whole
// object graph — which can never be garbage-collected while that timer is alive.
//
// supabaseAdminClient() was called FRESH at all 343 DB call sites (every
// WhatsApp webhook, message, and CV), so each DB touch leaked one client + one
// live timer forever. Under Pakistan-business-hours traffic that accumulated
// ~170MB and OOM-crashed the 512MB backend; overnight (no traffic) it plateaued.
//
// Fix: (1) disable the auth timers everywhere — server-side clients use a static
// service key or a per-request Authorization header, so token auto-refresh is
// pointless; (2) memoize the service-role client as a process-wide singleton
// (Supabase clients are designed to be shared), so only ONE ever exists.
const SERVER_AUTH = {
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false,
} as const;

let adminClient: SupabaseClient | null = null;

export function supabaseAdminClient(): SupabaseClient {
  if (!process.env.SUPABASE_URL) {
    throw new Error('Missing SUPABASE_URL');
  }
  if (adminClient) return adminClient;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.warn('SUPABASE_SERVICE_ROLE_KEY not found, using anon key for admin operations (not recommended for production)');
    adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || '', { auth: SERVER_AUTH });
  } else {
    adminClient = createClient(process.env.SUPABASE_URL, serviceKey, { auth: SERVER_AUTH });
  }
  return adminClient;
}

export function supabaseUserClient(jwt: string): SupabaseClient {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }
  // Per-request client (auth scoped to the caller's JWT via header) — cannot be
  // a shared singleton, but MUST disable the auth auto-refresh timer so it is
  // GC-eligible as soon as the request finishes instead of leaking a timer.
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: SERVER_AUTH,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
