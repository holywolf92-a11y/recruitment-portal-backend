"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CandidateMatcher = void 0;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('CandidateMatcher');
/**
 * Matches documents to candidates using priority: CNIC → Passport → Email → Phone → Name+DOB → Name+Father → Name
 */
class CandidateMatcher {
    static normalizePassport(passport) {
        if (!passport)
            return null;
        return passport.trim().toUpperCase();
    }
    static parseDateToISO(dateStr) {
        if (!dateStr || typeof dateStr !== 'string')
            return null;
        const trimmed = dateStr.trim();
        if (!trimmed)
            return null;
        // ISO format first
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            const d = new Date(trimmed);
            return isNaN(d.getTime()) ? null : trimmed;
        }
        // DD/MM/YYYY or DD-MM-YYYY
        const ddmmyyyy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (ddmmyyyy) {
            const [, day, month, year] = ddmmyyyy;
            const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            const d = new Date(iso);
            return isNaN(d.getTime()) ? null : iso;
        }
        // YYYY/MM/DD or YYYY-MM-DD already handled
        const yyyymmdd = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
        if (yyyymmdd) {
            const [, year, month, day] = yyyymmdd;
            const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            const d = new Date(iso);
            return isNaN(d.getTime()) ? null : iso;
        }
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
        return null;
    }
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
                .eq('cnic_normalized', normalized)
                .neq('status', 'Deleted'); // Exclude deleted candidates
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
        // Priority 2: Passport
        if (criteria.passport) {
            const normalized = this.normalizePassport(criteria.passport);
            if (normalized) {
                const { data, error } = await db
                    .from('candidates')
                    .select('id')
                    .eq('passport_normalized', normalized)
                    .neq('status', 'Deleted');
                if (!error && data && data.length > 0) {
                    if (data.length === 1) {
                        logger.info(`Matched candidate by passport: ${normalized}`);
                        return {
                            candidateId: data[0].id,
                            matchedBy: 'passport',
                            confidence: 0.98,
                            multipleMatches: false,
                            matchCount: 1,
                            needsManualReview: false,
                        };
                    }
                    else {
                        logger.warn(`Multiple candidates found for passport: ${normalized}`);
                        return {
                            candidateId: null,
                            matchedBy: null,
                            confidence: 0,
                            multipleMatches: true,
                            matchCount: data.length,
                            needsManualReview: true,
                            reviewReasons: [`Multiple candidates (${data.length}) have same passport: ${normalized}`],
                        };
                    }
                }
            }
        }
        // Priority 3: Email (skip government/police department emails)
        if (criteria.email && !this.isGovernmentEmail(criteria.email)) {
            const normalized = criteria.email.toLowerCase().trim();
            const { data, error } = await db
                .from('candidates')
                .select('id')
                .ilike('email', normalized)
                .neq('status', 'Deleted'); // Exclude deleted candidates
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
        else if (criteria.email && this.isGovernmentEmail(criteria.email)) {
            logger.info(`Skipped email matching for government email: ${criteria.email}`);
        }
        // Priority 4: Phone
        if (criteria.phone) {
            const normalized = this.normalizePhone(criteria.phone);
            const { data, error } = await db
                .from('candidates')
                .select('id, phone')
                .not('phone', 'is', null)
                .neq('status', 'Deleted'); // Exclude deleted candidates
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
        // Priority 5: Name + DOB
        if (criteria.name && criteria.dateOfBirth) {
            const normalizedName = this.normalizeName(criteria.name);
            const dobISO = this.parseDateToISO(criteria.dateOfBirth);
            if (dobISO) {
                const { data, error } = await db
                    .from('candidates')
                    .select('id, name, date_of_birth')
                    .not('date_of_birth', 'is', null)
                    .neq('status', 'Deleted');
                if (!error && data && data.length > 0) {
                    const matches = data.filter((c) => {
                        const candidateName = this.normalizeName(c.name || '');
                        const candidateDob = this.parseDateToISO(String(c.date_of_birth || ''));
                        if (!candidateDob)
                            return false;
                        const nameSimilarity = this.calculateSimilarity(normalizedName, candidateName);
                        return nameSimilarity >= 0.90 && candidateDob === dobISO;
                    });
                    if (matches.length === 1) {
                        logger.info(`Matched candidate by name+DOB: ${criteria.name} / ${dobISO}`);
                        return {
                            candidateId: matches[0].id,
                            matchedBy: 'name_dob',
                            confidence: 0.86,
                            multipleMatches: false,
                            matchCount: 1,
                            needsManualReview: false,
                        };
                    }
                    else if (matches.length > 1) {
                        logger.warn(`Multiple candidates found for name+DOB: ${criteria.name} / ${dobISO}`);
                        return {
                            candidateId: null,
                            matchedBy: null,
                            confidence: 0,
                            multipleMatches: true,
                            matchCount: matches.length,
                            needsManualReview: true,
                            reviewReasons: [`Multiple candidates (${matches.length}) match name+DOB: ${criteria.name} / ${dobISO}`],
                        };
                    }
                }
            }
        }
        // Priority 6: Name + Father Name (only if both provided and candidate has CV data)
        if (criteria.name && criteria.fatherName) {
            const normalizedName = this.normalizeName(criteria.name);
            const normalizedFather = this.normalizeName(criteria.fatherName);
            // Only match candidates that have father_name (i.e., have CV parsed)
            const { data, error } = await db
                .from('candidates')
                .select('id, name, father_name')
                .not('father_name', 'is', null)
                .neq('status', 'Deleted'); // Exclude deleted candidates
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
        // Priority 7: Name-only matching (fallback when CNIC/passport/email/phone don't match or not available)
        // Try name matching if we have a name - this is a fallback when other methods didn't find a match
        if (criteria.name) {
            const normalizedName = this.normalizeName(criteria.name);
            const { data, error } = await db
                .from('candidates')
                .select('id, name')
                .not('name', 'is', null)
                .neq('status', 'Deleted'); // Exclude deleted candidates
            if (!error && data && data.length > 0) {
                const matches = data.filter(c => {
                    const candidateName = this.normalizeName(c.name || '');
                    const similarity = this.calculateSimilarity(normalizedName, candidateName);
                    // Use slightly lower threshold (0.85) for better matching when CNIC/email/phone don't match
                    return similarity >= 0.85;
                });
                if (matches.length === 1) {
                    const actualSimilarity = this.calculateSimilarity(normalizedName, this.normalizeName(matches[0].name || ''));
                    logger.info(`Matched candidate by name only: "${criteria.name}" -> "${matches[0].name}" (similarity: ${actualSimilarity.toFixed(3)})`);
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
                    logger.warn(`Multiple candidates found for name: "${criteria.name}" (${matches.length} matches)`);
                    // If multiple matches, return the first one but flag for review
                    return {
                        candidateId: matches[0].id,
                        matchedBy: 'name',
                        confidence: 0.75,
                        multipleMatches: true,
                        matchCount: matches.length,
                        needsManualReview: true,
                        reviewReasons: [`Multiple candidates (${matches.length}) match name: ${criteria.name}`]
                    };
                }
                else {
                    logger.info(`No name matches found for: "${criteria.name}" (checked ${data.length} candidates)`);
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
    /**
     * Check if email is from a government/police department (should not be used for matching)
     */
    static isGovernmentEmail(email) {
        if (!email)
            return false;
        const normalized = email.toLowerCase().trim();
        // List of government/police email patterns that should not be used for candidate matching
        const governmentPatterns = [
            'police@',
            'police.gov',
            '@police.',
            'govt@',
            '@gov.',
            '@government.',
            'department@',
            'ministry@',
            'municipal@',
            'city@',
            'district@',
            'admin@',
            'info@',
            'contact@',
            'support@',
            'noreply@',
            'donotreply@'
        ];
        return governmentPatterns.some(pattern => normalized.includes(pattern));
    }
}
exports.CandidateMatcher = CandidateMatcher;
