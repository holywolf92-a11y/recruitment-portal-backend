"use strict";
/**
 * Similarity matching utilities
 * Used for determining how similar two strings are (e.g., CNIC/passport numbers with OCR errors)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.levenshteinDistance = levenshteinDistance;
exports.calculateSimilarity = calculateSimilarity;
exports.classifyMismatchSeverity = classifyMismatchSeverity;
exports.analyzeIdMismatch = analyzeIdMismatch;
/**
 * Calculate Levenshtein distance between two strings
 * Measures the minimum edit distance (insertions, deletions, substitutions)
 *
 * @param str1 First string
 * @param str2 Second string
 * @returns Levenshtein distance (0 = identical, higher = more different)
 */
function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const dp = [];
    for (let i = 0; i <= len1; i++) {
        dp[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
        dp[0][j] = j;
    }
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            }
            else {
                dp[i][j] = Math.min(dp[i - 1][j] + 1, // deletion
                dp[i][j - 1] + 1, // insertion
                dp[i - 1][j - 1] + 1 // substitution
                );
            }
        }
    }
    return dp[len1][len2];
}
/**
 * Calculate similarity percentage between two strings
 * 100% = identical, 0% = completely different
 *
 * @param str1 First string
 * @param str2 Second string
 * @returns Similarity percentage (0-100)
 */
function calculateSimilarity(str1, str2) {
    // Handle empty strings
    if (!str1 || !str2) {
        return str1 === str2 ? 100 : 0;
    }
    const distance = levenshteinDistance(str1, str2);
    const maxLen = Math.max(str1.length, str2.length);
    const similarity = ((maxLen - distance) / maxLen) * 100;
    return Math.round(similarity * 100) / 100; // Round to 2 decimal places
}
/**
 * Classify mismatch severity based on similarity
 *
 * @param similarity Similarity percentage (0-100)
 * @returns Severity level: 'critical' | 'major' | 'minor'
 */
function classifyMismatchSeverity(similarity) {
    if (similarity >= 80) {
        return 'minor'; // Likely OCR error (1-2 digits different)
    }
    else if (similarity >= 50) {
        return 'major'; // Significant difference, but partial match
    }
    else {
        return 'critical'; // Completely different, likely wrong document
    }
}
/**
 * Check if an ID number is potentially from a different person
 * Used for CNIC/passport validation
 *
 * @param extractedValue Extracted value from document
 * @param candidateValue Candidate's stored value
 * @returns Object with similarity and severity
 */
function analyzeIdMismatch(extractedValue, candidateValue) {
    const similarity = calculateSimilarity(extractedValue, candidateValue);
    const severity = classifyMismatchSeverity(similarity);
    let description = '';
    if (severity === 'minor') {
        description = `Extracted value very similar (${similarity}% match) - likely OCR/scanning error`;
    }
    else if (severity === 'major') {
        description = `Extracted value partially matches (${similarity}% match) - possible OCR error or wrong document`;
    }
    else {
        description = `Extracted value completely different (${similarity}% match) - likely wrong document`;
    }
    return { similarity, severity, description };
}
