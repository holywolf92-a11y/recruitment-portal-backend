"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = requireRole;
exports.requirePermission = requirePermission;
function requireRole(...roles) {
    return (req, res, next) => {
        const user = req.user;
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        if (!roles.includes(user.role || ''))
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
