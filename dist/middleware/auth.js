"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const database_1 = require("../config/database");
const userService_1 = require("../services/userService");
async function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = auth.replace('Bearer ', '').trim();
    try {
        const supabase = (0, database_1.supabaseAdminClient)();
        // Verify JWT token and get user info
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            console.error('Auth error:', error?.message || 'User not found');
            return res.status(401).json({ error: 'Unauthorized - Invalid token' });
        }
        const resolved = await (0, userService_1.resolveAuthenticatedUserProfile)(user);
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
    }
    catch (err) {
        console.error('Auth error', err);
        return res.status(401).json({ error: 'Unauthorized' });
    }
}
