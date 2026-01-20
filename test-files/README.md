# Test Files Directory

This directory contains test documents for integration testing the Document Verification System.

## Required Test Files

To run comprehensive integration tests, add the following files to this directory:

### 1. Happy Path Tests
- **sample-cv.pdf** - A standard CV/resume with name, CNIC, contact info
- **passport.pdf** - A passport document with passport number and photo
- **certificate.pdf** - Educational or professional certificate
- **photo.jpg** - A candidate photo

### 2. Error Scenario Tests
- **passport-mismatch.pdf** - A passport with different identity than candidate
- **blurry-document.jpg** - A low-quality/blurry document (for low confidence testing)
- **no-identity.txt** - A document with no identity fields

## Creating Test Files

### Sample CV (sample-cv.pdf)
Create a PDF with:
```
John Doe
CNIC: 12345-1234567-1
Email: john.doe@example.com
Phone: +92-300-1234567

Experience:
- Software Engineer at ABC Corp
- 5 years experience

Education:
- BS Computer Science
```

### Sample Passport (passport.pdf)
Create a PDF with:
```
PASSPORT
-------------------
Name: Jane Smith
Passport No: AB1234567
CNIC: 54321-7654321-9
Date of Birth: 01/01/1990
```

### Sample Certificate (certificate.pdf)
Create a PDF with:
```
CERTIFICATE OF ACHIEVEMENT
-------------------
This certifies that John Doe
has completed the course in
Advanced Software Engineering
Date: 2024
```

### Blurry Document (blurry-document.jpg)
- Take a photo of any document from a distance
- Make it intentionally out of focus
- Or use image editing software to blur text

### Mismatched Document (passport-mismatch.pdf)
Create a PDF with different identity:
```
PASSPORT
-------------------
Name: Different Person
Passport No: XY9876543
CNIC: 99999-9999999-9
```

## File Requirements

- **Size**: All files should be < 10MB
- **Types**: PDF, JPG, PNG, TXT, DOCX
- **Content**: Should contain readable text for OCR
- **Encoding**: UTF-8 for text files

## Usage in Tests

The test scripts will:
1. Check if files exist before running tests
2. Skip tests for missing files with warnings
3. Upload files to test candidates
4. Verify AI categorization and identity matching
5. Check verification logs

## Security Note

⚠️ **Do NOT use real personal documents!**

All test files should contain:
- Fictional names and identities
- Fake CNIC/passport numbers
- Test email addresses
- Non-sensitive content

## Running Tests

```bash
# Run integration tests
cd backend
npm run test:integration

# Run error handling tests
npm run test:errors

# Or with node directly
node scripts/test-document-verification-integration.js
node scripts/test-document-verification-errors.js
```

## Test Results

After running tests, check:
- Console output for pass/fail status
- Verification logs in database
- Document statuses in Supabase
- Worker logs for processing details
