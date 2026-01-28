"use strict";
/**
 * Document naming utility
 * Generates descriptive filenames for split documents instead of generic "split_type_timestamp.pdf"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDescriptiveFilename = generateDescriptiveFilename;
exports.generateLegacyFilename = generateLegacyFilename;
exports.extractDocInfoFromSplit = extractDocInfoFromSplit;
/**
 * Generate a descriptive filename for a split document
 *
 * Examples:
 * - CNIC Front.pdf
 * - CNIC Back.pdf
 * - Passport Main Page.pdf
 * - Passport Page 2.pdf
 * - Driving License.pdf
 * - Photo - Profile Picture.pdf
 * - Visa Page.pdf
 * - Medical Certificate.pdf
 */
function generateDescriptiveFilename(docInfo, candidateName, timestamp) {
    const docType = (docInfo.doc_type || '').toLowerCase().trim();
    const ts = timestamp || Date.now();
    const pageNumber = docInfo.page_number;
    const totalPages = docInfo.total_pages;
    // Helper to create safe filename
    const sanitize = (name) => {
        return name
            .replace(/[^a-zA-Z0-9\s\-_.()]/g, '') // Remove special chars
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim();
    };
    let descriptiveName = '';
    switch (docType) {
        // CNIC (National ID Card)
        case 'cnic':
        case 'national_id':
        case 'id_card':
            if (pageNumber === 1 || (docInfo.pages && docInfo.pages.length === 1 && docInfo.pages[0] === 1)) {
                descriptiveName = 'CNIC Front';
            }
            else if (pageNumber === 2 || (docInfo.pages && docInfo.pages.length === 1 && docInfo.pages[0] === 2)) {
                descriptiveName = 'CNIC Back';
            }
            else if (totalPages && totalPages > 1) {
                descriptiveName = `CNIC Page ${pageNumber || 1}`;
            }
            else {
                descriptiveName = 'CNIC';
            }
            break;
        // Passport
        case 'passport':
            if (pageNumber === 1 || (docInfo.pages && docInfo.pages.length === 1 && docInfo.pages[0] === 1)) {
                descriptiveName = 'Passport Main Page';
            }
            else if (pageNumber === 2) {
                descriptiveName = 'Passport Page 2';
            }
            else if (pageNumber && pageNumber > 2) {
                descriptiveName = `Passport Page ${pageNumber}`;
            }
            else if (docInfo.pages && docInfo.pages.length > 1) {
                descriptiveName = `Passport Pages ${docInfo.pages[0]}-${docInfo.pages[docInfo.pages.length - 1]}`;
            }
            else {
                descriptiveName = 'Passport';
            }
            break;
        // Driving License
        case 'driving_license':
        case 'drivers_license':
        case 'driver_license':
            if (pageNumber === 1 || (docInfo.pages && docInfo.pages.length === 1 && docInfo.pages[0] === 1)) {
                descriptiveName = 'Driving License Front';
            }
            else if (pageNumber === 2) {
                descriptiveName = 'Driving License Back';
            }
            else {
                descriptiveName = 'Driving License';
            }
            break;
        // Photos
        case 'photo':
        case 'photos':
        case 'profile_photo':
            if (pageNumber && pageNumber > 1) {
                descriptiveName = `Photo ${pageNumber}`;
            }
            else {
                descriptiveName = 'Profile Photo';
            }
            break;
        // Visa
        case 'visa':
            if (pageNumber && pageNumber > 1) {
                descriptiveName = `Visa Page ${pageNumber}`;
            }
            else {
                descriptiveName = 'Visa Document';
            }
            break;
        // Medical
        case 'medical':
        case 'medical_report':
        case 'medical_reports':
        case 'medical_certificate':
            if (pageNumber && pageNumber > 1) {
                descriptiveName = `Medical Certificate Page ${pageNumber}`;
            }
            else {
                descriptiveName = 'Medical Certificate';
            }
            break;
        // Certificates / Degrees
        case 'certificate':
        case 'certificates':
        case 'degree':
        case 'diploma':
        case 'transcript':
            if (pageNumber && pageNumber > 1) {
                descriptiveName = `Certificate Page ${pageNumber}`;
            }
            else {
                descriptiveName = 'Certificate';
            }
            break;
        // Police Character Certificate
        case 'police_character_certificate':
        case 'police_clearance':
        case 'pcc':
            if (pageNumber && pageNumber > 1) {
                descriptiveName = `Police Clearance Page ${pageNumber}`;
            }
            else {
                descriptiveName = 'Police Character Certificate';
            }
            break;
        // CV / Resume
        case 'cv':
        case 'cv_resume':
        case 'resume':
            if (pageNumber && pageNumber > 1) {
                descriptiveName = `CV Page ${pageNumber}`;
            }
            else {
                descriptiveName = 'CV';
            }
            break;
        // Contract
        case 'contract':
        case 'contracts':
        case 'employment_contract':
            if (pageNumber && pageNumber > 1) {
                descriptiveName = `Contract Page ${pageNumber}`;
            }
            else {
                descriptiveName = 'Employment Contract';
            }
            break;
        // Default fallback
        default:
            const formatted = docType
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
            descriptiveName = formatted || 'Document';
            if (pageNumber && pageNumber > 1) {
                descriptiveName += ` Page ${pageNumber}`;
            }
    }
    // Add candidate name prefix if provided
    if (candidateName) {
        const safeName = sanitize(candidateName);
        descriptiveName = `${safeName} - ${descriptiveName}`;
    }
    // Sanitize and add extension
    const safeFilename = sanitize(descriptiveName);
    // Add timestamp to ensure uniqueness (but at the end, more subtle)
    const shortTs = ts.toString().slice(-8); // Last 8 digits
    return `${safeFilename} [${shortTs}].pdf`;
}
/**
 * Legacy function for backward compatibility
 * Generates the old split_type_timestamp.pdf format
 */
function generateLegacyFilename(docType, timestamp) {
    const ts = timestamp || Date.now();
    return `split_${docType}_${ts}.pdf`;
}
/**
 * Extract document info from a split document for better naming
 */
function extractDocInfoFromSplit(splitDoc) {
    return {
        doc_type: splitDoc.doc_type || splitDoc.category || 'document',
        pages: splitDoc.pages,
        split_strategy: splitDoc.split_strategy,
        page_number: splitDoc.page_number,
        total_pages: splitDoc.total_pages,
    };
}
