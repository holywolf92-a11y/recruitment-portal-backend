# 🤖 AI-Powered Candidate Record Updates

## Feature Overview

The document verification worker now intelligently updates candidate records with information extracted from verified documents. This ensures that candidate profiles are automatically enriched with data from passports, CVs, and other documents.

## How It Works

### 1. Document Processing Flow

1. **Document Upload** → Document is uploaded and queued for AI processing
2. **AI Extraction** → Python parser extracts identity information:
   - Name, CNIC, Passport Number
   - Nationality, Date of Birth
   - Passport Expiry Date, Issue Date
   - Email, Phone
3. **Identity Verification** → System verifies document matches candidate
4. **Smart Update** → If verified, candidate record is updated with missing information

### 2. Update Logic

The system only updates candidate fields if:
- ✅ Field is currently **missing/empty** in candidate record
- ✅ Document has the information
- ✅ Document is **verified** (status = VERIFIED)

**Fields Updated:**
- `nationality` - From passport documents
- `passport_normalized` - Normalized passport number
- `passport` - Original passport number format
- `passport_expiry` - Passport expiry date
- `date_of_birth` - Date of birth

### 3. Date Parsing

The system handles multiple date formats:
- `DD-MM-YYYY` (e.g., "15-08-1994")
- `YYYY-MM-DD` (e.g., "1994-08-15")
- ISO format dates

### 4. Example Scenario

**Before:**
- Candidate has: Name, Email
- Missing: Nationality, Passport Number, Passport Expiry, Date of Birth

**After Passport Upload:**
- Passport extracted: 
  - Name: "Muhammad Farhan"
  - Passport No: "PA1234567"
  - Nationality: "Pakistani"
  - Date of Birth: "15-08-1994"
  - Expiry Date: "09-06-2032"
- Document verified ✅
- Candidate record updated:
  - ✅ `nationality` = "Pakistani"
  - ✅ `passport_normalized` = "PA1234567"
  - ✅ `passport` = "PA1234567"
  - ✅ `passport_expiry` = "2032-06-09"
  - ✅ `date_of_birth` = "1994-08-15"

## Benefits

1. **Automatic Data Enrichment** - No manual data entry needed
2. **Data Completeness** - Candidate profiles get filled automatically
3. **Excel Browser Updates** - All extracted data appears in Excel Browser
4. **Single Source of Truth** - Documents become the source of accurate data

## Requirements

### Python Parser Must Extract:

For **Passport Documents**:
```json
{
  "name": "Muhammad Farhan",
  "passport_no": "PA1234567",
  "nationality": "Pakistani",
  "date_of_birth": "15-08-1994",
  "passport_expiry": "09-06-2032",
  "issue_date": "10-06-2022",
  "place_of_issue": "Islamabad"
}
```

### Current Status

✅ **Implemented:**
- Candidate record updates after document verification
- Nationality, passport number, passport expiry, date of birth updates
- Smart update logic (only updates missing fields)

⚠️ **Needs Python Parser Update:**
- Python parser must extract `nationality` from passport documents
- Python parser must extract `passport_expiry` or `expiry_date` from passport documents
- Python parser must extract `passport_no` (currently returning null)

## Testing

1. Upload a passport document for a candidate
2. Wait for AI processing to complete
3. Check candidate record:
   ```sql
   SELECT nationality, passport, passport_expiry, date_of_birth 
   FROM candidates 
   WHERE id = '<candidate_id>';
   ```
4. Verify Excel Browser shows updated information

## Logs

Look for these log messages:
```
[DocumentVerification] Updating nationality: Pakistani
[DocumentVerification] Updating passport: PA1234567
[DocumentVerification] Updating passport expiry: 2032-06-09
[DocumentVerification] Updating date of birth: 1994-08-15
[DocumentVerification] Updated candidate record for <id> with extracted information: [nationality, passport, passport_expiry, date_of_birth]
```
