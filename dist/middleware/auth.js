"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const database_1 = require("../config/database");
async function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = auth.replace('Bearer ', '').trim();
    try {
        // NOTE: Replace with proper JWT verification or Supabase auth API call
        const supabase = (0, database_1.supabaseAdminClient)();
        // Attempt to get user by JWT - this requires server-side validation logic
        // For now, set a placeholder user. Replace with `supabase.auth.getUser()` style call.
        req.user = { id: 'unknown', email: undefined, role: 'Recruiter' };
        next();
    }
    catch (err) {
        console.error('Auth error', err);
        return res.status(401).json({ error: 'Unauthorized' });
    }
}
