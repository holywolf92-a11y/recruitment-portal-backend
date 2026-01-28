import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import crypto from 'crypto';
import { ParsingJobsService } from '../services/parsingJobsService';
import { createCandidate, CreateCandidateData } from '../services/candidateService';
import { supabaseAdminClient } from '../config/database';
import { callSplitAndCategorize, docTypeToFolder, preserveOriginalPdf } from '../services/splitUploadService';
import { DOCUMENT_CATEGORIES, VERIFICATION_STATUS, type DocumentCategory } from '../config/documentCategories';
import { documentVerificationQueue } from '../config/queue';
import { generateRequestId } from '../services/documentVerificationLogService';
import { randomUUID } from 'crypto';
import { processSplitDocument } from '../utils/splitDocumentProcessor';

const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-portal-python-parser-production.up.railway.app') as string;
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET as string;
const STORAGE_BUCKET = 'documents';

function signHmac(body: string) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

// Helper to parse and validate dates from various formats
function parseDate(dateStr: string | undefined, fieldName: string): string | undefined {
  if (!dateStr) return undefined;
  
  try {
    // Try to parse formats like "13 October 1983", "13-10-1983", "23-09-2033", "1983-10-13"
    if (dateStr.includes(' ')) {
      // Format: "13 October 1983"
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } else if (dateStr.includes('-')) {
      // Format: "13-10-1983", "23-09-2033", or "1983-10-13"
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          // YYYY-MM-DD (already correct format)
          return dateStr;
        } else {
          // DD-MM-YYYY → convert to YYYY-MM-DD
          const day = parts[0];
          const month = parts[1];
          const year = parts[2];
          return `${year}-${month}-${day}`;
        }
      }
    } else if (dateStr.includes('/')) {
      // Format: "13/10/1983" or "10/13/1983"
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        // Assume DD/MM/YYYY
        const day = parts[0];
        const month = parts[1];
        const year = parts[2];
        return `${year}-${month}-${day}`;
      }
    }
    
    // Try generic Date constructor as fallback
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    
    console.warn(`[CVParser] Could not parse ${fieldName}: ${dateStr}`);
    return undefined;
  } catch (e) {
    console.warn(`[CVParser] Failed to parse ${fieldName}: ${dateStr}`, e);
    return undefined;
  }
}

// Helper to create candidate from parsed CV data
async function createCandidateFromParsedData(parsed: any, attachmentId: string, identityFields?: any) {
  try {
    const candidate = parsed.candidate || {};
    
    // Parse date of birth from various formats
    const dateOfBirth = parseDate(
      identityFields?.date_of_birth || identityFields?.dob || candidate.date_of_birth,
      'date_of_birth'
    );
    
    // Parse passport expiry date (can be in the future - this is normal!)
    const passportExpiry = parseDate(
      candidate.passport_expiry || identityFields?.passport_expiry || identityFields?.expiry_date,
      'passport_expiry'
    );
    
    // Build candidate data from parsed CV - map all fields from Python parser
    // Include identity fields extracted from CV (father_name, cnic, passport, date_of_birth, etc.)
    const candidateData: CreateCandidateData = {
      name: candidate.full_name || identityFields?.name || 'Unknown',
      father_name: identityFields?.father_name || candidate.father_name || undefined,
      email: candidate.email || identityFields?.email || undefined,
      phone: candidate.phone || identityFields?.phone || undefined,
      address: candidate.location || undefined,
      date_of_birth: dateOfBirth,
      marital_status: candidate.marital_status || undefined,
      cnic: identityFields?.cnic || candidate.cnic || undefined,
      passport: identityFields?.passport_no || candidate.passport || undefined,
      nationality: candidate.nationality || identityFields?.nationality || undefined,
      position: candidate.position || undefined,
      experience_years: candidate.experience_years || undefined,
      country_of_interest: candidate.country_of_interest || undefined,
      skills: Array.isArray(candidate.skills) ? candidate.skills.join(', ') : undefined,
      languages: Array.isArray(candidate.languages) ? candidate.languages.join(', ') : undefined,
      education: Array.isArray(candidate.education) && candidate.education.length > 0 
        ? candidate.education.map((e: any) => `${e.degree} from ${e.institution}`).join('; ')
        : undefined,
      certifications: Array.isArray(candidate.certifications) ? candidate.certifications.join(', ') : undefined,
      previous_employment: candidate.previous_employment || (
        Array.isArray(candidate.experience) && candidate.experience.length > 0
          ? candidate.experience.map((e: any) => `${e.title} at ${e.company}`).join('; ')
          : undefined
      ),
      passport_expiry: passportExpiry,
      professional_summary: candidate.professional_summary || candidate.summary || undefined,
      // Pass through profile_photo_url from parser response if present
      profile_photo_url: parsed?.candidate?.profile_photo_url || parsed?.profile_photo_url || undefined,
    };

    // Create candidate (system-created, no specific userId)
    const newCandidate = await createCandidate(candidateData);

    // Link the attachment to the candidate
    const db = supabaseAdminClient();
    await db
      .from('inbox_attachments')
      .update({ candidate_id: newCandidate.id })
      .eq('id', attachmentId);

    console.log(`[CVParser] Created candidate ${newCandidate.id} for attachment ${attachmentId}`);
    return newCandidate;
  } catch (err) {
    console.error(`[CVParser] Failed to create candidate from parsed data:`, err);
    // Don't throw - parsing was successful, just candidate creation failed
  }
}

export function startCvParserWorker() {
  const parsingJobs = new ParsingJobsService();

  const worker = new Worker(
    'cv-parsing',
    async (job: Job) => {
      const { jobId, attachmentId, fileUrl, fileHash } = job.data as {
        jobId: string;
        attachmentId: string;
        fileUrl: string;
        fileHash?: string | null;
      };

      await parsingJobs.setStatus(jobId, 'processing', {
        started_at: new Date().toISOString(),
        attempts: (job.attemptsMade ?? 0) + 1,
      });

      try {
        // Fetch attachment metadata (preferred filename/mimetype) and file bytes ONCE.
        const db = supabaseAdminClient();
        const { data: attachmentMeta } = await db
          .from('inbox_attachments')
          .select('file_name, mime_type')
          .eq('id', attachmentId)
          .maybeSingle();

        const safeUrl = (() => {
          try {
            return new URL(fileUrl);
          } catch {
            return null;
          }
        })();

        const fileNameFromUrl = safeUrl?.pathname?.split('/').pop() || 'upload.pdf';
        const fileName = attachmentMeta?.file_name || fileNameFromUrl;
        const mimeType =
          attachmentMeta?.mime_type ||
          (fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');

        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
          throw new Error(`Failed to fetch file: ${fileResponse.status}`);
        }
        const fileArrayBuffer = await fileResponse.arrayBuffer();
        const fileBytes = Buffer.from(fileArrayBuffer);
        const fileBase64 = fileBytes.toString('base64');

        const payloadObj = {
          attachment_id: attachmentId,
          file_url: fileUrl,
          file_hash: fileHash ?? null,
        };
        const payload = JSON.stringify(payloadObj);

        // Step 1: Parse CV for professional fields
        // Note: /parse-cv endpoint expects x-signature (not x-hmac-signature)
        const res = await fetch(`${PY_URL}/parse-cv`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-signature': signHmac(payload),
          },
          body: payload,
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`PYTHON_${res.status}: ${text.slice(0, 300)}`);
        }

        const parsed = await res.json();

        // Step 2: Also categorize document to extract identity fields (father_name, cnic, passport, date_of_birth, etc.)
        // This is important because CVs often contain personal information
        // Note: categorize-document needs file_content (base64), not file_url
        let identityFields: any = null;
        try {
          const categorizePayload = JSON.stringify({
            file_content: fileBase64,
            file_name: fileName,
            mime_type: mimeType,
          });
          
          const categorizeRes = await fetch(`${PY_URL}/categorize-document`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-hmac-signature': signHmac(categorizePayload),
            },
            body: categorizePayload,
          });

          if (categorizeRes.ok) {
            const categorizeResult = await categorizeRes.json();
            identityFields = categorizeResult.identity_fields || null;
            console.log(`[CVParser] Extracted identity fields from CV:`, {
              hasName: !!identityFields?.name,
              hasFatherName: !!identityFields?.father_name,
              hasCNIC: !!identityFields?.cnic,
              hasPassport: !!identityFields?.passport_no,
              hasDOB: !!identityFields?.date_of_birth,
            });
          } else {
            const errorText = await categorizeRes.text();
            console.warn(`[CVParser] Failed to categorize CV for identity extraction: ${categorizeRes.status} - ${errorText.slice(0, 200)}`);
          }
        } catch (categorizeError: any) {
          // Log but don't fail - identity extraction is optional
          console.warn(`[CVParser] Error extracting identity fields from CV:`, categorizeError?.message);
        }

        await parsingJobs.setStatus(jobId, 'extracted', {
          finished_at: new Date().toISOString(),
          schema_version: parsed.schema_version ?? 'v1',
          result_json: { ...parsed, identity_fields: identityFields },
          error_code: null,
          error_message: null,
        });

        // Use progressive completion service to find existing candidate
        // Priority: CNIC > Passport > Email/Phone > Name + Father Name + DOB
        const { findExistingCandidate, enrichCandidateData, updateMissingFields } = await import('../services/progressiveDataCompletionService');
        
        // Combine data from both sources (parse-cv and categorize-document)
        const parsedCandidate = parsed.candidate || {};
        const combinedData: Record<string, any> = {
          // From parse-cv
          name: parsedCandidate.full_name,
          email: parsedCandidate.email,
          phone: parsedCandidate.phone,
          nationality: parsedCandidate.nationality,
          father_name: parsedCandidate.father_name,
          cnic: parsedCandidate.cnic,
          passport: parsedCandidate.passport,
          passport_no: parsedCandidate.passport, // For matching
          date_of_birth: parsedCandidate.date_of_birth,
          marital_status: parsedCandidate.marital_status,
          position: parsedCandidate.position,
          experience_years: parsedCandidate.experience_years,
          country_of_interest: parsedCandidate.country_of_interest,
          skills: parsedCandidate.skills,
          languages: parsedCandidate.languages,
          education: parsedCandidate.education,
          certifications: parsedCandidate.certifications,
          previous_employment: parsedCandidate.previous_employment,
          passport_expiry: parsedCandidate.passport_expiry,
          professional_summary: parsedCandidate.professional_summary || parsedCandidate.summary,
        };
        
        // Override with identityFields if available (from categorize-document)
        if (identityFields) {
          if (identityFields.name) combinedData.name = identityFields.name;
          if (identityFields.father_name) combinedData.father_name = identityFields.father_name;
          if (identityFields.cnic) combinedData.cnic = identityFields.cnic;
          if (identityFields.passport_no) {
            combinedData.passport = identityFields.passport_no;
            combinedData.passport_no = identityFields.passport_no;
          }
          if (identityFields.email) combinedData.email = identityFields.email;
          if (identityFields.phone) combinedData.phone = identityFields.phone;
          if (identityFields.date_of_birth || identityFields.dob) {
            combinedData.date_of_birth = parseDate(identityFields.date_of_birth || identityFields.dob, 'date_of_birth');
          }
          if (identityFields.nationality) combinedData.nationality = identityFields.nationality;
          if (identityFields.passport_expiry || identityFields.expiry_date) {
            combinedData.passport_expiry = parseDate(identityFields.passport_expiry || identityFields.expiry_date, 'passport_expiry');
          }
        }
        
        // Also parse the initial dates from parsedCandidate
        if (combinedData.date_of_birth) {
          combinedData.date_of_birth = parseDate(combinedData.date_of_birth, 'date_of_birth');
        }
        if (combinedData.passport_expiry) {
          combinedData.passport_expiry = parseDate(combinedData.passport_expiry, 'passport_expiry');
        }
        
        // Find existing candidate using progressive completion matching
        const existingCandidateId = await findExistingCandidate(combinedData);
        
        let candidate;
        if (existingCandidateId) {
          // Update existing candidate using progressive completion
          console.log(`[CVParser] Found existing candidate ${existingCandidateId}, enriching with CV data...`);
          
          // Enrich candidate with CV data (progressive completion - only fills missing fields)
          const enrichmentResult = await enrichCandidateData(
            existingCandidateId,
            combinedData,
            'cv',
            attachmentId,
            'cv'
          );
          
          console.log(`[CVParser] ✅ Progressive enrichment completed:`, {
            updated: enrichmentResult.updated,
            skipped: enrichmentResult.skipped,
            source: 'cv',
          });
          
          // Recalculate missing fields
          await updateMissingFields(existingCandidateId);
          
          // Get updated candidate
          const { data: updatedCandidate } = await db
            .from('candidates')
            .select('*')
            .eq('id', existingCandidateId)
            .maybeSingle();
          
          candidate = updatedCandidate;
          
          // Link attachment to existing candidate
          await db
            .from('inbox_attachments')
            .update({ candidate_id: existingCandidateId })
            .eq('id', attachmentId);
          
          console.log(`[CVParser] ✅ Enriched existing candidate ${existingCandidateId} with CV data`);
        } else {
          // Create new candidate from parsed data (including identity fields) and link to attachment
          candidate = await createCandidateFromParsedData(parsed, attachmentId, identityFields);
          
          // After creation, enrich with any additional data and recalculate missing fields
          if (candidate?.id) {
            try {
              await enrichCandidateData(
                candidate.id,
                combinedData,
                'cv',
                attachmentId,
                'cv'
              );
              await updateMissingFields(candidate.id);
            } catch (enrichError) {
              console.warn(`[CVParser] Failed to enrich newly created candidate:`, enrichError);
            }
          }
        }
        
        const newCandidate = candidate;

        // ============================================================================
        // SPLIT-AND-CATEGORIZE for multi-document PDFs uploaded via CV Inbox (Web Form)
        // This is required so inbox uploads also create candidate_documents + mapped folders.
        // ============================================================================
        if (newCandidate?.id && mimeType === 'application/pdf') {
          try {
            console.log(`[CVParser] PDF detected for attachment ${attachmentId}. Running split-and-categorize for candidate ${newCandidate.id}...`);

            // Preserve original PDF for audit/reprocessing
            const uploadId = randomUUID();
            const originalPath = await preserveOriginalPdf(fileBytes, uploadId, mimeType);
            console.log(`[CVParser] Original PDF preserved at: ${originalPath}`);

            const splitResult = await callSplitAndCategorize(fileBase64, fileName, mimeType, undefined, true);
            const docs = splitResult?.documents || [];
            console.log(`[CVParser] Split returned ${docs.length} document(s) (engine=${splitResult.engine_used})`);

            // Only create records when we have at least 1 doc (normally always true)
            for (const d of docs) {
              try {
                const folder = docTypeToFolder(d.doc_type);
                const pdfBuffer = Buffer.from(d.pdf_base64, 'base64');
                
                // Use shared utility to handle image detection, profile photo saving, and storage upload
                const processed = await processSplitDocument(d, newCandidate.id, uploadId, folder);

                const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(processed.storagePath, pdfBuffer, {
                  contentType: processed.mimeType,
                  upsert: false,
                });
                if (upErr) {
                  console.error(`[CVParser] Failed to upload split doc ${d.doc_type} -> ${processed.storagePath}:`, upErr);
                  continue;
                }

                // Map parser doc_type to candidate_documents category
                const categoryMap: Record<string, DocumentCategory> = {
                  cv_resume: DOCUMENT_CATEGORIES.CV_RESUME,
                  passport: DOCUMENT_CATEGORIES.PASSPORT,
                  national_id: DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                  cnic: DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                  driving_license: DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                  medical_reports: DOCUMENT_CATEGORIES.MEDICAL_REPORTS,
                  medical_certificate: DOCUMENT_CATEGORIES.MEDICAL_REPORTS,
                  certificates: DOCUMENT_CATEGORIES.CERTIFICATES,
                  certificate: DOCUMENT_CATEGORIES.CERTIFICATES,
                  contracts: DOCUMENT_CATEGORIES.CONTRACTS,
                  contract: DOCUMENT_CATEGORIES.CONTRACTS,
                  photos: DOCUMENT_CATEGORIES.PHOTOS,
                  other_documents: DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                };
                const category = categoryMap[d.doc_type] || DOCUMENT_CATEGORIES.OTHER_DOCUMENTS;

                // Map parser doc_type to DB constraint document_type
                const docTypeMap: Record<string, string> = {
                  passport: 'passport',
                  cnic: 'cnic',
                  national_id: 'cnic',
                  cv_resume: 'other',
                  medical_reports: 'medical',
                  medical_certificate: 'medical',
                  certificate: 'certificate',
                  certificates: 'certificate',
                  driving_license: 'other',
                  contracts: 'other',
                  contract: 'other',
                  photos: 'other',
                  other_documents: 'other',
                };
                const dbDocumentType = docTypeMap[d.doc_type] || 'other';

                // For extracted profile photos, set verification_status to 'verified' to skip approval workflow
                const verificationStatus = processed.shouldAutoVerify
                  ? VERIFICATION_STATUS.VERIFIED
                  : VERIFICATION_STATUS.PENDING_AI;

                const splitDocData: any = {
                  candidate_id: newCandidate.id,
                  inbox_attachment_id: attachmentId,
                  document_type: dbDocumentType,
                  category,
                  detected_category: category,
                  confidence: d.confidence ?? null,
                  storage_bucket: STORAGE_BUCKET,
                  storage_path: processed.storagePath,
                  file_name: `split_${d.doc_type}_${Date.now()}.${processed.fileExtension}`,
                  mime_type: processed.mimeType,  // Use detected MIME type (image/jpeg for photos)
                  source: 'web',
                  status: 'received',
                  verification_status: verificationStatus,  // Auto-verify extracted photos
                  received_at: new Date().toISOString(),
                };

                const { data: createdDoc, error: insErr } = await db
                  .from('candidate_documents')
                  .insert(splitDocData)
                  .select()
                  .single();
                if (insErr || !createdDoc) {
                  console.error(`[CVParser] Failed to create candidate_document for ${d.doc_type}:`, insErr);
                  await db.storage.from(STORAGE_BUCKET).remove([processed.storagePath]);
                  continue;
                }

                // Enqueue verification job (skip for auto-verified photos)
                if (verificationStatus !== VERIFICATION_STATUS.VERIFIED) {
                  const splitRequestId = generateRequestId();
                  try {
                    await documentVerificationQueue.add(
                      'verify-document',
                      {
                        requestId: splitRequestId,
                        documentId: createdDoc.id,
                        candidateId: newCandidate.id,
                        storageBucket: STORAGE_BUCKET,
                        storagePath: processed.storagePath,
                        fileName: createdDoc.file_name,
                        mimeType: processed.mimeType,
                      },
                      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
                    );
                  } catch (qErr: any) {
                    console.error(`[CVParser] Failed to enqueue verification for split doc ${createdDoc.id}:`, qErr?.message || qErr);
                  }
                } else {
                  console.log(`[CVParser] ⏭️  Skipped AI verification for auto-verified photo ${createdDoc.id}`);
                }
              } catch (oneErr: any) {
                console.error(`[CVParser] Error processing split doc:`, oneErr?.message || oneErr);
              }
            }
          } catch (splitErr: any) {
            console.error(`[CVParser] Split-and-categorize failed for attachment ${attachmentId}:`, splitErr?.message || splitErr);
            // Non-blocking: CV parsing should still succeed even if splitting fails
          }
        }

        // IMPORTANT: Set cv_received flag immediately after candidate is created from inbox CV
        // This ensures the document flag shows green/red on the card from the start
        if (newCandidate?.id) {
          try {
            // Call the service function directly instead of the controller to avoid mock response issues
            const { data: documents } = await db
              .from('candidate_documents')
              .select('category')
              .eq('candidate_id', newCandidate.id);
            
            const hasCV = documents?.some((d: any) => d.category === 'cv_resume' || d.category === 'cv');
            
            if (hasCV || parsed.candidate) {
              await db
                .from('candidates')
                .update({ 
                  cv_received: true, 
                  cv_received_at: new Date().toISOString() 
                })
                .eq('id', newCandidate.id);
              console.log(`[CVParser] Successfully set cv_received flag for candidate ${newCandidate.id}`);
            }
          } catch (flagError: any) {
            // Log but don't fail the parsing job if flag update fails
            console.error(`[CVParser] Failed to update document flags for candidate ${newCandidate.id}:`, flagError?.message);
          }
        }

        return { ok: true };
      } catch (err: any) {
        await parsingJobs.setStatus(jobId, 'failed', {
          finished_at: new Date().toISOString(),
          error_code: 'PARSING_FAILED',
          error_message: err?.message ?? 'Unknown error',
        });
        throw err;
      }
    },
    {
      connection: redis,
      concurrency: 5,
      limiter: { max: 10, duration: 60_000 },
    }
  );

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error('cv-parsing failed', job?.id, err?.message);
  });

  return worker;
}
