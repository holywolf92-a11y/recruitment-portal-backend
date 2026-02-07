import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import crypto from 'crypto';
import { ParsingJobsService } from '../services/parsingJobsService';
import { createCandidate, CreateCandidateData } from '../services/candidateService';
import { supabaseAdminClient } from '../config/database';
import { callSplitAndCategorize, docTypeToFolder, preserveOriginalPdf } from '../services/splitUploadService';
import { extractProfilePhotoHybrid, uploadExtractedPhotoToCandidatePhotos } from '../services/hybridPhotoExtractionService';
import { DOCUMENT_CATEGORIES, VERIFICATION_STATUS, type DocumentCategory } from '../config/documentCategories';
import { documentVerificationQueue } from '../config/queue';
import { generateRequestId } from '../services/documentVerificationLogService';
import { randomUUID } from 'crypto';
import { processSplitDocument } from '../utils/splitDocumentProcessor';
import { generateDescriptiveFilename } from '../utils/documentNaming';
import { isGovernmentEmail } from '../services/progressiveDataCompletionService';
import { extractProfilePhotoFromPdfUsingAI } from '../services/aiProfilePhotoExtractionService';

const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-portal-python-parser-production.up.railway.app') as string;
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET as string;
const STORAGE_BUCKET = 'documents';

function signHmac(body: string) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

function isPlaceholderName(name?: string | null): boolean {
  if (!name) return false;
  return /^(john|jane)\s+doe$/i.test(name.trim());
}

function isPlaceholderEmail(email?: string | null): boolean {
  if (!email) return false;
  return /@example\.com$/i.test(email.trim()) || /^test@/i.test(email.trim());
}

function isPlaceholderPhone(phone?: string | null): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  return digits === '1234567890';
}

function hasProfilePhoto(candidate: any): boolean {
  return !!(
    candidate?.photo_received ||
    candidate?.profile_photo_bucket ||
    candidate?.profile_photo_path ||
    candidate?.profile_photo_url
  );
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
    
    // Filter out government/police emails - don't use them as candidate email
    const extractedEmail = candidate.email || identityFields?.email;
    const candidateEmail = extractedEmail && !isGovernmentEmail(extractedEmail) ? extractedEmail : undefined;
    const resolvedEmail =
      identityFields?.email && isPlaceholderEmail(candidateEmail)
        ? identityFields.email
        : candidateEmail;
    const resolvedPhone =
      identityFields?.phone && isPlaceholderPhone(candidate.phone)
        ? identityFields.phone
        : (candidate.phone || identityFields?.phone || undefined);
    const resolvedName =
      identityFields?.name && isPlaceholderName(candidate.full_name)
        ? identityFields.name
        : (candidate.full_name || identityFields?.name || 'Unknown');
    
    if (extractedEmail && !candidateEmail) {
      console.log(`[CVParser] Filtered out official/government email during extraction: ${extractedEmail}`);
    }
    
    // Extract profession from certificates if not explicitly mentioned
    let extractedPosition = candidate.position || undefined;
    if (!extractedPosition && (candidate.certifications || []).length > 0) {
      // Try to infer position from certificate names
      const certNames = Array.isArray(candidate.certifications) ? candidate.certifications : [];
      const certString = certNames.join(' ').toLowerCase();
      
      // Common patterns to extract profession
      if (certString.includes('construction') || certString.includes('builder')) {
        extractedPosition = 'Construction Worker';
      } else if (certString.includes('electrician')) {
        extractedPosition = 'Electrician';
      } else if (certString.includes('plumber')) {
        extractedPosition = 'Plumber';
      } else if (certString.includes('carpenter')) {
        extractedPosition = 'Carpenter';
      } else if (certString.includes('mechanic')) {
        extractedPosition = 'Mechanic';
      } else if (certString.includes('welding') || certString.includes('welder')) {
        extractedPosition = 'Welder';
      }
      
      if (extractedPosition) {
        console.log(`[CVParser] Inferred position from certificates: ${extractedPosition}`);
      }
    }
    
    const rawProfilePhotoUrl = parsed?.candidate?.profile_photo_url || parsed?.profile_photo_url || undefined;
    const normalizedProfilePhotoUrl = typeof rawProfilePhotoUrl === 'string' && rawProfilePhotoUrl.trim()
      ? rawProfilePhotoUrl.trim()
      : undefined;
    const isProfilePhotoPdf = !!normalizedProfilePhotoUrl && normalizedProfilePhotoUrl.toLowerCase().includes('.pdf');

    if (isProfilePhotoPdf) {
      console.warn('[CVParser] Ignoring PDF profile_photo_url from parser response:', normalizedProfilePhotoUrl);
    }

    const candidateData: CreateCandidateData = {
      name: resolvedName,
      father_name: identityFields?.father_name || candidate.father_name || undefined,
      email: resolvedEmail,
      phone: resolvedPhone,
      address: candidate.location || undefined,
      date_of_birth: dateOfBirth,
      marital_status: candidate.marital_status || undefined,
      cnic: identityFields?.cnic || candidate.cnic || undefined,
      passport: identityFields?.passport_no || candidate.passport || undefined,
      nationality: candidate.nationality || identityFields?.nationality || undefined,
      position: extractedPosition,
      experience_years: candidate.experience_years || undefined,
      country_of_interest: candidate.country_of_interest || undefined,
      skills: Array.isArray(candidate.skills) ? candidate.skills.join(', ') : undefined,
      languages: Array.isArray(candidate.languages) ? candidate.languages.join(', ') : undefined,
      education: Array.isArray(candidate.education) && candidate.education.length > 0 
        ? candidate.education.map((e: any) => `${e.degree} from ${e.institution}`).join('; ')
        : undefined,
      certifications: Array.isArray(candidate.certifications) ? candidate.certifications.join(', ') : undefined,
      internships: Array.isArray((candidate as any).internships) ? (candidate as any).internships.join(', ') : undefined,
      previous_employment: candidate.previous_employment || (
        Array.isArray(candidate.experience) && candidate.experience.length > 0
          ? candidate.experience.map((e: any) => `${e.title} at ${e.company}`).join('; ')
          : undefined
      ),
      passport_expiry: passportExpiry,
      professional_summary: candidate.professional_summary || candidate.summary || undefined,
      // Pass through profile_photo_url from parser response if present (ignore PDF links)
      profile_photo_url: isProfilePhotoPdf ? undefined : normalizedProfilePhotoUrl,
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

  async function maybeAttachGmailThreadToCandidate(candidateId: string, attachmentId: string) {
    try {
      const db2 = supabaseAdminClient();
      const { data: att } = await db2
        .from('inbox_attachments')
        .select('inbox_message_id')
        .eq('id', attachmentId)
        .maybeSingle();

      const inboxMessageId = (att as any)?.inbox_message_id;
      if (!inboxMessageId) return;

      const { data: msg } = await db2
        .from('inbox_messages')
        .select('source, payload')
        .eq('id', inboxMessageId)
        .maybeSingle();

      if (!msg || (msg as any).source !== 'gmail') return;

      const payload: any = (msg as any).payload || {};
      const threadId = typeof payload.threadId === 'string' ? payload.threadId.trim() : '';
      if (!threadId) return;

      const fromRaw = typeof payload.from === 'string' ? payload.from : '';
      const emailMatch = fromRaw.match(/<([^>]+)>/) || fromRaw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
      const fromEmail = (emailMatch?.[1] || emailMatch?.[0] || '').trim();

      const update: any = {
        gmail_thread_id: threadId,
        gmail_from_email: fromEmail || null,
        gmail_last_subject: typeof payload.subject === 'string' ? payload.subject : null,
        gmail_last_message_id: typeof payload.messageIdHeader === 'string' ? payload.messageIdHeader : null,
      };

      await db2.from('candidates').update(update).eq('id', candidateId);
    } catch (err: any) {
      console.warn('[CVParser] Failed to attach Gmail thread to candidate (non-fatal):', err?.message || err);
    }
  }

  function buildPreviousEmploymentFromExperience(experience: any): string | undefined {
    if (!Array.isArray(experience) || experience.length === 0) return undefined;

    const cleanText = (value: any): string => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      if (!trimmed) return '';
      const lower = trimmed.toLowerCase();
      if (['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided'].includes(lower)) return '';
      return trimmed;
    };

    const lines = experience
      .filter((e: any) => e && typeof e === 'object')
      .map((e: any) => {
        const title = cleanText(e.title);
        const company = cleanText(e.company);
        const location = cleanText(e.location);
        const start = cleanText(e.start_date);
        const end = cleanText(e.end_date);

        const role = [title, company ? `at ${company}` : ''].filter(Boolean).join(' ');
        const metaParts = [location, start && end ? `${start} - ${end}` : start || end].filter(Boolean);
        const meta = metaParts.length > 0 ? ` (${metaParts.join(', ')})` : '';

        const description = cleanText(e.description);
        const desc = description ? `\n- ${description}` : '';

        const line = `${role || company || title}`.trim();
        if (!line) return null;
        return `${line}${meta}${desc}`;
      })
      .filter(Boolean) as string[];

    if (lines.length === 0) return undefined;
    return lines.slice(0, 12).join('\n\n');
  }

  function parseYear(value: unknown): number | null {
    if (!value || typeof value !== 'string') return null;
    const v = value.trim();
    if (!v) return null;
    if (/^(present|current|now)$/i.test(v)) return new Date().getFullYear();
    const match = v.match(/(19\d{2}|20\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    return Number.isFinite(year) ? year : null;
  }

  function inferExperienceYearsFromExperience(experience: any): number | undefined {
    if (!Array.isArray(experience) || experience.length === 0) return undefined;

    const years: { start?: number; end?: number }[] = experience
      .filter((e: any) => e && typeof e === 'object')
      .map((e: any) => ({
        start: parseYear(e.start_date) ?? undefined,
        end: parseYear(e.end_date) ?? (parseYear(e.start_date) ? new Date().getFullYear() : undefined),
      }))
      .filter((r: any) => r.start);

    if (years.length === 0) return undefined;
    const minStart = Math.min(...years.map((y) => y.start as number));
    const maxEnd = Math.max(...years.map((y) => (y.end ?? new Date().getFullYear()) as number));

    const diff = maxEnd - minStart;
    if (!Number.isFinite(diff) || diff <= 0) return undefined;
    // Keep as integer years for DB column type
    return Math.max(1, Math.round(diff));
  }

  const worker = new Worker(
    'cv-parsing',
    async (job: Job) => {
      const { jobId, attachmentId, fileUrl, fileHash, force } = job.data as {
        jobId: string;
        attachmentId: string;
        fileUrl: string;
        fileHash?: string | null;
        force?: boolean;
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
        const derivedPreviousEmployment =
          typeof parsedCandidate.previous_employment === 'string' && parsedCandidate.previous_employment.trim()
            ? parsedCandidate.previous_employment
            : buildPreviousEmploymentFromExperience(parsedCandidate.experience);

        const derivedExperienceYears =
          typeof parsedCandidate.experience_years === 'number' && Number.isFinite(parsedCandidate.experience_years)
            ? parsedCandidate.experience_years
            : inferExperienceYearsFromExperience(parsedCandidate.experience);

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
          experience_years: derivedExperienceYears,
          country_of_interest: parsedCandidate.country_of_interest,
          skills: parsedCandidate.skills,
          languages: parsedCandidate.languages,
          education: parsedCandidate.education,
          certifications: parsedCandidate.certifications,
          internships: parsedCandidate.internships,
          previous_employment: derivedPreviousEmployment,
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

          // Persist Gmail thread identity (if this CV came via Gmail)
          await maybeAttachGmailThreadToCandidate(existingCandidateId, attachmentId);

          // Fetch updated candidate to check if gmail_thread_id was set
          const { data: updatedCandidateForEmail } = await db
            .from('candidates')
            .select('gmail_thread_id')
            .eq('id', existingCandidateId)
            .maybeSingle();

          // Send missing-data email (Gmail-threaded if thread exists, standalone otherwise)
          try {
            const { maybeSendMissingDataEmail, sendStandaloneMissingDataEmail } = await import(
              '../services/missingDataEmailService'
            );
            if (updatedCandidateForEmail?.gmail_thread_id) {
              await maybeSendMissingDataEmail({ candidateId: existingCandidateId, trigger: 'cv_parsed_existing' });
            } else {
              await sendStandaloneMissingDataEmail({
                candidateId: existingCandidateId,
                trigger: 'cv_parsed_existing_manual',
              });
            }
          } catch (emailErr) {
            console.warn('[CVParser] Missing-data email send failed (non-fatal):', emailErr);
          }
          
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

              // Persist Gmail thread identity (if this CV came via Gmail)
              await maybeAttachGmailThreadToCandidate(candidate.id, attachmentId);

              // Fetch updated candidate to check if gmail_thread_id was set
              const { data: updatedCandidateNew } = await db
                .from('candidates')
                .select('gmail_thread_id')
                .eq('id', candidate.id)
                .maybeSingle();

              // Send missing-data email (Gmail-threaded if thread exists, standalone otherwise)
              try {
                const { maybeSendMissingDataEmail, sendStandaloneMissingDataEmail } = await import(
                  '../services/missingDataEmailService'
                );
                if (updatedCandidateNew?.gmail_thread_id) {
                  await maybeSendMissingDataEmail({ candidateId: candidate.id, trigger: 'cv_parsed_new' });
                } else {
                  await sendStandaloneMissingDataEmail({
                    candidateId: candidate.id,
                    trigger: 'cv_parsed_new_manual',
                  });
                }
              } catch (emailErr) {
                console.warn('[CVParser] Missing-data email send failed (non-fatal):', emailErr);
              }
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

            // Avoid creating duplicate split documents on reprocessing unless explicitly forced.
            let shouldSkipSplit = false;
            if (!force) {
              const { data: existingSplitDocs, error: existingErr } = await db
                .from('candidate_documents')
                .select('id')
                .eq('inbox_attachment_id', attachmentId)
                .limit(1);
              if (!existingErr && existingSplitDocs && existingSplitDocs.length > 0) {
                console.log(`[CVParser] Split documents already exist for attachment ${attachmentId}; skipping split-and-categorize (use force=1 to override).`);
                shouldSkipSplit = true;
              }
            }

            if (shouldSkipSplit) {
              // Skip split doc creation to avoid duplicates.
            } else {

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
                const docTypeLower = (d.doc_type || '').toLowerCase();

                // Special handling: if parser produced a PHOTOS PDF section, try hybrid extraction
                // from that section instead of scanning the whole CV.
                if ((docTypeLower === 'photo' || docTypeLower === 'photos') && d.is_image !== true) {
                  try {
                    console.log(`[CVParser] Photos PDF detected for candidate ${newCandidate.id}. Attempting hybrid extraction from photos section...`);

                    const extractionResult = await extractProfilePhotoHybrid(newCandidate.id, attachmentId, pdfBuffer);
                    if (extractionResult.success && extractionResult.photoBuffer) {
                      const uploaded = await uploadExtractedPhotoToCandidatePhotos(
                        newCandidate.id,
                        attachmentId,
                        extractionResult.photoBuffer
                      );

                      console.log(`[CVParser] ✅ Hybrid photos-section extraction succeeded (method=${extractionResult.method}). Skipping split_photos document creation.`, {
                        candidateId: newCandidate.id,
                        attachmentId,
                        storagePath: uploaded.storagePath,
                      });

                      continue;
                    }

                    console.log(`[CVParser] Hybrid photos-section extraction did not produce a photo. Continuing with normal split document creation.`, {
                      candidateId: newCandidate.id,
                      attachmentId,
                    });
                  } catch (hyErr: any) {
                    console.warn(`[CVParser] Hybrid photos-section extraction error; continuing with normal split document creation:`, hyErr?.message || hyErr);
                  }
                }
                
                // Use shared utility to handle image detection, profile photo saving, and storage upload
                let processed: any;
                try {
                  processed = await processSplitDocument(d, newCandidate.id, uploadId, folder);
                } catch (processErr: any) {
                  console.error(`[CVParser] Failed to process split doc ${d.doc_type}:`, processErr.message);
                  continue;
                }

                // Map parser doc_type to candidate_documents category
                const categoryMap: Record<string, DocumentCategory> = {
                  cv_resume: DOCUMENT_CATEGORIES.CV_RESUME,
                  passport: DOCUMENT_CATEGORIES.PASSPORT,
                  national_id: DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                  cnic: DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                  driving_license: DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                  police_character_certificate: DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE,
                  police_certificate: DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE,
                  educational_documents: DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                  educational_document: DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                  degree: DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                  diploma: DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                  transcript: DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                  experience_certificate: DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
                  experience_certificates: DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
                  employment_certificate: DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
                  navttc_report: DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
                  navttc_reports: DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
                  navttc: DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
                  medical_reports: DOCUMENT_CATEGORIES.MEDICAL_REPORTS,
                  medical_certificate: DOCUMENT_CATEGORIES.MEDICAL_REPORTS,
                  certificates: DOCUMENT_CATEGORIES.CERTIFICATES,
                  certificate: DOCUMENT_CATEGORIES.CERTIFICATES,
                  professional_certificate: DOCUMENT_CATEGORIES.CERTIFICATES,
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
                  police_character_certificate: 'police_character_certificate',
                  police_certificate: 'police_character_certificate',
                  educational_documents: 'degree',
                  educational_document: 'degree',
                  degree: 'degree',
                  diploma: 'degree',
                  transcript: 'degree',
                  experience_certificate: 'certificate',
                  experience_certificates: 'certificate',
                  employment_certificate: 'certificate',
                  navttc_report: 'certificate',
                  navttc_reports: 'certificate',
                  navttc: 'certificate',
                  cv_resume: 'other',
                  medical_reports: 'medical',
                  medical_certificate: 'medical',
                  certificate: 'certificate',
                  certificates: 'certificate',
                  professional_certificate: 'certificate',
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
                  file_name: generateDescriptiveFilename(
                    {
                      doc_type: d.doc_type,
                      pages: d.pages,
                      split_strategy: d.split_strategy,
                      page_number: d.pages && d.pages.length === 1 ? d.pages[0] : undefined,
                    },
                    newCandidate.name,
                    Date.now()
                  ),
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
            }
          } catch (splitErr: any) {
            const msg = String(splitErr?.message || splitErr || '');
            const statusMatch = msg.match(/split-and-categorize failed \((\d+)\)/i);
            const statusCode = statusMatch ? Number(statusMatch[1]) : null;

            // If the parser is temporarily unavailable (e.g. Railway cold-start / 502),
            // fail the job so BullMQ can retry (attempts/backoff configured on enqueue).
            const isTransient =
              statusCode === 502 ||
              statusCode === 503 ||
              statusCode === 504 ||
              /Application failed to respond/i.test(msg) ||
              /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg);

            console.error(`[CVParser] Split-and-categorize failed for attachment ${attachmentId}:`, msg);

            if (isTransient) {
              throw new Error(`Transient split-and-categorize failure (will retry): ${msg}`);
            }

            // Non-blocking for non-transient failures: CV parsing should still succeed.
          }
        }

        // If no profile photo exists yet, try extracting it directly from the CV PDF.
        if (newCandidate?.id && mimeType === 'application/pdf') {
          try {
            const { data: freshCandidate } = await db
              .from('candidates')
              .select('profile_photo_bucket, profile_photo_path, profile_photo_url, photo_received')
              .eq('id', newCandidate.id)
              .maybeSingle();

            if (!hasProfilePhoto(freshCandidate)) {
              console.log(`[CVParser] No profile photo found for candidate ${newCandidate.id}. Extracting from CV PDF...`);
              const extraction = await extractProfilePhotoFromPdfUsingAI({
                candidateId: newCandidate.id,
              });
              console.log(`[CVParser] ✅ Extracted profile photo from CV PDF`, {
                candidateId: newCandidate.id,
                pageUsed: extraction.pageUsed,
                confidence: extraction.confidence,
              });
            } else {
              console.log(`[CVParser] Profile photo already present for candidate ${newCandidate.id}. Skipping CV photo extraction.`);
            }
          } catch (photoErr: any) {
            console.warn(`[CVParser] CV photo extraction failed for candidate ${newCandidate?.id}:`, photoErr?.message || photoErr);
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
