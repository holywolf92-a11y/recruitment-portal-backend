import { Request, Response, NextFunction } from 'express';
import { supabaseAdminClient } from '../config/database';

export interface AuthRequest extends Request {
  user?: { id: string; email?: string; role?: string } | null;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = auth.replace('Bearer ', '').trim();

  try {
    // NOTE: Replace with proper JWT verification or Supabase auth API call
    const supabase = supabaseAdminClient();
    // Attempt to get user by JWT - this requires server-side validation logic
    // For now, set a placeholder user. Replace with `supabase.auth.getUser()` style call.
    req.user = { id: 'unknown', email: undefined, role: 'Recruiter' };
    next();
  } catch (err) {
    console.error('Auth error', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
