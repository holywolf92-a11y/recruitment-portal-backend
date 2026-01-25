# 🔍 Document Verification Queue Debugging

## Issue
Jobs are queued but not being processed by the Document Verification Worker.

## Enhanced Logging Added

### 1. Queue Enqueueing (candidateDocumentService.ts)
- ✅ Added detailed logging before enqueueing
- ✅ Log job ID after successful enqueue
- ✅ Enhanced error logging with full error details

### 2. Worker Processing (documentVerificationWorker.ts)
- ✅ Added `active` event listener - logs when job starts processing
- ✅ Added `stalled` event listener - detects if jobs get stuck
- ✅ Enhanced `failed` event - logs full job data on failure

## What to Check After Deployment

1. **Upload a PDF** and watch logs for:
   - `[UploadDocument] Attempting to enqueue verification job...`
   - `[UploadDocument] ✅ Enqueued AI verification... - Job ID: ...`
   - `[DocumentVerificationWorker] Job ... is now active...`
   - `[DocumentVerification] Processing job for document...`

2. **If jobs are enqueued but not processed:**
   - Check for `stalled` messages
   - Check for worker errors
   - Verify Redis connection is stable

3. **If jobs aren't being enqueued:**
   - Check for enqueue errors
   - Verify queue connection
   - Check if split documents are being created

## Next Steps

After deployment completes:
1. Upload a test PDF
2. Monitor logs for the new detailed messages
3. Identify where the process is failing
