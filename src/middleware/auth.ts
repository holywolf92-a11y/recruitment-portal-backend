import { Request, Response, NextFunction } from 'express';
import { supabaseAdminClient } from '../config/database';
import { resolveAuthenticatedUserProfile } from '../services/userService';

export interface AuthRequest extends Request {
  user?: { id: string; email?: string; role?: string; linkedCandidateId?: string | null };
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = auth.replace('Bearer ', '').trim();

  try {
    const supabase = supabaseAdminClient();
    
    // Verify JWT token and get user info
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
