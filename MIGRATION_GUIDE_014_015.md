# Running Migrations 014 and 015

## ✅ Migrations Created:
- **014_add_ai_document_categorization.sql** - Adds AI categorization fields
- **015_create_document_verification_logs.sql** - Creates audit log table

## 🚀 How to Run These Migrations:

### Option 1: Supabase Dashboard (RECOMMENDED)

1. **Go to Supabase SQL Editor:**
   ```
   https://supabase.com/dashboard/project/hncvsextwmvjydcukdwx/sql
   ```

2. **Run Migration 014:**
   - Click "New Query"
   - Copy entire contents of: `backend/migrations/014_add_ai_document_categorization.sql`
   - Paste into editor
   - Click "Run" or press Ctrl+Enter
   - Wait for "Success" message

3. **Run Migration 015:**
   - Click "New Query"  
   - Copy entire contents of: `backend/migrations/015_create_document_verification_logs.sql`
   - Paste into editor
   - Click "Run" or press Ctrl+Enter
   - Wait for "Success" message

### Option 2: Using psql Command Line

```powershell
# You'll need the database password
psql "postgresql://postgres:[YOUR_PASSWORD]@db.hncvsextwmvjydcukdwx.supabase.co:5432/postgres" \
  < backend/migrations/014_add_ai_document_categorization.sql

psql "postgresql://postgres:[YOUR_PASSWORD]@db.hncvsextwmvjydcukdwx.supabase.co:5432/postgres" \
  < backend/migrations/015_create_document_verification_logs.sql
```

## 📋 What These Migrations Do:

### Migration 014:
✅ Creates `document_category_enum` with 7 categories:
   - cv_resume, passport, certificates, contracts, medical_reports, photos, other_documents
   
✅ Creates `document_verification_status_enum`:
   - pending_ai, verified, needs_review, rejected_mismatch, failed
   
✅ Adds 9 new columns to `candidate_documents` table:
   - `category` (final assigned category)
   - `detected_category` (AI detected category)
   - `confidence` (0.00-1.00 score)
   - `verification_status` (workflow state)
   - `extracted_identity_json` (AI extraction results - secured)
   - `verification_reason_code` (why rejected/needs review)
   - `mismatch_fields[]` (array of mismatched fields)
   - `ai_processing_started_at`, `ai_processing_completed_at`, `verification_completed_at`
   
✅ Creates performance indexes
✅ Backfills existing data (maps old document_type → new category)
✅ **IDEMPOTENT** - Safe to run multiple times

### Migration 015:
✅ Creates `document_verification_logs` table with:
   - Complete audit trail (10 event types)
   - Request tracing with `request_id`
   - Masked sensitive data storage
   - AI categorization results
   - Identity matching decisions
   - Error tracking
   
✅ Creates `document_verification_timeline` view for easy queries
✅ Creates `log_verification_event()` helper function
✅ Performance indexes for common query patterns
✅ **IDEMPOTENT** - Safe to run multiple times

## ✅ After Running Migrations:

Verify the migrations succeeded:

```sql
-- Check document_category_enum exists
SELECT unnest(enum_range(NULL::document_category_enum));

-- Check new columns in candidate_documents
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'candidate_documents' 
  AND column_name IN ('category', 'detected_category', 'confidence', 'verification_status');

-- Check document_verification_logs table exists
SELECT COUNT(*) FROM document_verification_logs;
```

## 🔄 Next Steps After Migration:

Once migrations are complete, we'll proceed with:
- **Step 3:** Update document upload API endpoint
- **Step 4:** Implement AI categorization worker
- **Step 5:** Build identity matching service
- **Step 6:** Implement verification decision logic
- **Step 7:** Add comprehensive logging
