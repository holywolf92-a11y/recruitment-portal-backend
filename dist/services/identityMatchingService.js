"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityMatchingService = exports.IdentityMatchingService = void 0;
const database_1 = require("../config/database");
const candidateService_1 = require("./candidateService");
const documentCategories_1 = require("../config/documentCategories");
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
     */
    async matchIdentity(candidateId, extractedIdentity) {
        try {
            // Fetch candidate record
            const db = (0, database_1.supabaseAdminClient)();
            const { data: candidate, error } = await db
                .from('candidates')
                .select('id, name, father_name, cnic, cnic_normalized, passport, passport_normalized, email, phone, phone_normalized')
                .eq('id', candidateId)
                .single();
            if (error || !candidate) {
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
                        reason_code: documentCategories_1.VERIFICATION_REASON_CODES.VERIFIED,
                        candidate_fields: {
                            name: candidate.name,
                            cnic: candidate.cnic,
                            passport_no: candidate.passport,
                            email: candidate.email,
                            phone: candidate.phone,
                        },
                    };
                }
                else if (candidate.cnic_normalized && extractedCnic !== candidate.cnic_normalized) {
                    // CNIC exists but doesn't match - Check if it belongs to someone else
                    const { data: otherCandidate } = await db
                        .from('candidates')
                        .select('id, name, cnic')
                        .eq('cnic_normalized', extractedCnic)
                        .neq('id', candidateId)
                        .maybeSingle();
                    if (otherCandidate) {
                        // CNIC belongs to a different person - REJECTED
                        mismatchFields.push('cnic');
                        return {
                            matched: false,
                            matched_on: [],
                            confidence: 0.0,
                            reason_code: documentCategories_1.VERIFICATION_REASON_CODES.CNIC_MISMATCH,
                            mismatch_fields: mismatchFields,
                            candidate_fields: {
                                name: candidate.name,
                                cnic: candidate.cnic,
                            },
                            notes: `CNIC belongs to different candidate: ${otherCandidate.name} (ID: ${otherCandidate.id})`,
                        };
                    }
                    else {
                        // CNIC doesn't match, but not found in system - mark as mismatch
                        mismatchFields.push('cnic');
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
                        reason_code: documentCategories_1.VERIFICATION_REASON_CODES.VERIFIED,
                        candidate_fields: {
                            name: candidate.name,
                            passport_no: candidate.passport,
                            email: candidate.email,
                            phone: candidate.phone,
                        },
                    };
                }
                else if (candidate.passport_normalized && extractedPassport !== candidate.passport_normalized) {
                    // Passport exists but doesn't match - Check if it belongs to someone else
                    const { data: otherCandidate } = await db
                        .from('candidates')
                        .select('id, name, passport')
                        .eq('passport_normalized', extractedPassport)
                        .neq('id', candidateId)
                        .maybeSingle();
                    if (otherCandidate) {
                        // Passport belongs to a different person - REJECTED
                        mismatchFields.push('passport');
                        return {
                            matched: false,
                            matched_on: [],
                            confidence: 0.0,
                            reason_code: documentCategories_1.VERIFICATION_REASON_CODES.PASSPORT_MISMATCH,
                            mismatch_fields: mismatchFields,
                            candidate_fields: {
                                name: candidate.name,
                                passport_no: candidate.passport,
                            },
                            notes: `Passport belongs to different candidate: ${otherCandidate.name} (ID: ${otherCandidate.id})`,
                        };
                    }
                    else {
                        // Passport doesn't match, but not found in system
                        mismatchFields.push('passport');
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
                        reason_code: documentCategories_1.VERIFICATION_REASON_CODES.VERIFIED,
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
                const phoneMatch = candidate.phone_normalized && extractedPhone === candidate.phone_normalized;
                const nameMatch = this.fuzzyNameMatch(extractedIdentity.name, candidate.name);
                if (phoneMatch && nameMatch) {
                    matchedOn.push('phone', 'name');
                    return {
                        matched: true,
                        matched_on: matchedOn,
                        confidence: 0.75,
                        reason_code: documentCategories_1.VERIFICATION_REASON_CODES.VERIFIED,
                        candidate_fields: {
                            name: candidate.name,
                            phone: candidate.phone,
                        },
                    };
                }
                if (phoneMatch && !nameMatch) {
                    mismatchFields.push('name');
                }
                if (!phoneMatch && candidate.phone_normalized) {
                    mismatchFields.push('phone');
                }
            }
            // Decision: Were there mismatches found?
            if (mismatchFields.length > 0) {
                // We found fields that don't match
                return {
                    matched: false,
                    matched_on: [],
                    confidence: 0.0,
                    reason_code: documentCategories_1.VERIFICATION_REASON_CODES.IDENTITY_MISMATCH,
                    mismatch_fields: mismatchFields,
                    candidate_fields: {
                        name: candidate.name,
                        cnic: candidate.cnic,
                        passport_no: candidate.passport,
                        email: candidate.email,
                        phone: candidate.phone,
                    },
                    notes: `Fields do not match: ${mismatchFields.join(', ')}`,
                };
            }
            // No strong identifiers found in document - UNVERIFIABLE
            return {
                matched: false,
                matched_on: [],
                confidence: 0.0,
                reason_code: documentCategories_1.VERIFICATION_REASON_CODES.NO_ID_FOUND,
                candidate_fields: {
                    name: candidate.name,
                },
                notes: 'No strong identity fields (CNIC, passport, email) found in document',
            };
        }
        catch (error) {
            console.error('[IdentityMatchingService] Error matching identity:', error);
            throw new Error(`Identity matching failed: ${error.message}`);
        }
    }
    /**
     * Fuzzy name matching with normalization
     * Returns true if names are similar (handles case, spacing, and common variations)
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
        const words1 = n1.split(' ');
        const words2 = n2.split(' ');
        // Check if all words from shorter name are in longer name
        const shorter = words1.length <= words2.length ? words1 : words2;
        const longer = words1.length > words2.length ? words1 : words2;
        const allWordsMatch = shorter.every(word => longer.some(w => w.includes(word) || word.includes(w)));
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
                    .select('id, name, cnic')
                    .eq('cnic_normalized', normalizedCnic);
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
                    .select('id, name, passport')
                    .eq('passport_normalized', normalizedPassport);
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
