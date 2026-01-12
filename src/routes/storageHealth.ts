import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandling';
import { supabaseAdminClient } from '../config/database';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const db = supabaseAdminClient();
    const out: any = { ok: true, checks: {} };

    // Check bucket existence
    try {
      const { data: bucket, error } = await db.storage.getBucket('documents');
      out.checks.bucket_exists = !!bucket && !error;
      if (error) out.checks.bucket_error = String(error.message || error);
    } catch (err: any) {
      out.checks.bucket_exists = false;
      out.checks.bucket_error = err?.message || String(err);
    }

    // Try listing buckets (requires service role)
    try {
      const { data, error } = await db.storage.listBuckets();
      out.checks.list_buckets_ok = Array.isArray(data);
      if (error) out.checks.list_buckets_error = String(error.message || error);
    } catch (err: any) {
      out.checks.list_buckets_ok = false;
      out.checks.list_buckets_error = err?.message || String(err);
    }

    // Attempt a small upload (upsert) to validate write access
    try {
      const path = `health/${Date.now()}_ping.txt`;
      const payload = Buffer.from('ok');
      const upload = await db.storage.from('documents').upload(path, payload, { upsert: true, contentType: 'text/plain' });
      // supabase-js v2 returns { data, error }
      const upErr = (upload as any)?.error;
      out.checks.upload_ok = !upErr;
      if (upErr) out.checks.upload_error = String(upErr.message || upErr);
    } catch (err: any) {
      out.checks.upload_ok = false;
      out.checks.upload_error = err?.message || String(err);
    }

    res.json(out);
  })
);

export default router;
