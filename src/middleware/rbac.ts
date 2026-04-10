import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

function normalizeRequiredRole(role: string) {
  const normalized = role.trim().toLowerCase();

  if (normalized === 'admin' || normalized === 'super_admin') {
    return 'admin';
  }

  if (['worker', 'employee', 'manager', 'recruiter', 'viewer', 'staff'].includes(normalized)) {
    return 'worker';
  }

  if (normalized === 'partner') {
    return 'partner';
  }

  if (normalized === 'candidate') {
    return 'candidate';
  }

  return normalized;
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const allowedRoles = new Set(roles.map(normalizeRequiredRole));
    const currentRole = normalizeRequiredRole(user.role || '');

    if (currentRole === 'admin') {
      return next();
    }

    if (!allowedRoles.has(currentRole)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

export function requirePermission(_action: string, _resource: string) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    // Placeholder: implement permission matrix lookup
    next();
  };
}
