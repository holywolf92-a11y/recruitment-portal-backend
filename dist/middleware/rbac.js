"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = requireRole;
exports.requirePermission = requirePermission;
function normalizeRequiredRole(role) {
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
function requireRole(...roles) {
    return (req, res, next) => {
        const user = req.user;
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        const allowedRoles = new Set(roles.map(normalizeRequiredRole));
        const currentRole = normalizeRequiredRole(user.role || '');
        if (currentRole === 'admin') {
            return next();
        }
        if (!allowedRoles.has(currentRole))
            return res.status(403).json({ error: 'Forbidden' });
        next();
    };
}
function requirePermission(_action, _resource) {
    return (_req, _res, next) => {
        // Placeholder: implement permission matrix lookup
        next();
    };
}
