"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCvParserWorker = startCvParserWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const crypto_1 = __importDefault(require("crypto"));
const parsingJobsService_1 = require("../services/parsingJobsService");
const candidateService_1 = require("../services/candidateService");
const database_1 = require("../config/database");
const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-portal-python-parser-production.up.railway.app');
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET;
function signHmac(body) {
    return crypto_1.default.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}
// Helper to create candidate from parsed CV data
async function createCandidateFromParsedData(parsed, attachmentId, identityFields) {
    try {
        const candidate = parsed.candidate || {};
        // Parse date of birth from various formats
        let dateOfBirth = undefined;
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
                }
                else if (dobStr.includes('-')) {
                    // Format: "13-10-1983" or "1983-10-13"
                    const parts = dobStr.split('-');
                    if (parts[0].length === 4) {
                        // YYYY-MM-DD
                        dateOfBirth = dobStr;
                    }
                    else {
                        // DD-MM-YYYY
                        dateOfBirth = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    }
                }
                else {
                    dateOfBirth = dobStr;
                }
            }
            catch (e) {
                console.warn(`[CVParser] Failed to parse date of birth: ${dobStr}`, e);
            }
        }
        // Build candidate data from parsed CV - map all fields from Python parser
        // Include identity fields extracted from CV (father_name, cnic, passport, date_of_birth, etc.)
        const candidateData = {
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
                ? candidate.education.map((e) => `${e.degree} from ${e.institution}`).join('; ')
                : undefined,
            certifications: Array.isArray(candidate.certifications) ? candidate.certifications.join(', ') : undefined,
            previous_employment: candidate.previous_employment || (Array.isArray(candidate.experience) && candidate.experience.length > 0
                ? candidate.experience.map((e) => `${e.title} at ${e.company}`).join('; ')
                : undefined),
            passport_expiry: candidate.passport_expiry || identityFields?.passport_expiry || identityFields?.expiry_date || undefined,
            professional_summary: candidate.professional_summary || candidate.summary || undefined,
        };
        // Create candidate (system-created, no specific userId)
        const newCandidate = await (0, candidateService_1.createCandidate)(candidateData);
        // Link the attachment to the candidate
        const db = (0, database_1.supabaseAdminClient)();
        await db
            .from('inbox_attachments')
            .update({ candidate_id: newCandidate.id })
            .eq('id', attachmentId);
        console.log(`[CVParser] Created candidate ${newCandidate.id} for attachment ${attachmentId}`);
        return newCandidate;
    }
    catch (err) {
        console.error(`[CVParser] Failed to create candidate from parsed data:`, err);
        // Don't throw - parsing was successful, just candidate creation failed
    }
}
function startCvParserWorker() {
    const parsingJobs = new parsingJobsService_1.ParsingJobsService();
    const worker = new bullmq_1.Worker('cv-parsing', async (job) => {
        const { jobId, attachmentId, fileUrl, fileHash } = job.data;
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
            let identityFields = null;
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
                }
                else {
                    const errorText = await categorizeRes.text();
                    console.warn(`[CVParser] Failed to categorize CV for identity extraction: ${categorizeRes.status} - ${errorText.slice(0, 200)}`);
                }
            }
            catch (categorizeError) {
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
            const { findExistingCandidate, enrichCandidateData, updateMissingFields } = await Promise.resolve().then(() => __importStar(require('../services/progressiveDataCompletionService')));
            const db = (0, database_1.supabaseAdminClient)();
            // Combine data from both sources (parse-cv and categorize-document)
            const parsedCandidate = parsed.candidate || {};
            const combinedData = {
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
                if (identityFields.name)
                    combinedData.name = identityFields.name;
                if (identityFields.father_name)
                    combinedData.father_name = identityFields.father_name;
                if (identityFields.cnic)
                    combinedData.cnic = identityFields.cnic;
                if (identityFields.passport_no) {
                    combinedData.passport = identityFields.passport_no;
                    combinedData.passport_no = identityFields.passport_no;
                }
                if (identityFields.email)
                    combinedData.email = identityFields.email;
                if (identityFields.phone)
                    combinedData.phone = identityFields.phone;
                if (identityFields.date_of_birth || identityFields.dob) {
                    combinedData.date_of_birth = identityFields.date_of_birth || identityFields.dob;
                }
                if (identityFields.nationality)
                    combinedData.nationality = identityFields.nationality;
                if (identityFields.passport_expiry || identityFields.expiry_date) {
                    combinedData.passport_expiry = identityFields.passport_expiry || identityFields.expiry_date;
                }
            }
            // Find existing candidate using progressive completion matching
            const existingCandidateId = await findExistingCandidate(combinedData);
            let candidate;
            if (existingCandidateId) {
                // Update existing candidate using progressive completion
                console.log(`[CVParser] Found existing candidate ${existingCandidateId}, enriching with CV data...`);
                // Enrich candidate with CV data (progressive completion - only fills missing fields)
                const enrichmentResult = await enrichCandidateData(existingCandidateId, combinedData, 'cv', attachmentId, 'cv');
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
            }
            else {
                // Create new candidate from parsed data (including identity fields) and link to attachment
                candidate = await createCandidateFromParsedData(parsed, attachmentId, identityFields);
                // After creation, enrich with any additional data and recalculate missing fields
                if (candidate?.id) {
                    try {
                        await enrichCandidateData(candidate.id, combinedData, 'cv', attachmentId, 'cv');
                        await updateMissingFields(candidate.id);
                    }
                    catch (enrichError) {
                        console.warn(`[CVParser] Failed to enrich newly created candidate:`, enrichError);
                    }
                }
            }
            const newCandidate = candidate;
            // IMPORTANT: Set cv_received flag immediately after candidate is created from inbox CV
            // This ensures the document flag shows green/red on the card from the start
            if (newCandidate?.id) {
                try {
                    // Call the service function directly instead of the controller to avoid mock response issues
                    const db = (0, database_1.supabaseAdminClient)();
                    const { data: documents } = await db
                        .from('candidate_documents')
                        .select('category')
                        .eq('candidate_id', newCandidate.id);
                    const hasCV = documents?.some((d) => d.category === 'cv_resume' || d.category === 'cv');
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
                }
                catch (flagError) {
                    // Log but don't fail the parsing job if flag update fails
                    console.error(`[CVParser] Failed to update document flags for candidate ${newCandidate.id}:`, flagError?.message);
                }
            }
            return { ok: true };
        }
        catch (err) {
            await parsingJobs.setStatus(jobId, 'failed', {
                finished_at: new Date().toISOString(),
                error_code: 'PARSING_FAILED',
                error_message: err?.message ?? 'Unknown error',
            });
            throw err;
        }
    }, {
        connection: redis_1.redis,
        concurrency: 5,
        limiter: { max: 10, duration: 60000 },
    });
    worker.on('failed', (job, err) => {
        console.error('cv-parsing failed', job?.id, err?.message);
    });
    return worker;
}
