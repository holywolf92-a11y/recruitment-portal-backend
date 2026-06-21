import { Request, Response, NextFunction } from 'express';
import { supabaseAdminClient } from '../config/database';
import { resolveAuthenticatedUserProfile } from '../services/userService';
import { findActiveTokenByHash, hashToken, touchLastUsed } from '../services/apiTokenService';

export interface AuthRequest extends Request {
  user?: { id: string; email?: string; role?: string; linkedCandidateId?: string | null; tokenId?: string };
}

const EXT_TOKEN_PREFIX = 'fal_ext_';

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = auth.replace('Bearer ', '').trim();

  try {
    // ── Extension / personal-access token path ──────────────────────────────
    // Cheap prefix sniff lets us skip the Supabase JWT round-trip entirely.
    if (token.startsWith(EXT_TOKEN_PREFIX)) {
      const row = await findActiveTokenByHash(hashToken(token));
      if (!row) return res.status(401).json({ error: 'Unauthorized - Invalid or revoked token' });

      // Look up the linked user via Supabase admin API so we get email/role
      // through the same resolver as JWT auth (no behavior drift).
      const supabase = supabaseAdminClient();
      const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(row.user_id);
      if (userErr || !userRes?.user) {
        return res.status(401).json({ error: 'Unauthorized - Token user missing' });
      }
      const resolved = await resolveAuthenticatedUserProfile(userRes.user);
      if (!resolved.isActive) return res.status(403).json({ error: 'Account is inactive' });

      req.user = {
        id: userRes.user.id,
        email: userRes.user.email,
        role: resolved.role,
        linkedCandidateId: resolved.linkedCandidateId,
        tokenId: row.id,
      };
      touchLastUsed(row.id); // fire-and-forget
      return next();
    }

    // ── Supabase JWT path (unchanged) ───────────────────────────────────────
    const supabase = supabaseAdminClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('Auth error:', error?.message || 'User not found');
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    const resolved = await resolveAuthenticatedUserProfile(user);

    if (!resolved.isActive) {
      return res.status(403).json({ error: 'Account is inactive' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: resolved.role,
      linkedCandidateId: resolved.linkedCandidateId,
    };

    next();
  } catch (err) {
    console.error('Auth error', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
