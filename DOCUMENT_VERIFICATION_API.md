# Document Verification API Documentation

## Base URL
```
https://your-backend-url/api
```

---

## Document Upload & Management

### Upload Document with AI Verification
Upload a document for a candidate. The document will be automatically categorized and identity-verified using AI.

**Endpoint:** `POST /candidate-documents`

**Content-Type:** `multipart/form-data`

**Request:**
```bash
curl -X POST https://your-backend-url/api/candidate-documents \
  -F "file=@passport.pdf" \
  -F "candidate_id=a1b2c3d4-5678-90ab-cdef-1234567890ab" \
  -F "source=Manual Upload"
```

**Request Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| file | File | Yes | Document file (PDF, DOC, DOCX, JPG, PNG, TXT). Max 10MB |
| candidate_id | UUID | Yes | ID of the candidate this document belongs to |
| source | String | No | Upload source (e.g., "Manual Upload", "Email", "WhatsApp") |

**Response:**
```json
{
  "success": true,
  "document": {
    "id": "doc-uuid-here",
    "candidate_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "file_name": "passport.pdf",
    "file_size": 245678,
    "mime_type": "application/pdf",
    "verification_status": "pending_ai",
    "storage_path": "candidates/a1b2c3d4/documents/1234567890_passport.pdf",
    "uploaded_at": "2026-01-21T10:30:00Z"
  },
  "request_id": "trace-uuid-here",
  "message": "Document uploaded successfully. AI verification started."
}
```

**Status Codes:**
- `200`: Success
- `400`: Bad request (missing file or candidate_id)
- `404`: Candidate not found
- `500`: Upload failed

---

### Get Document Details
Retrieve details of a specific document.

**Endpoint:** `GET /candidate-documents/:id`

**Request:**
```bash
curl https://your-backend-url/api/candidate-documents/doc-uuid-here
```

**Response:**
```json
{
  "success": true,
  "document": {
    "id": "doc-uuid-here",
    "candidate_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "file_name": "passport.pdf",
    "file_size": 245678,
    "mime_type": "application/pdf",
    "category": "passport",
    "detected_category": "passport",
    "confidence": 0.98,
    "verification_status": "verified",
    "verification_reason_code": "VERIFIED",
    "extracted_identity_json": {
      "name": "John Doe",
      "passport_no": "AB1234567",
      "date_of_birth": "1990-01-15"
    },
    "mismatch_fields": null,
    "uploaded_at": "2026-01-21T10:30:00Z",
    "ai_processing_started_at": "2026-01-21T10:30:05Z",
    "ai_processing_completed_at": "2026-01-21T10:30:12Z",
    "verification_completed_at": "2026-01-21T10:30:15Z"
  }
}
```

---

### List Candidate Documents
Get all documents for a candidate, optionally filtered by category.

**Endpoint:** `GET /candidates/:candidateId/documents`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| category | String | No | Filter by category (cv_resume, passport, certificates, etc.) |

**Request:**
```bash
# All documents
curl https://your-backend-url/api/candidates/a1b2c3d4/documents

# Filter by category
curl https://your-backend-url/api/candidates/a1b2c3d4/documents?category=passport
```

**Response:**
```json
{
  "success": true,
  "candidate_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "total_documents": 5,
  "grouped_by_category": [
    {
      "category": "passport",
      "display_name": "Passport",
      "documents": [
        {
          "id": "doc-uuid-1",
          "file_name": "passport.pdf",
          "verification_status": "verified",
          "uploaded_at": "2026-01-21T10:30:00Z"
        }
      ]
    },
    {
      "category": "certificates",
      "display_name": "Certificates",
      "documents": [
        {
          "id": "doc-uuid-2",
          "file_name": "degree.pdf",
          "verification_status": "verified",
          "uploaded_at": "2026-01-20T15:20:00Z"
        }
      ]
    }
  ]
}
```

---

### Get Document Download URL
Get a signed URL to download the document file.

**Endpoint:** `GET /candidate-documents/:id/download`

**Request:**
```bash
curl https://your-backend-url/api/candidate-documents/doc-uuid-here/download
```

**Response:**
```json
{
  "success": true,
  "download_url": "https://supabase-storage-url/signed-url-here?token=...",
  "expires_in": 3600,
  "file_name": "passport.pdf"
}
```

**Note:** The signed URL is valid for 1 hour (3600 seconds).

---

### Delete Document
Delete a document and its file from storage.

**Endpoint:** `DELETE /candidate-documents/:id`

**Request:**
```bash
curl -X DELETE https://your-backend-url/api/candidate-documents/doc-uuid-here
```

**Response:**
```json
{
  "success": true,
  "message": "Document deleted successfully",
  "document_id": "doc-uuid-here"
}
```

---

## Verification Logs & Audit Trail

### Get Logs by Request ID
Get all events for a single upload request (trace all events from upload to verification).

**Endpoint:** `GET /verification-logs/request/:requestId`

**Request:**
```bash
curl https://your-backend-url/api/verification-logs/request/trace-uuid-here
```

**Response:**
```json
{
  "success": true,
  "request_id": "trace-uuid-here",
  "total_events": 7,
  "logs": [
    {
      "id": "log-uuid-1",
      "event_type": "upload_started",
      "event_status": "success",
      "file_name": "passport.pdf",
      "created_at": "2026-01-21T10:30:00Z"
    },
    {
      "id": "log-uuid-2",
      "event_type": "upload_completed",
      "event_status": "success",
      "storage_path": "candidates/a1b2c3d4/documents/1234567890_passport.pdf",
      "created_at": "2026-01-21T10:30:02Z"
    },
    {
      "id": "log-uuid-3",
      "event_type": "ai_scan_started",
      "event_status": "success",
      "scan_start_time": "2026-01-21T10:30:05Z",
      "created_at": "2026-01-21T10:30:05Z"
    },
    {
      "id": "log-uuid-4",
      "event_type": "ai_scan_completed",
      "event_status": "success",
      "detected_category": "passport",
      "confidence": 0.98,
      "extracted_fields": {
        "name": "John Doe",
        "passport_no": "****4567",
        "date_of_birth": "1990-01-15"
      },
      "scan_end_time": "2026-01-21T10:30:12Z",
      "created_at": "2026-01-21T10:30:12Z"
    },
    {
      "id": "log-uuid-5",
      "event_type": "identity_verification_completed",
      "event_status": "success",
      "verification_status": "verified",
      "reason_code": "VERIFIED",
      "matching_result": {
        "matched": true,
        "matched_on": ["passport"],
        "confidence": 0.95
      },
      "verify_time": "2026-01-21T10:30:14Z",
      "created_at": "2026-01-21T10:30:14Z"
    },
    {
      "id": "log-uuid-6",
      "event_type": "verification_status_changed",
      "event_status": "success",
      "verification_status": "verified",
      "reason_code": "VERIFIED",
      "created_at": "2026-01-21T10:30:15Z"
    }
  ]
}
```

---

### Get Logs by Document ID
Get all verification events for a specific document.

**Endpoint:** `GET /verification-logs/document/:documentId`

**Request:**
```bash
curl https://your-backend-url/api/verification-logs/document/doc-uuid-here
```

**Response:** Same format as request logs.

---

### Get Logs by Candidate ID
Get all verification events for all documents belonging to a candidate.

**Endpoint:** `GET /verification-logs/candidate/:candidateId`

**Request:**
```bash
curl https://your-backend-url/api/verification-logs/candidate/a1b2c3d4
```

**Response:**
```json
{
  "success": true,
  "candidate_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "total_events": 25,
  "logs": [
    // Array of all verification events for this candidate's documents
  ]
}
```

---

### Get Verification Timeline
Get aggregated verification timeline with candidate names and processing durations.

**Endpoint:** `GET /verification-logs/timeline`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| candidateId | UUID | No | Filter by candidate |
| documentId | UUID | No | Filter by document |
| limit | Number | No | Max results (default: 50) |

**Request:**
```bash
curl "https://your-backend-url/api/verification-logs/timeline?candidateId=a1b2c3d4&limit=20"
```

**Response:**
```json
{
  "success": true,
  "total": 20,
  "filters": {
    "candidateId": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "documentId": null,
    "limit": 20
  },
  "timeline": [
    {
      "id": "log-uuid-1",
      "request_id": "trace-uuid-here",
      "document_id": "doc-uuid-here",
      "candidate_id": "a1b2c3d4",
      "candidate_name": "John Doe",
      "event_type": "verification_status_changed",
      "event_status": "success",
      "file_name": "passport.pdf",
      "detected_category": "passport",
      "category_display_name": "Passport",
      "confidence": 0.98,
      "verification_status": "verified",
      "reason_code": "VERIFIED",
      "created_at": "2026-01-21T10:30:15Z",
      "scan_duration_seconds": 7.2,
      "verification_duration_seconds": 2.8,
      "total_processing_seconds": 15.0
    }
  ]
}
```

---

### Get Verification Statistics
Get document verification statistics for a candidate.

**Endpoint:** `GET /verification-logs/stats/candidate/:candidateId`

**Request:**
```bash
curl https://your-backend-url/api/verification-logs/stats/candidate/a1b2c3d4
```

**Response:**
```json
{
  "success": true,
  "candidate_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "statistics": {
    "total_documents": 8,
    "by_status": {
      "verified": 5,
      "needs_review": 2,
      "pending_ai": 1,
      "rejected_mismatch": 0,
      "failed": 0
    },
    "by_category": {
      "passport": 1,
      "certificates": 3,
      "cv_resume": 2,
      "medical_reports": 1,
      "photos": 1
    }
  },
  "recent_events": [
    {
      "id": "log-uuid-1",
      "event_type": "verification_status_changed",
      "created_at": "2026-01-21T10:30:15Z",
      "verification_status": "verified",
      "reason_code": "VERIFIED"
    }
  ]
}
```

---

## Data Models

### Document Categories
```typescript
enum DocumentCategory {
  CV_RESUME = 'cv_resume',
  PASSPORT = 'passport',
  CERTIFICATES = 'certificates',
  CONTRACTS = 'contracts',
  MEDICAL_REPORTS = 'medical_reports',
  PHOTOS = 'photos',
  OTHER_DOCUMENTS = 'other_documents'
}
```

### Verification Status
```typescript
enum VerificationStatus {
  PENDING_AI = 'pending_ai',       // Queued for AI processing
  VERIFIED = 'verified',           // Identity confirmed, document authentic
  NEEDS_REVIEW = 'needs_review',   // Manual review required (no IDs found or low confidence)
  REJECTED_MISMATCH = 'rejected_mismatch', // Identity mismatch detected
  FAILED = 'failed'                // AI processing failed
}
```

### Verification Reason Codes
```typescript
enum VerificationReasonCode {
  VERIFIED = 'VERIFIED',                       // Document verified successfully
  IDENTITY_MISMATCH = 'IDENTITY_MISMATCH',     // General identity mismatch
  CNIC_MISMATCH = 'CNIC_MISMATCH',            // CNIC belongs to different person
  PASSPORT_MISMATCH = 'PASSPORT_MISMATCH',     // Passport belongs to different person
  EMAIL_MISMATCH = 'EMAIL_MISMATCH',           // Email doesn't match
  NAME_MISMATCH = 'NAME_MISMATCH',             // Name doesn't match
  LOW_CONFIDENCE = 'LOW_CONFIDENCE',           // AI confidence below threshold
  NO_ID_FOUND = 'NO_ID_FOUND',                // No identity fields extracted
  NO_TEXT_EXTRACTED = 'NO_TEXT_EXTRACTED',     // OCR failed
  MULTIPLE_CANDIDATES = 'MULTIPLE_CANDIDATES', // Multiple matches found
  OCR_FAILED = 'OCR_FAILED',                   // Text extraction failed
  AI_PROCESSING_ERROR = 'AI_PROCESSING_ERROR'  // AI service error
}
```

### Event Types
```typescript
enum EventType {
  UPLOAD_STARTED = 'upload_started',
  UPLOAD_COMPLETED = 'upload_completed',
  AI_SCAN_STARTED = 'ai_scan_started',
  AI_SCAN_COMPLETED = 'ai_scan_completed',
  AI_SCAN_FAILED = 'ai_scan_failed',
  IDENTITY_VERIFICATION_STARTED = 'identity_verification_started',
  IDENTITY_VERIFICATION_COMPLETED = 'identity_verification_completed',
  VERIFICATION_STATUS_CHANGED = 'verification_status_changed',
  MANUAL_REVIEW_REQUESTED = 'manual_review_requested',
  MANUAL_REVIEW_COMPLETED = 'manual_review_completed',
  ERROR = 'error'
}
```

---

## Error Handling

### Error Response Format
```json
{
  "success": false,
  "error": "Error category",
  "message": "Detailed error message"
}
```

### Common HTTP Status Codes
- `200`: Success
- `400`: Bad Request (missing required parameters)
- `401`: Unauthorized (HMAC authentication failed)
- `404`: Not Found (document/candidate doesn't exist)
- `500`: Internal Server Error (AI service down, database error, etc.)

### Example Error Responses

**Missing File:**
```json
{
  "success": false,
  "error": "No file uploaded"
}
```

**Candidate Not Found:**
```json
{
  "success": false,
  "error": "Candidate not found",
  "message": "No candidate exists with ID: a1b2c3d4"
}
```

**Upload Failed:**
```json
{
  "success": false,
  "error": "Upload failed",
  "message": "Failed to upload to storage: Connection timeout"
}
```

---

## Configuration

### AI Confidence Threshold
Documents are auto-categorized if AI confidence >= 0.70 (70%). If below threshold, category is set to "other_documents" and status is "needs_review".

### File Constraints
- **Max Size:** 10MB
- **Allowed Types:** PDF, DOC, DOCX, JPG, PNG, TXT
- **Storage:** Supabase Storage private bucket
- **Path Format:** `candidates/{candidateId}/documents/{timestamp}_{filename}`

### Rate Limiting
- **Worker Concurrency:** 3 documents processed simultaneously
- **Rate Limit:** 10 documents per minute (prevents AI service overload)

### Authentication
All requests to `/categorize-document` on python-parser use HMAC-SHA256 authentication with shared secret.

---

## Examples

### Complete Upload Flow

```bash
# 1. Upload document
RESPONSE=$(curl -s -X POST https://your-backend-url/api/candidate-documents \
  -F "file=@passport.pdf" \
  -F "candidate_id=a1b2c3d4-5678-90ab-cdef-1234567890ab")

echo $RESPONSE | jq .

# Extract document_id and request_id
DOC_ID=$(echo $RESPONSE | jq -r '.document.id')
REQUEST_ID=$(echo $RESPONSE | jq -r '.request_id')

# 2. Wait for AI processing (typically 5-15 seconds)
sleep 10

# 3. Check document status
curl -s https://your-backend-url/api/candidate-documents/$DOC_ID | jq .

# 4. Get verification logs
curl -s https://your-backend-url/api/verification-logs/request/$REQUEST_ID | jq .

# 5. Download document
DOWNLOAD_URL=$(curl -s https://your-backend-url/api/candidate-documents/$DOC_ID/download | jq -r '.download_url')
curl -o downloaded_passport.pdf "$DOWNLOAD_URL"
```

### Check Candidate Documents

```bash
# Get all documents for a candidate
curl -s "https://your-backend-url/api/candidates/a1b2c3d4/documents" | jq .

# Get statistics
curl -s "https://your-backend-url/api/verification-logs/stats/candidate/a1b2c3d4" | jq .

# Get verification timeline
curl -s "https://your-backend-url/api/verification-logs/timeline?candidateId=a1b2c3d4&limit=50" | jq .
```

---

## Webhook Events (Future)

*Note: Webhook support not yet implemented. Planned for future releases.*

Planned webhook events:
- `document.uploaded`
- `document.verified`
- `document.needs_review`
- `document.rejected`
- `document.failed`

---

*Last Updated: January 21, 2026*  
*API Version: 1.0.0*
