# 🔍 How to Check Railway Worker Logs

## Step 1: Access Railway Logs

1. Go to: https://railway.app/project/gleaming-healing
2. Click on **"recruitment-portal-backend"** service
3. Click on **"Logs"** tab

## Step 2: Look for These Messages

### ✅ Worker Started Successfully

Look for:
```
Document Verification worker started
[DocumentVerificationWorker] Worker started, listening for jobs...
```

### ❌ Worker Failed to Start

Look for errors like:
```
Failed to start Document Verification worker: [error message]
Workers not started (set RUN_WORKER=true...)
Redis client error: [error]
```

### ✅ Worker Processing Jobs

Look for:
```
[DocumentVerification] Processing job for document [id]
[AI Categorization] Preparing request
[DocumentVerification] Job [id] completed successfully
```

### ❌ Worker Errors

Look for:
```
[DocumentVerificationWorker] Job [id] failed: [error]
[AI Categorization] Service call failed: [error]
Redis connection closed
```

## Step 3: Common Issues

### Issue 1: Worker Not Starting

**If you see:** `Workers not started`

**Check:**
- `RUN_WORKER=true` is set
- `REDIS_URL` is set
- `PYTHON_CV_PARSER_URL` is set
- `PYTHON_HMAC_SECRET` is set

### Issue 2: Redis Connection Error

**If you see:** `Redis client error` or `Redis connection closed`

**Fix:**
- Check Redis service is running
- Verify `REDIS_URL` is correct
- Check Redis service logs

### Issue 3: Python Parser Connection Error

**If you see:** `AI service error` or `Failed to fetch`

**Fix:**
- Check Python parser service is running
- Verify `PYTHON_CV_PARSER_URL` is correct
- Check Python parser service logs

### Issue 4: HMAC Authentication Error

**If you see:** `401` or `403` or `Invalid signature`

**Fix:**
- Verify `PYTHON_HMAC_SECRET` matches in both services
- Check Python parser service has the same secret

## Step 4: Test Worker Manually

If worker is running, you can test it:

1. Upload a new document
2. Watch logs for: `[DocumentVerification] Processing job`
3. Document should update from "Pending" to "Verified"

## Step 5: Check Queue Status

Run this script on Railway (via Railway CLI or SSH):

```bash
cd backend
node scripts/check-worker-status.js
```

This will show:
- Pending documents count
- Redis connection status
- Queue status (waiting/active/failed jobs)
- Recent verification logs

## Quick Checklist

- [ ] Check Railway logs for "Document Verification worker started"
- [ ] Check for any error messages
- [ ] Verify Redis connection is working
- [ ] Verify Python parser is accessible
- [ ] Check if jobs are being queued
- [ ] Check if jobs are being processed
- [ ] Check for failed jobs
