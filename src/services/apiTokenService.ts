// Personal-access-token service for the Chrome extension (and any future
// programmatic clients). Token format: fal_ext_<32 url-safe-base64 chars>.
// Stored as SHA-256 hex; plaintext shown to the user exactly once on issuance.

import { createHash, randomBytes } from 'crypto';
import { supabaseAdminClient } from '../config/database';
import { AppError, ErrorType, createLogger } from '../utils/errorHandling';

const logger = createLogger('ApiTokenService');

const TOKEN_PREFIX = 'fal_ext_';
const TOKEN_BYTES = 24; // 24 bytes of CSPRNG → 32 base64url chars → ~192 bits entropy

export interface ApiTokenRow {
  id: string;
  user_id: string;
  token_prefix: string;
  name: string;
  scope: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function generatePlaintextToken(): string {
  // base64url so the token is URL-safe + header-safe (no '/', '+', or padding).
  const body = randomBytes(TOKEN_BYTES).toString('base64url');
  return TOKEN_PREFIX + body;
}

/**
 * Mint a new token for a user. The plaintext value is returned ONCE here and
 * never stored — the caller MUST surface it to the user immediately and warn
 * that it cannot be retrieved again.
 */
export async function issueToken(args: { userId: string; name: string; expiresAt?: string | null }): Promise<{
  plaintext: string;
  row: ApiTokenRow;
}> {
  const plaintext = generatePlaintextToken();
  const tokenHash = hashToken(plaintext);
  // Show the LAST 8 chars (à la GitHub / Stripe / Linear PATs): the literal
  // `fal_ext_` prefix is identical across all tokens so a leading slice gives
  // users nothing useful to recognize their token by. Trailing bytes are also
  // what users tend to remember after pasting once.
  const tokenPrefix = '…' + plaintext.slice(-8);

  const db = supabaseAdminClient();
  const { data, error } = await db.from('api_tokens').insert({
    user_id:      args.userId,
    token_hash:   tokenHash,
    token_prefix: tokenPrefix,
    name:         args.name.trim().slice(0, 80),
    scope:        'extension',
    expires_at:   args.expiresAt ?? null,
  }).select('*').single();

  if (error) {
    logger.error('Failed to insert api_token', { err: error.message });
    throw new AppError('Failed to create token', ErrorType.DATABASE, 500);
  }
  return { plaintext, row: data as ApiTokenRow };
}

export async function listTokensForUser(userId: string): Promise<ApiTokenRow[]> {
  const db = supabaseAdminClient();
  const { data, error } = await db.from('api_tokens')
    .select('id, user_id, token_prefix, name, scope, last_used_at, expires_at, revoked_at, created_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    logger.error('Failed to list api_tokens', { err: error.message, userId });
    throw new AppError('Failed to list tokens', ErrorType.DATABASE, 500);
  }
  return (data ?? []) as ApiTokenRow[];
}

export async function revokeToken(args: { id: string; userId: string }): Promise<void> {
  const db = supabaseAdminClient();
  const { error } = await db.from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', args.id)
    .eq('user_id', args.userId)  // can only revoke own tokens
    .is('revoked_at', null);
  if (error) {
    logger.error('Failed to revoke api_token', { err: error.message, id: args.id });
    throw new AppError('Failed to revoke token', ErrorType.DATABASE, 500);
  }
}

/**
 * Hot path — called on every request that presents a fal_ext_ bearer token.
 * Returns null on cache-miss / revoked / expired so authenticate() can
 * cleanly fall through to the Supabase JWT branch (or 401).
 */
export async function findActiveTokenByHash(tokenHash: string): Promise<ApiTokenRow | null> {
  const db = supabaseAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await db.from('api_tokens')
    .select('id, user_id, token_prefix, name, scope, last_used_at, expires_at, revoked_at, created_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .maybeSingle();
  if (error) {
    logger.warn('Token lookup failed', { err: error.message });
    return null;
  }
  return (data as ApiTokenRow) ?? null;
}

/**
 * Fire-and-forget — don't block the request on this write. Failures are logged
 * but never propagated; stale last_used_at is annoying, not security-critical.
 */
export function touchLastUsed(tokenId: string): void {
  const db = supabaseAdminClient();
  // Both onFulfilled AND onRejected — a transport-level rejection (DNS/socket)
  // without onRejected would propagate as an unhandled-rejection and, depending
  // on Node config, crash the process. This runs on every authenticated extension
  // call, so a flaky network minute could otherwise take the API down.
  db.from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tokenId)
    .then(
      (res) => { if (res.error) logger.warn('touchLastUsed failed', { tokenId, err: res.error.message }); },
      (err) => { logger.warn('touchLastUsed rejected', { tokenId, err: err?.message ?? String(err) }); },
    );
}
