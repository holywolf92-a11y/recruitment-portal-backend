"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityMatchingService = exports.IdentityMatchingService = void 0;
const database_1 = require("../config/database");
const candidateService_1 = require("./candidateService");
const documentCategories_1 = require("../config/documentCategories");
const documentRejectionService_1 = require("./documentRejectionService");
const similarityUtils_1 = require("../utils/similarityUtils");
/**
 * Identity Matching Service
 *
 * Implements strict identity verification rules:
 * - PASS: If CNIC matches OR passport_no matches OR (email + name similar)
 * - FAIL: If strong ID (CNIC/passport) belongs to different person
 * - UNVERIFIABLE: If no IDs extracted
 */
class IdentityMatchingService {
    /**
     * Match extracted identity fields against a candidate record
     *
     * @param candidateId - Candidate ID to match against
     * @param extractedIdentity - Identity fields extracted from document
     * @param documentCategory - Document category (for rejection code determination)
     * @param aiConfidence - AI confidence score (0-1)
     * @param ocrConfidence - OCR confidence score (0-1)
     * @param expiryDate - Document expiry date (if applicable)
     * @param errorStage - Error stage if processing failed
     */
    async matchIdentity(candidateId, extractedIdentity, documentCategory, aiConfidence, ocrConfidence, expiryDate, errorStage) {
        try {
            // Fetch candidate record
            const db = (0, database_1.supabaseAdminClient)();
            const { data: candidate, error } = await db
                .from('candidates')
                .select('id, name, father_name, cnic_normalized, passport_normalized, email, phone')
                .eq('id', candidateId)
                .maybeSingle(); // Use maybeSingle() instead of single() to handle missing records gracefully
            if (error) {
                console.error(`[IdentityMatchingService] Database error fetching candidate ${candidateId}:`, error);
                throw new Error(`Database error fetching candidate: ${error.message}`);
            }
            if (!candidate) {
                console.error(`[IdentityMatchingService] Candidate ${candidateId} not found in database`);
                throw new Error(`Candidate not found: ${candidateId}`);
            }
            // Normalize extracted identity fields
            const extractedCnic = extractedIdentity.cnic ? (0, candidateService_1.normalizeCNIC)(extractedIdentity.cnic) : null;
            const extractedPassport = extractedIdentity.passport_no ? (0, candidateService_1.normalizePassport)(extractedIdentity.passport_no) : null;
            const extractedPhone = extractedIdentity.phone ? (0, candidateService_1.normalizePhoneE164)(extractedIdentity.phone) : null;
            // Track what we matched on
            const matchedOn = [];
            const mismatchFields = [];
            // PRIORITY 1: CNIC Matching (strongest identifier)
            if (extractedCnic) {
                if (candidate.cnic_normalized && extractedCnic === candidate.cnic_normalized) {
                    // CNIC matches - VERIFIED
                    matchedOn.push('cnic');
                    return {
                        matched: true,
                        matched_on: matchedOn,
                        confidence: 1.0,
                        reason_code: documentCategories_1.REJECTION_REASON_CODES.MANUAL_REVIEW_REQUIRED, // Use MANUAL_REVIEW_REQUIRED for verified cases (legacy compatibility)
                        candidate_fields: {
                            name: candidate.name,
                            email: candidate.email,
                            phone: candidate.phone,
                        },
                    };
                }
                else if (!candidate.cnic_normalized) {
                    // Candidate doesn't have CNIC set yet - this is a new CNIC document
                    // Since document was manually uploaded for this candidate, trust it and update candidate
                    console.log(`[IdentityMatching] Candidate ${candidateId} doesn't have cnic_normalized. Document has CNIC ${extractedCnic}. Updating candidate and verifying.`);
                    // Update candidate's cnic_normalized
                    await db
                        .from('candidates')
                        .update({ cnic_normalized: extractedCnic })
                        .eq('id', candidateId);
                    // Verify the document
                    matchedOn.push('cnic');
                    return {
                        matched: true,
                        matched_on: matchedOn,
                        confidence: 0.95, // High confidence since we're setting it for the first time
                        reason_code: documentCategories_1.REJECTION_REASON_CODES.MANUAL_REVIEW_REQUIRED,
                        candidate_fields: {
                            name: candidate.name,
                            email: candidate.email,
                            phone: candidate.phone,
                        },
                        notes: `CNIC ${extractedCnic} extracted from document and set as candidate's CNIC`,
                    };
                }
                else if (candidate.cnic_normalized && extractedCnic !== candidate.cnic_normalized) {
                    // CNIC exists but doesn't match - Check if it belongs to someone else
                    const cnicAnalysis = (0, similarityUtils_1.analyzeIdMismatch)(extractedCnic, candidate.cnic_normalized);
                    console.log(`[IdentityMatching] CNIC mismatch for candidate ${candidateId}. Similarity: ${cnicAnalysis.similarity}% (${cnicAnalysis.severity})`);
                    const { data: otherCandidate } = await db
                        .from('candidates')
                        .select('id, name')
                        .eq('cnic_normalized', extractedCnic)
                        .neq('id', candidateId)
                        .neq('status', 'Deleted') // Exclude deleted candidates
                        .maybeSingle();
                    if (otherCandidate) {
                        // CNIC belongs to a different person - CRITICAL MISMATCH
                        mismatchFields.push('cnic');
                        // Use DocumentRejectionService for detailed rejection if documentCategory provided
                        if (documentCategory) {
                            const rejectionContext = {
                                documentCategory,
                                extractedIdentity,
                                candidateData: {
                                    name: candidate.name,
                                    cnic_normalized: candidate.cnic_normalized,
                                },
                                aiConfidence,
                                ocrConfidence,
                                expiryDate,
                                errorStage,
                                mismatchFields,
                                mismatchSeverity: 'critical', // Cross-candidate ID is always critical
                                similarityScores: { cnic: cnicAnalysis.similarity },
                                idBelongsToOtherCandidate: true,
                                otherCandidateName: otherCandidate.name,
                            };
                            const rejectionResult = documentRejectionService_1.DocumentRejectionService.determineRejectionCode(rejectionContext);
                            return {
                                matched: false,
                                matched_on: [],
                                confidence: 0.0,
                                reason_code: documentCategories_1.REJECTION_REASON_CODES.CNIC_MISMATCH,
                                mismatch_fields: mismatchFields,
                                mismatch_severity: 'critical',
                                similarity_scores: { cnic: cnicAnalysis.similarity },
                                candidate_fields: {
                                    name: candidate.name,
                                },
                                notes: `CNIC belongs to different candidate: ${otherCandidate.name} (ID: ${otherCandidate.id}). Similarity: ${cnicAnalysis.similarity}%`,
                                rejection_code: rejectionResult.code,
                                rejection_reason: rejectionResult.reason,
                                retry_possible: rejectionResult.retryPossible,
                                is_overridable: rejectionResult.isOverridable,
                                required_role: rejectionResult.requiredRole,
                            };
                        }
                        else {
                            return {
                                matched: false,
                                matched_on: [],
                                confidence: 0.0,
                                reason_code: documentCategories_1.REJECTION_REASON_CODES.CNIC_MISMATCH,
                                mismatch_fields: mismatchFields,
                                mismatch_severity: 'critical',
                                similarity_scores: { cnic: cnicAnalysis.similarity },
                                candidate_fields: {
                                    name: candidate.name,
                                },
                                notes: `CNIC belongs to different candidate: ${otherCandidate.name} (ID: ${otherCandidate.id}). Similarity: ${cnicAnalysis.similarity}%`,
                            };
                        }
                    }
                    else {
                        // CNIC doesn't match candidate's CNIC, but not found in system - mark as mismatch with severity
                        mismatchFields.push('cnic');
                        console.log(`[IdentityMatching] CNIC mismatch (not in system). Extracted: ${extractedCnic}, Candidate: ${candidate.cnic_normalized}, Similarity: ${cnicAnalysis.similarity}%`);
                    }
                }
            }
            // PRIORITY 2: Passport Matching (second strongest identifier)
            if (extractedPassport) {
                if (candidate.passport_normalized && extractedPassport === candidate.passport_normalized) {
                    // Passport matches - VERIFIED
                    matchedOn.push('passport');
                    return {
                        matched: true,
                        matched_on: matchedOn,
                        confidence: 0.95,
                        reason_code: documentCategories_1.REJECTION_REASON_CODES.MANUAL_REVIEW_REQUIRED, // Use MANUAL_REVIEW_REQUIRED for verified cases (legacy compatibility)
                        candidate_fields: {
                            name: candidate.name,
                            email: candidate.email,
                            phone: candidate.phone,
                        },
                    };
                }
                else if (!candidate.passport_normalized) {
                    // Candidate doesn't have passport set yet - this is a new passport document
                    // Since document was manually uploaded for this candidate, trust it and update candidate
                    console.log(`[IdentityMatching] Candidate ${candidateId} doesn't have passport_normalized. Document has passport ${extractedPassport}. Updating candidate and verifying.`);
                    // Update candidate's passport_normalized
                    await db
                        .from('candidates')
                        .update({ passport_normalized: extractedPassport })
                        .eq('id', candidateId);
                    // Verify the document
                    matchedOn.push('passport');
                    return {
                        matched: true,
                        matched_on: matchedOn,
                        confidence: 0.90, // Slightly lower confidence since we're setting it for the first time
                        reason_code: documentCategories_1.REJECTION_REASON_CODES.MANUAL_REVIEW_REQUIRED,
                        candidate_fields: {
                            name: candidate.name,
                            email: candidate.email,
                            phone: candidate.phone,
                        },
                        notes: `Passport ${extractedPassport} extracted from document and set as candidate's passport`,
                    };
                }
                else if (candidate.passport_normalized && extractedPassport !== candidate.passport_normalized) {
                    // Passport exists but doesn't match - Check if it belongs to someone else
                    const passportAnalysis = (0, similarityUtils_1.analyzeIdMismatch)(extractedPassport, candidate.passport_normalized);
                    console.log(`[IdentityMatching] Passport mismatch for candidate ${candidateId}. Similarity: ${passportAnalysis.similarity}% (${passportAnalysis.severity})`);
                    const { data: otherCandidate } = await db
                        .from('candidates')
                        .select('id, name')
                        .eq('passport_normalized', extractedPassport)
                        .neq('id', candidateId)
                        .neq('status', 'Deleted') // Exclude deleted candidates
                        .maybeSingle();
                    if (otherCandidate) {
                        // Passport belongs to a different person - CRITICAL MISMATCH
                        mismatchFields.push('passport');
                        // Use DocumentRejectionService for detailed rejection if documentCategory provided
                        if (documentCategory) {
                            const rejectionContext = {
                                documentCategory,
                                extractedIdentity,
                                candidateData: {
                                    name: candidate.name,
                                    passport_normalized: candidate.passport_normalized,
                                },
                                aiConfidence,
                                ocrConfidence,
                                expiryDate,
                                errorStage,
                                mismatchFields,
                                mismatchSeverity: 'critical', // Cross-candidate ID is always critical
                                similarityScores: { passport: passportAnalysis.similarity },
                                idBelongsToOtherCandidate: true,
                                otherCandidateName: otherCandidate.name,
                            };
                            const rejectionResult = documentRejectionService_1.DocumentRejectionService.determineRejectionCode(rejectionContext);
                            return {
                                matched: false,
                                matched_on: [],
                                confidence: 0.0,
                                reason_code: documentCategories_1.REJECTION_REASON_CODES.PASSPORT_MISMATCH,
                                mismatch_fields: mismatchFields,
                                mismatch_severity: 'critical',
                                similarity_scores: { passport: passportAnalysis.similarity },
                                candidate_fields: {
                                    name: candidate.name,
                                },
                                notes: `Passport belongs to different candidate: ${otherCandidate.name} (ID: ${otherCandidate.id}). Similarity: ${passportAnalysis.similarity}%`,
                                rejection_code: rejectionResult.code,
                                rejection_reason: rejectionResult.reason,
                                retry_possible: rejectionResult.retryPossible,
                                is_overridable: rejectionResult.isOverridable,
                                required_role: rejectionResult.requiredRole,
                            };
                        }
                        else {
                            return {
                                matched: false,
                                matched_on: [],
                                confidence: 0.0,
                                reason_code: documentCategories_1.REJECTION_REASON_CODES.PASSPORT_MISMATCH,
                                mismatch_fields: mismatchFields,
                                mismatch_severity: 'critical',
                                similarity_scores: { passport: passportAnalysis.similarity },
                                candidate_fields: {
                                    name: candidate.name,
                                },
                                notes: `Passport belongs to different candidate: ${otherCandidate.name} (ID: ${otherCandidate.id}). Similarity: ${passportAnalysis.similarity}%`,
                            };
                        }
                    }
                    else {
                        // Passport doesn't match candidate's passport, but not found in system
                        // This is a mismatch - passport numbers are unique identifiers
                        mismatchFields.push('passport');
                        // Use DocumentRejectionService for detailed rejection if documentCategory provided
                        if (documentCategory) {
                            const rejectionContext = {
                                documentCategory,
                                extractedIdentity,
                                candidateData: {
                                    name: candidate.name,
                                    passport_normalized: candidate.passport_normalized,
                                },
                                aiConfidence,
                                ocrConfidence,
                                expiryDate,
                                errorStage,
                                mismatchFields,
                                mismatchSeverity: (0, similarityUtils_1.classifyMismatchSeverity)(passportAnalysis.similarity), // Use similarity-based severity
                                similarityScores: { passport: passportAnalysis.similarity },
                                idBelongsToOtherCandidate: false,
                            };
                            const rejectionResult = documentRejectionService_1.DocumentRejectionService.determineRejectionCode(rejectionContext);
                            return {
                                matched: false,
                                matched_on: [],
                                confidence: 0.0,
                                reason_code: documentCategories_1.REJECTION_REASON_CODES.PASSPORT_MISMATCH,
                                mismatch_fields: mismatchFields,
                                mismatch_severity: (0, similarityUtils_1.classifyMismatchSeverity)(passportAnalysis.similarity),
                                similarity_scores: { passport: passportAnalysis.similarity },
                                candidate_fields: {
                                    name: candidate.name,
                                    passport_no: candidate.passport_normalized,
                                },
                                notes: `Passport number in document (${extractedPassport}) does not match candidate's passport (${candidate.passport_normalized}). Similarity: ${passportAnalysis.similarity}%. ${passportAnalysis.description}`,
                                rejection_code: rejectionResult.code,
                                rejection_reason: rejectionResult.reason,
                                retry_possible: rejectionResult.retryPossible,
                                is_overridable: rejectionResult.isOverridable,
                                required_role: rejectionResult.requiredRole,
                            };
                        }
                        else {
                            return {
                                matched: false,
                                matched_on: [],
                                confidence: 0.0,
                                reason_code: documentCategories_1.REJECTION_REASON_CODES.PASSPORT_MISMATCH,
                                mismatch_fields: mismatchFields,
                                mismatch_severity: (0, similarityUtils_1.classifyMismatchSeverity)(passportAnalysis.similarity),
                                similarity_scores: { passport: passportAnalysis.similarity },
                                candidate_fields: {
                                    name: candidate.name,
                                    passport_no: candidate.passport_normalized,
                                },
                                notes: `Passport number in document (${extractedPassport}) does not match candidate's passport (${candidate.passport_normalized}). Similarity: ${passportAnalysis.similarity}%. ${passportAnalysis.description}`,
                            };
                        }
                    }
                }
            }
            // PRIORITY 3: Email + Name Matching (weaker, needs both to match)
            if (extractedIdentity.email && extractedIdentity.name) {
                const emailMatch = candidate.email &&
                    extractedIdentity.email.toLowerCase().trim() === candidate.email.toLowerCase().trim();
                const nameMatch = this.fuzzyNameMatch(extractedIdentity.name, candidate.name);
                if (emailMatch && nameMatch) {
                    matchedOn.push('email', 'name');
                    return {
                        matched: true,
                        matched_on: matchedOn,
                        confidence: 0.80,
                        reason_code: documentCategories_1.REJECTION_REASON_CODES.MANUAL_REVIEW_REQUIRED, // Use MANUAL_REVIEW_REQUIRED for verified cases (legacy compatibility)
                        candidate_fields: {
                            name: candidate.name,
                            email: candidate.email,
                        },
                    };
                }
                if (emailMatch && !nameMatch) {
                    mismatchFields.push('name');
                }
                if (!emailMatch && candidate.email) {
                    mismatchFields.push('email');
                }
            }
            // PRIORITY 4: Phone + Name Matching
            if (extractedPhone && extractedIdentity.name) {
                // Normalize candidate phone for comparison
                const candidatePhoneNormalized = candidate.phone ? (0, candidateService_1.normalizePhoneE164)(candidate.phone) : null;
                const phoneMatch = candidatePhoneNormalized && extractedPhone === candidatePhoneNormalized;
                const nameMatch = this.fuzzyNameMatch(extractedIdentity.name, candidate.name);
                if (phoneMatch && nameMatch) {
                    matchedOn.push('phone', 'name');
                    return {
                        matched: true,
                        matched_on: matchedOn,
                        confidence: 0.75,
                        reason_code: documentCategories_1.REJECTION_REASON_CODES.MANUAL_REVIEW_REQUIRED, // Use MANUAL_REVIEW_REQUIRED for verified cases (legacy compatibility)
                        candidate_fields: {
                            name: candidate.name,
                            phone: candidate.phone,
                        },
                    };
                }
                if (phoneMatch && !nameMatch) {
                    mismatchFields.push('name');
                }
                if (!phoneMatch && candidate.phone) {
                    mismatchFields.push('phone');
                }
            }
            // PRIORITY 5: Name-only matching (only if no strong identifiers were found)
            // This is ONLY for cases where passport/CNIC/email/phone were NOT extracted
            // If passport/CNIC were extracted but don't match, we already rejected above
            // Multiple candidates can have the same name, so name-only matching is unreliable
            if (extractedIdentity.name && !extractedPassport && !extractedCnic && !extractedIdentity.email && !extractedPhone) {
                const nameMatch = this.fuzzyNameMatch(extractedIdentity.name, candidate.name);
                if (nameMatch) {
                    // Name matches and no strong identifiers found - verify with lower confidence
                    matchedOn.push('name');
                    return {
                        matched: true,
                        matched_on: matchedOn,
                        confidence: 0.70, // Lower confidence for name-only match
                        reason_code: documentCategories_1.REJECTION_REASON_CODES.MANUAL_REVIEW_REQUIRED, // Use MANUAL_REVIEW_REQUIRED for verified cases (legacy compatibility)
                        candidate_fields: {
                            name: candidate.name,
                        },
                        notes: 'Verified by name only (no strong identifiers found in document, but name matches)',
                    };
                }
                else {
                    // Name doesn't match - add to mismatch fields
                    mismatchFields.push('name');
                }
            }
            // Decision: Were there mismatches found?
            if (mismatchFields.length > 0) {
                // We found fields that don't match - use DocumentRejectionService for detailed rejection
                if (documentCategory) {
                    const rejectionContext = {
                        documentCategory,
                        extractedIdentity,
                        candidateData: {
                            name: candidate.name,
                            father_name: candidate.father_name,
                            cnic_normalized: candidate.cnic_normalized,
                            passport_normalized: candidate.passport_normalized,
                            email: candidate.email,
                            phone: candidate.phone,
                            date_of_birth: undefined, // Not fetched, but can be added if needed
                        },
                        aiConfidence,
                        ocrConfidence,
                        expiryDate,
                        errorStage,
                        mismatchFields, // Pre-computed mismatches
                    };
                    const rejectionResult = documentRejectionService_1.DocumentRejectionService.determineRejectionCode(rejectionContext);
                    return {
                        matched: false,
                        matched_on: [],
                        confidence: 0.0,
                        reason_code: rejectionResult.code, // Use the specific rejection code from DocumentRejectionService
                        mismatch_fields: rejectionResult.mismatchFields,
                        candidate_fields: {
                            name: candidate.name,
                            email: candidate.email,
                            phone: candidate.phone,
                        },
                        notes: `Fields do not match: ${rejectionResult.mismatchFields.join(', ')}`,
                        // Detailed rejection information
                        rejection_code: rejectionResult.code,
                        rejection_reason: rejectionResult.reason,
                        retry_possible: rejectionResult.retryPossible,
                        is_overridable: rejectionResult.isOverridable,
                        required_role: rejectionResult.requiredRole,
                    };
                }
                else {
                    // Fallback if documentCategory not provided
                    // Use the highest priority mismatch code from mismatchFields
                    const priorityOrder = [
                        documentCategories_1.REJECTION_REASON_CODES.CNIC_MISMATCH,
                        documentCategories_1.REJECTION_REASON_CODES.PASSPORT_MISMATCH,
                        documentCategories_1.REJECTION_REASON_CODES.DOB_MISMATCH,
                        documentCategories_1.REJECTION_REASON_CODES.NAME_MISMATCH,
                        documentCategories_1.REJECTION_REASON_CODES.EMAIL_MISMATCH,
                        documentCategories_1.REJECTION_REASON_CODES.PHONE_MISMATCH,
                    ];
                    const fallbackCode = priorityOrder.find(code => mismatchFields.some(field => field.toLowerCase().includes(code.toLowerCase().replace('_mismatch', '')))) || documentCategories_1.REJECTION_REASON_CODES.NAME_MISMATCH; // Default to NAME_MISMATCH if no priority match
                    return {
                        matched: false,
                        matched_on: [],
                        confidence: 0.0,
                        reason_code: fallbackCode,
                        mismatch_fields: mismatchFields,
                        candidate_fields: {
                            name: candidate.name,
                            email: candidate.email,
                            phone: candidate.phone,
                        },
                        notes: `Fields do not match: ${mismatchFields.join(', ')}`,
                    };
                }
            }
            // No strong identifiers found in document - UNVERIFIABLE
            // Use DocumentRejectionService to determine rejection code
            if (documentCategory) {
                const rejectionContext = {
                    documentCategory,
                    extractedIdentity,
                    candidateData: {
                        name: candidate.name,
                    },
                    aiConfidence,
                    ocrConfidence,
                    expiryDate,
                    errorStage,
                };
                const rejectionResult = documentRejectionService_1.DocumentRejectionService.determineRejectionCode(rejectionContext);
                return {
                    matched: false,
                    matched_on: [],
                    confidence: 0.0,
                    reason_code: documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND,
                    candidate_fields: {
                        name: candidate.name,
                    },
                    notes: 'No strong identity fields (CNIC, passport, email, phone) found in document',
                    // Detailed rejection information
                    rejection_code: rejectionResult.code,
                    rejection_reason: rejectionResult.reason,
                    retry_possible: rejectionResult.retryPossible,
                    is_overridable: rejectionResult.isOverridable,
                    required_role: rejectionResult.requiredRole,
                };
            }
            else {
                // Fallback if documentCategory not provided
                return {
                    matched: false,
                    matched_on: [],
                    confidence: 0.0,
                    reason_code: documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND,
                    candidate_fields: {
                        name: candidate.name,
                    },
                    notes: 'No strong identity fields (CNIC, passport, email, phone) found in document',
                };
            }
        }
        catch (error) {
            console.error('[IdentityMatchingService] Error matching identity:', error);
            throw new Error(`Identity matching failed: ${error.message}`);
        }
    }
    /**
     * Fuzzy name matching with normalization
     * Returns true if names are similar (handles case, spacing, and common variations)
     * Handles cases like "Muhammad Farhan" matching "FARHAN" or "Farhan"
     */
    fuzzyNameMatch(name1, name2) {
        if (!name1 || !name2)
            return false;
        // Normalize: lowercase, remove extra spaces, remove punctuation
        const normalize = (str) => str.toLowerCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const n1 = normalize(name1);
        const n2 = normalize(name2);
        // Exact match
        if (n1 === n2)
            return true;
        // Split into words
        const words1 = n1.split(' ').filter(w => w.length > 0);
        const words2 = n2.split(' ').filter(w => w.length > 0);
        // Remove common prefixes/titles that don't help with matching
        const commonPrefixes = ['muhammad', 'mohammad', 'mohammed', 'muh', 'md', 'mr', 'mrs', 'miss', 'dr', 'prof'];
        const cleanWords = (words) => words.filter(w => !commonPrefixes.includes(w));
        const clean1 = cleanWords(words1);
        const clean2 = cleanWords(words2);
        // If after cleaning, one name is empty, use original
        const final1 = clean1.length > 0 ? clean1 : words1;
        const final2 = clean2.length > 0 ? clean2 : words2;
        // Check if all words from shorter name are in longer name
        const shorter = final1.length <= final2.length ? final1 : final2;
        const longer = final1.length > final2.length ? final1 : final2;
        // If shorter name has only one word, check if it matches any word in longer name
        if (shorter.length === 1) {
            const shortWord = shorter[0];
            return longer.some(w => w === shortWord || w.includes(shortWord) || shortWord.includes(w));
        }
        // For multiple words, check if all words from shorter name are in longer name
        const allWordsMatch = shorter.every(word => longer.some(w => w === word || w.includes(word) || word.includes(w)));
        return allWordsMatch;
    }
    /**
     * Check if extracted CNIC or passport belongs to a different candidate
     * Used for duplicate detection during upload
     */
    async checkForDuplicateIdentity(extractedIdentity, excludeCandidateId) {
        const db = (0, database_1.supabaseAdminClient)();
        // Check CNIC
        if (extractedIdentity.cnic) {
            const normalizedCnic = (0, candidateService_1.normalizeCNIC)(extractedIdentity.cnic);
            if (normalizedCnic) {
                let query = db
                    .from('candidates')
                    .select('id, name')
                    .eq('cnic_normalized', normalizedCnic)
                    .neq('status', 'Deleted'); // Exclude deleted candidates
                if (excludeCandidateId) {
                    query = query.neq('id', excludeCandidateId);
                }
                const { data: existingCandidate } = await query.maybeSingle();
                if (existingCandidate) {
                    return {
                        isDuplicate: true,
                        existingCandidateId: existingCandidate.id,
                        existingCandidateName: existingCandidate.name,
                        duplicateField: 'cnic',
                    };
                }
            }
        }
        // Check Passport
        if (extractedIdentity.passport_no) {
            const normalizedPassport = (0, candidateService_1.normalizePassport)(extractedIdentity.passport_no);
            if (normalizedPassport) {
                let query = db
                    .from('candidates')
                    .select('id, name')
                    .eq('passport_normalized', normalizedPassport)
                    .neq('status', 'Deleted'); // Exclude deleted candidates
                if (excludeCandidateId) {
                    query = query.neq('id', excludeCandidateId);
                }
                const { data: existingCandidate } = await query.maybeSingle();
                if (existingCandidate) {
                    return {
                        isDuplicate: true,
                        existingCandidateId: existingCandidate.id,
                        existingCandidateName: existingCandidate.name,
                        duplicateField: 'passport',
                    };
                }
            }
        }
        return { isDuplicate: false };
    }
}
exports.IdentityMatchingService = IdentityMatchingService;
// Export singleton instance
exports.identityMatchingService = new IdentityMatchingService();
