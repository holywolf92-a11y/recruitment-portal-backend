import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import crypto from 'crypto';
import { ParsingJobsService } from '../services/parsingJobsService';
import { createCandidate, CreateCandidateData } from '../services/candidateService';
import { supabaseAdminClient } from '../config/database';

const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-portal-python-parser-production.up.railway.app') as string;
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET as string;

function signHmac(body: string) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

// Helper to create candidate from parsed CV data
async function createCandidateFromParsedData(parsed: any, attachmentId: string, identityFields?: any) {
  try {
    const candidate = parsed.candidate || {};
    
    // Parse date of birth from various formats
    let dateOfBirth: string | undefined = undefined;
    if (identityFields?.date_of_birth || identityFields?.dob) {
      const dobStr = identityFields.date_of_birth || identityFields.dob;
      try {
        // Try to parse formats like "13 October 1983", "13-10-1983", "1983-10-13"
        if (dobStr.includes(' ')) {
          // Format: "13 October 1983"
          const date = new Date(dobStr);
          if (!isNaN(date.getTime())) {
            dateOfBirth = date.toISOString().split('T')[0];
          }
        } else if (dobStr.includes('-')) {
          // Format: "13-10-1983" or "1983-10-13"
          const parts = dobStr.split('-');
          if (parts[0].length === 4) {
            // YYYY-MM-DD
            dateOfBirth = dobStr;
          } else {
            // DD-MM-YYYY
            dateOfBirth = `${parts[2]}-${parts[1]}-${parts[0]}`;
          }
        } else {
          dateOfBirth = dobStr;
        }
      } catch (e) {
        console.warn(`[CVParser] Failed to parse date of birth: ${dobStr}`, e);
      }
    }
    
    // Build candidate data from parsed CV - map all fields from Python parser
    // Include identity fields extracted from CV (father_name, cnic, passport, date_of_birth, etc.)
    const candidateData: CreateCandidateData = {
      name: candidate.full_name || identityFields?.name || 'Unknown',
      father_name: identityFields?.father_name || candidate.father_name || undefined,
      email: candidate.email || identityFields?.email || undefined,
      phone: candidate.phone || identityFields?.phone || undefined,
      address: candidate.location || undefined,
      date_of_birth: dateOfBirth || candidate.date_of_birth || undefined,
      marital_status: candidate.marital_status || undefined,
      cnic: identityFields?.cnic || candidate.cnic || undefined,
      passport: identityFields?.passport_no || candidate.passport || undefined,
      nationality: candidate.nationality || identityFields?.nationality || undefined,
      position: candidate.position || undefined,
      experience_years: candidate.experience_years || undefined,
      country_of_interest: candidate.country_of_interest || 'missing',
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
      passport_expiry: candidate.passport_expiry || identityFields?.passport_expiry || identityFields?.expiry_date || undefined,
      professional_summary: candidate.professional_summary || candidate.summary || undefined,
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
        const payloadObj = {
          attachment_id: attachmentId,
          file_url: fileUrl,
          file_hash: fileHash ?? null,
        };
        const payload = JSON.stringify(payloadObj);

        // Step 1: Parse CV for professional fields
        const res = await fetch(`${PY_URL}/parse-cv`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-hmac-signature': signHmac(payload),
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
          // Fetch the file and convert to base64
          const fileResponse = await fetch(fileUrl);
          if (!fileResponse.ok) {
            throw new Error(`Failed to fetch file: ${fileResponse.status}`);
          }
          const fileBuffer = await fileResponse.arrayBuffer();
          const fileBase64 = Buffer.from(fileBuffer).toString('base64');
          const fileName = fileUrl.split('/').pop() || 'cv.pdf';
          const mimeType = fileName.endsWith('.pdf') ? 'application/pdf' : 
                          fileName.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                          'application/octet-stream';
          
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

        // Check if candidate already exists (by email, CNIC, or passport from identity fields)
        // If exists, update it instead of creating a new one
        let existingCandidate = null;
        if (identityFields) {
          const db = supabaseAdminClient();
          const candidateName = parsed.candidate?.full_name || identityFields?.name;
          
          // Try to find existing candidate by email, CNIC, or passport
          if (identityFields.email) {
            const { data } = await db
              .from('candidates')
              .select('id')
              .eq('email', identityFields.email)
              .maybeSingle();
            if (data) existingCandidate = data;
          }
          
          if (!existingCandidate && identityFields.cnic) {
            const { normalizeCNIC } = await import('../services/candidateService');
            const normalizedCNIC = normalizeCNIC(identityFields.cnic);
            if (normalizedCNIC) {
              const { data } = await db
                .from('candidates')
                .select('id')
                .eq('cnic_normalized', normalizedCNIC)
                .maybeSingle();
              if (data) existingCandidate = data;
            }
          }
          
          if (!existingCandidate && identityFields.passport_no) {
            const { normalizePassport } = await import('../services/candidateService');
            const normalizedPassport = normalizePassport(identityFields.passport_no);
            if (normalizedPassport) {
              const { data } = await db
                .from('candidates')
                .select('id')
                .eq('passport_normalized', normalizedPassport)
                .maybeSingle();
              if (data) existingCandidate = data;
            }
          }
          
          // Also try fuzzy name match if we have a name
          if (!existingCandidate && candidateName && candidateName !== 'Unknown') {
            const { data: candidates } = await db
              .from('candidates')
              .select('id, name')
              .ilike('name', `%${candidateName.split(' ')[0]}%`)
              .limit(5);
            
            // Simple fuzzy match - check if first name matches
            if (candidates && candidates.length > 0) {
              const firstName = candidateName.split(' ')[0].toLowerCase();
              const match = candidates.find((c: any) => 
                c.name.toLowerCase().includes(firstName) || firstName.includes(c.name.toLowerCase().split(' ')[0])
              );
              if (match) existingCandidate = match;
            }
          }
        }
        
        let candidate;
        if (existingCandidate) {
          // Update existing candidate
          console.log(`[CVParser] Found existing candidate ${existingCandidate.id}, updating with CV data...`);
          const { updateCandidate } = await import('../services/candidateService');
          const candidateData: any = {};
          
          // Map parsed data to update fields
          const parsedCandidate = parsed.candidate || {};
          if (parsedCandidate.full_name) candidateData.name = parsedCandidate.full_name;
          if (identityFields?.father_name) candidateData.father_name = identityFields.father_name;
          if (identityFields?.cnic) candidateData.cnic = identityFields.cnic;
          if (identityFields?.passport_no) candidateData.passport = identityFields.passport_no;
          if (identityFields?.date_of_birth || identityFields?.dob) {
            // Parse date
            const dobStr = identityFields.date_of_birth || identityFields.dob;
            if (dobStr.includes(' ')) {
              const date = new Date(dobStr);
              if (!isNaN(date.getTime())) candidateData.date_of_birth = date.toISOString().split('T')[0];
            } else if (dobStr.includes('-')) {
              const parts = dobStr.split('-');
              if (parts[0].length === 4) {
                candidateData.date_of_birth = dobStr;
              } else {
                candidateData.date_of_birth = `${parts[2]}-${parts[1]}-${parts[0]}`;
              }
            }
          }
          if (parsedCandidate.nationality || identityFields?.nationality) {
            candidateData.nationality = parsedCandidate.nationality || identityFields.nationality;
          }
          if (parsedCandidate.position) candidateData.position = parsedCandidate.position;
          if (parsedCandidate.experience_years) candidateData.experience_years = parsedCandidate.experience_years;
          
          candidate = await updateCandidate(existingCandidate.id, candidateData, 'system');
          
          // Link attachment to existing candidate
          const db = supabaseAdminClient();
          await db
            .from('inbox_attachments')
            .update({ candidate_id: existingCandidate.id })
            .eq('id', attachmentId);
          
          console.log(`[CVParser] Updated existing candidate ${existingCandidate.id} with CV data`);
        } else {
          // Create new candidate from parsed data (including identity fields) and link to attachment
          candidate = await createCandidateFromParsedData(parsed, attachmentId, identityFields);
        }
        
        const newCandidate = candidate;

        // IMPORTANT: Set cv_received flag immediately after candidate is created from inbox CV
        // This ensures the document flag shows green/red on the card from the start
        if (newCandidate?.id) {
          try {
            // Call the service function directly instead of the controller to avoid mock response issues
            const db = supabaseAdminClient();
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
