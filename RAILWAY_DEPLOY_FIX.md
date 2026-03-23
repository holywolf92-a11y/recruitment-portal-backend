# Why Split Integration Isn't Running - Root Cause & Fix

## 🔍 Problem Identified

**Issue:** Split integration code exists (`9c4d17e`) but Railway backend is still on old commit (`6e3c74a`).

**Evidence:**
- ✅ Code pushed: `9c4d17e` (includes split integration)
- ❌ Railway deployed: `6e3c74a` (old, no split integration)
- ✅ Test 1 (`/split-upload`) works: Creates 12 documents
- ❌ Test 2 (`/candidate-documents`) fails: Only 1 document (split not running)

## 🎯 Root Cause

Railway hasn't auto-deployed the latest commit. Possible reasons:
1. **Auto-deploy disabled** or not configured for backend service
2. **Railway CLI linked to wrong project** (must point to `glorious-flexibility` backend service)
3. **GitHub webhook not firing** or Railway not detecting push

## ✅ Solution: Manual Deploy via Railway Dashboard

### Step 1: Open Backend Service Dashboard
**URL:** https://railway.app/project/glorious-flexibility

### Step 2: Check Current Deployment
1. Go to **"Deployments"** tab
2. Check latest commit hash - should show `6e3c74a` (old)
3. Note: Latest should be `9c4d17e` (with split integration)

### Step 3: Trigger New Deployment
**Option A: Redeploy Latest (if auto-deploy is enabled)**
1. Click **"Redeploy"** on the latest deployment
2. Railway will pull latest from GitHub `main` branch
3. Should deploy `9c4d17e`

**Option B: Manual Deploy**
1. Click **"Deploy"** button (top right)
2. Select **"GitHub"** → **"recruitment-portal-backend"** → **"main"** branch
3. Railway will build and deploy

### Step 4: Verify Environment Variables
After deployment, check **"Variables"** tab:
- ✅ `PYTHON_CV_PARSER_URL` = `https://recruitment-python-parser-production.up.railway.app`
- ✅ `PYTHON_HMAC_SECRET` = (should match parser's secret)
- ✅ `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.

### Step 5: Monitor Deployment
1. Watch **"Build Logs"** tab during deployment
2. Look for:
   - ✅ TypeScript compilation success
   - ✅ `npm install` success
   - ✅ Service started successfully
3. Check for errors (especially import errors for `splitUploadService`)

### Step 6: Test After Deploy
Once deployed, run test again:
```bash
cd d:\falisha\recruitment-portal-backend
node scripts/testSplitIntegration.js
```

Expected: Should create **multiple documents** (CNIC, passport, driver license, etc.)

## 🔧 Alternative: Deploy via Railway CLI (if linked correctly)

If you can link Railway CLI to backend project:

```bash
cd d:\falisha\recruitment-portal-backend
railway link  # Select "glorious-flexibility" project, then "glorious-flexibility" service
railway up --detach
```

## 📋 What to Check in Railway Dashboard

1. **Deployments Tab:**
   - Latest commit should be `9c4d17e`
   - Build status should be ✅ (green)
   - Deployment should be active

2. **Variables Tab:**
   - `PYTHON_CV_PARSER_URL` must be set
   - `PYTHON_HMAC_SECRET` must be set
   - All Supabase vars present

3. **Logs Tab:**
   - After upload, look for: `[UploadDocument] PDF detected`
   - Should see: `[UploadDocument] Split returned X documents`
   - If you see: `Split-and-categorize failed` → check parser URL/HMAC

## 🚨 If Deployment Still Doesn't Work

1. **Check GitHub:** Verify commit `9c4d17e` is on `main` branch
2. **Check Railway:** Verify service is connected to correct GitHub repo
3. **Check Build Logs:** Look for TypeScript/build errors
4. **Check Runtime Logs:** Look for import/runtime errors

## 📝 Quick Test After Deploy

```bash
# Test the integrated split
node scripts/testSplitIntegration.js

# Should output:
# "Found X document(s)" where X > 1
# Documents should include: CNIC, passport, driver license, etc.
```
