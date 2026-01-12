import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(user.role || '')) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

export function requirePermission(_action: string, _resource: string) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    // Placeholder: implement permission matrix lookup
    next();
  };
}
