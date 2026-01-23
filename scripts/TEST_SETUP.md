# Running Automated Tests - Setup Guide

## Quick Setup

The automated test script requires Supabase credentials. Here are your options:

### Option 1: Set Environment Variables (Recommended)

**Windows PowerShell:**
```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="your_service_role_key_here"
$env:BACKEND_URL="https://your-backend-url.railway.app"  # Optional, defaults to localhost:3001
node scripts\test-admin-override-badge.js
```

**Linux/Mac:**
```bash
export SUPABASE_SERVICE_ROLE_KEY="your_service_role_key_here"
export BACKEND_URL="https://your-backend-url.railway.app"  # Optional
node scripts/test-admin-override-badge.js
```

### Option 2: Create .env.local File

Create `backend/.env.local`:
```
SUPABASE_URL=https://hncvsextwmvjydcukdwx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
BACKEND_URL=https://your-backend-url.railway.app
```

Then run:
```bash
node scripts/test-admin-override-badge.js
```

### Option 3: Use Manual Testing (No Setup Required)

If you don't have the service role key, use the manual testing guide instead:
- See: `ADMIN_OVERRIDE_BADGE_MANUAL_TEST_GUIDE.md`

---

## Getting Your Supabase Service Role Key

1. Go to your Supabase project dashboard
2. Navigate to Settings → API
3. Copy the "service_role" key (NOT the anon key)
4. Use it as `SUPABASE_SERVICE_ROLE_KEY`

⚠️ **Security Note**: Never commit the service role key to git!

---

## Test Output

The script will test:
1. ✅ API response includes override fields
2. ✅ Admin name fetched from audit logs  
3. ✅ List documents includes override info
4. ✅ Missing admin name handling

Each test will show:
- ✅ Pass
- ❌ Fail (with error details)
- ⏭️ Skipped (if no test data available)

---

## Troubleshooting

**"Missing SUPABASE_SERVICE_ROLE_KEY"**
- Set the environment variable (see Option 1)
- Or create .env.local file (see Option 2)

**"Backend URL not accessible"**
- Check if backend is deployed and running
- Update BACKEND_URL to your Railway deployment URL
- Or test against localhost:3001 if running locally

**"No overridden documents found"**
- This is expected if you haven't overridden any documents yet
- Tests will be skipped (not failed)
- Override a document first, then re-run tests
