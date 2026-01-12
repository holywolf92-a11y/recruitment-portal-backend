"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserById = getUserById;
exports.getUserProfile = getUserProfile;
const database_1 = require("../config/database");
async function getUserById(userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db.from('users').select('*').eq('id', userId).single();
    if (error)
        throw error;
    return data;
}
async function getUserProfile(userId) {
    // Expand as needed (joins, role resolution)
    return getUserById(userId);
}
