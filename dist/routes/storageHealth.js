"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const errorHandling_1 = require("../utils/errorHandling");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
router.get('/', (0, errorHandling_1.asyncHandler)(async (_req, res) => {
    const db = (0, database_1.supabaseAdminClient)();
    const out = { ok: true, checks: {} };
    // Check bucket existence
    try {
        const { data: bucket, error } = await db.storage.getBucket('documents');
        out.checks.bucket_exists = !!bucket && !error;
        if (error)
            out.checks.bucket_error = String(error.message || error);
    }
    catch (err) {
        out.checks.bucket_exists = false;
        out.checks.bucket_error = err?.message || String(err);
    }
    // Try listing buckets (requires service role)
    try {
        const { data, error } = await db.storage.listBuckets();
        out.checks.list_buckets_ok = Array.isArray(data);
        if (error)
            out.checks.list_buckets_error = String(error.message || error);
    }
    catch (err) {
        out.checks.list_buckets_ok = false;
        out.checks.list_buckets_error = err?.message || String(err);
    }
    // Attempt a small upload (upsert) to validate write access
    try {
        const path = `health/${Date.now()}_ping.txt`;
        const payload = Buffer.from('ok');
        const upload = await db.storage.from('documents').upload(path, payload, { upsert: true, contentType: 'text/plain' });
        // supabase-js v2 returns { data, error }
        const upErr = upload?.error;
        out.checks.upload_ok = !upErr;
        if (upErr)
            out.checks.upload_error = String(upErr.message || upErr);
    }
    catch (err) {
        out.checks.upload_ok = false;
        out.checks.upload_error = err?.message || String(err);
    }
    res.json(out);
}));
exports.default = router;
