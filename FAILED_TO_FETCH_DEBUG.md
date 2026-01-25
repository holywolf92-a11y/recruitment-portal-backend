# 🔍 "Failed to fetch" Error Analysis

## Issue
Frontend shows "Status check failed: Failed to fetch" when uploading "MUHAMMAD ADNAN-012.pdf" (1858.2 KB).

## Backend Status
- ✅ **Backend is running**: Health check returns 200 OK
- ✅ **CORS configured**: OPTIONS request returns 204 with CORS headers
- ✅ **Workers started**: Document Verification Worker is listening
- ✅ **Redis connected**: Redis client ready

## Possible Causes

### 1. Upload Request Not Reaching Backend
**Symptoms**: No logs showing upload attempts
**Possible reasons**:
- Request timeout (file is 1.8MB, might exceed timeout)
- Network connectivity issue
- Frontend using wrong API URL

### 2. Upload Succeeds But Status Check Fails
**Symptoms**: Upload completes but polling fails
**Possible reasons**:
- Document ID is invalid
- Status endpoint returns error
- CORS issue on GET request

### 3. Request Timeout
**Symptoms**: Large file (1.8MB) takes too long
**Current timeout**: 300 seconds (5 minutes) on backend
**Frontend timeout**: Calculated based on file size (120s + 10s per MB)

## Debugging Steps

### Check Frontend Console
1. Open browser DevTools (F12)
2. Check Console tab for errors
3. Check Network tab for failed requests
4. Look for:
   - Request URL
   - Request method
   - Response status
   - Error message

### Check Backend Logs
```bash
railway logs --tail 5000 | grep -i "POST\|candidate-documents\|UploadDocument"
```

### Test Upload Manually
```bash
# Test with curl
curl -X POST https://recruitment-portal-backend-production-d1f7.up.railway.app/api/documents/candidate-documents \
  -F "file=@MUHAMMAD_ADNAN-012.pdf" \
  -F "candidate_id=<candidate-id>" \
  -F "source=web"
```

## Next Steps

1. **Check browser console** for detailed error
2. **Check Network tab** to see actual request/response
3. **Verify API URL** in frontend (should be production backend URL)
4. **Check if upload completes** but status check fails
5. **Review timeout settings** for large files

## Enhanced Logging

Enhanced logging has been deployed to help diagnose:
- ✅ Queue enqueueing logs
- ✅ Worker processing logs
- ✅ Job status logs

After next upload attempt, check logs for detailed information.
