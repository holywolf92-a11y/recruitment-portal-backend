"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CandidateMatcher = void 0;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('CandidateMatcher');
/**
 * Matches documents to candidates using priority: CNIC → Email → Phone → Name+Father
 */
class CandidateMatcher {
    /**
     * Find candidate using strict priority matching
     */
    static async findCandidate(criteria) {
        const db = (0, database_1.supabaseAdminClient)();
        // Priority 1: CNIC (most reliable)
        if (criteria.cnic) {
            const normalized = this.normalizeCnic(criteria.cnic);
            const { data, error } = await db
                .from('candidates')
                .select('id')
                .eq('cnic_normalized', normalized);
            if (!error && data && data.length > 0) {
                if (data.length === 1) {
                    logger.info(`Matched candidate by CNIC: ${normalized}`);
                    return {
                        candidateId: data[0].id,
                        matchedBy: 'cnic',
                        confidence: 0.99,
                        multipleMatches: false,
                        matchCount: 1,
                        needsManualReview: false
                    };
                }
                else {
                    logger.warn(`Multiple candidates found for CNIC: ${normalized}`);
                    return {
                        candidateId: null,
                        matchedBy: null,
                        confidence: 0,
                        multipleMatches: true,
                        matchCount: data.length,
                        needsManualReview: true,
                        reviewReasons: [`Multiple candidates (${data.length}) have same CNIC: ${normalized}`]
                    };
                }
            }
        }
        // Priority 2: Email
        if (criteria.email) {
            const normalized = criteria.email.toLowerCase().trim();
            const { data, error } = await db
                .from('candidates')
                .select('id')
                .ilike('email', normalized);
            if (!error && data && data.length > 0) {
                if (data.length === 1) {
                    logger.info(`Matched candidate by email: ${normalized}`);
                    return {
                        candidateId: data[0].id,
                        matchedBy: 'email',
                        confidence: 0.95,
                        multipleMatches: false,
                        matchCount: 1,
                        needsManualReview: false
                    };
                }
                else {
                    logger.warn(`Multiple candidates found for email: ${normalized}`);
                    return {
                        candidateId: null,
                        matchedBy: null,
                        confidence: 0,
                        multipleMatches: true,
                        matchCount: data.length,
                        needsManualReview: true,
                        reviewReasons: [`Multiple candidates (${data.length}) have same email: ${normalized}`]
                    };
                }
            }
        }
        // Priority 3: Phone
        if (criteria.phone) {
            const normalized = this.normalizePhone(criteria.phone);
            const { data, error } = await db
                .from('candidates')
                .select('id, phone')
                .not('phone', 'is', null);
            if (!error && data && data.length > 0) {
                // Match by normalized phone
                const matches = data.filter(c => this.normalizePhone(c.phone || '') === normalized);
                if (matches.length === 1) {
                    logger.info(`Matched candidate by phone: ${normalized}`);
                    return {
                        candidateId: matches[0].id,
                        matchedBy: 'phone',
                        confidence: 0.90,
                        multipleMatches: false,
                        matchCount: 1,
                        needsManualReview: false
                    };
                }
                else if (matches.length > 1) {
                    logger.warn(`Multiple candidates found for phone: ${normalized}`);
                    return {
                        candidateId: null,
                        matchedBy: null,
                        confidence: 0,
                        multipleMatches: true,
                        matchCount: matches.length,
                        needsManualReview: true,
                        reviewReasons: [`Multiple candidates (${matches.length}) have same phone: ${normalized}`]
                    };
                }
            }
        }
        // Priority 4: Name + Father Name (only if both provided and candidate has CV data)
        if (criteria.name && criteria.fatherName) {
            const normalizedName = this.normalizeName(criteria.name);
            const normalizedFather = this.normalizeName(criteria.fatherName);
            // Only match candidates that have father_name (i.e., have CV parsed)
            const { data, error } = await db
                .from('candidates')
                .select('id, name, father_name')
                .not('father_name', 'is', null);
            if (error) {
                const msg = error?.message || String(error);
                if (/column\s+candidates\.father_name\s+does not exist/i.test(msg)) {
                    logger.warn('Skipping name+father matching; candidates.father_name column missing', { message: msg });
                }
                else {
                    logger.warn('Name+father candidate query failed', { message: msg });
                }
                // Fall through to "no match" behavior.
            }
            if (!error && data && data.length > 0) {
                const matches = data.filter(c => {
                    const candidateName = this.normalizeName(c.name || '');
                    const candidateFather = this.normalizeName(c.father_name || '');
                    const nameSimilarity = this.calculateSimilarity(normalizedName, candidateName);
                    const fatherSimilarity = this.calculateSimilarity(normalizedFather, candidateFather);
                    // Both must have strong similarity (>= 0.92)
                    return nameSimilarity >= 0.92 && fatherSimilarity >= 0.92;
                });
                if (matches.length === 1) {
                    logger.info(`Matched candidate by name+father: ${criteria.name} / ${criteria.fatherName}`);
                    return {
                        candidateId: matches[0].id,
                        matchedBy: 'name_father',
                        confidence: 0.85,
                        multipleMatches: false,
                        matchCount: 1,
                        needsManualReview: false
                    };
                }
                else if (matches.length > 1) {
                    logger.warn(`Multiple candidates found for name+father: ${criteria.name}`);
                    return {
                        candidateId: null,
                        matchedBy: null,
                        confidence: 0,
                        multipleMatches: true,
                        matchCount: matches.length,
                        needsManualReview: true,
                        reviewReasons: [`Multiple candidates (${matches.length}) match name+father: ${criteria.name} / ${criteria.fatherName}`]
                    };
                }
            }
        }
        // Priority 5: Name-only matching (fallback when CNIC/email/phone not available)
        if (criteria.name && !criteria.cnic && !criteria.email && !criteria.phone) {
            const normalizedName = this.normalizeName(criteria.name);
            const { data, error } = await db
                .from('candidates')
                .select('id, name')
                .not('name', 'is', null);
            if (!error && data && data.length > 0) {
                const matches = data.filter(c => {
                    const candidateName = this.normalizeName(c.name || '');
                    const similarity = this.calculateSimilarity(normalizedName, candidateName);
                    // Use high similarity threshold for name-only matching (0.90)
                    return similarity >= 0.90;
                });
                if (matches.length === 1) {
                    logger.info(`Matched candidate by name only: ${criteria.name}`);
                    return {
                        candidateId: matches[0].id,
                        matchedBy: 'name',
                        confidence: 0.80,
                        multipleMatches: false,
                        matchCount: 1,
                        needsManualReview: false
                    };
                }
                else if (matches.length > 1) {
                    logger.warn(`Multiple candidates found for name: ${criteria.name}`);
                    return {
                        candidateId: null,
                        matchedBy: null,
                        confidence: 0,
                        multipleMatches: true,
                        matchCount: matches.length,
                        needsManualReview: true,
                        reviewReasons: [`Multiple candidates (${matches.length}) match name: ${criteria.name}`]
                    };
                }
            }
        }
        // No match found
        logger.info('No candidate match found', criteria);
        return {
            candidateId: null,
            matchedBy: null,
            confidence: 0,
            multipleMatches: false,
            matchCount: 0,
            needsManualReview: false
        };
    }
    /**
     * Normalize CNIC to digits only
     */
    static normalizeCnic(cnic) {
        return cnic.replace(/[^\d]/g, '');
    }
    /**
     * Normalize phone to digits only (simple v1)
     */
    static normalizePhone(phone) {
        // Remove all non-digits
        let digits = phone.replace(/[^\d]/g, '');
        // Remove leading country code if present
        if (digits.startsWith('92')) {
            digits = '0' + digits.substring(2);
        }
        return digits;
    }
    /**
     * Normalize name for comparison
     */
    static normalizeName(name) {
        return name
            .toLowerCase()
            .trim()
            .replace(/[^\w\s]/g, '') // Remove special chars
            .replace(/\s+/g, ' '); // Normalize spaces
    }
    /**
     * Calculate string similarity (Levenshtein distance based)
     */
    static calculateSimilarity(str1, str2) {
        if (str1 === str2)
            return 1.0;
        if (str1.length === 0 || str2.length === 0)
            return 0.0;
        const distance = this.levenshteinDistance(str1, str2);
        const maxLen = Math.max(str1.length, str2.length);
        return 1 - (distance / maxLen);
    }
    /**
     * Levenshtein distance algorithm
     */
    static levenshteinDistance(str1, str2) {
        const matrix = [];
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                }
                else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1, // insertion
                    matrix[i - 1][j] + 1 // deletion
                    );
                }
            }
        }
        return matrix[str2.length][str1.length];
    }
}
exports.CandidateMatcher = CandidateMatcher;
