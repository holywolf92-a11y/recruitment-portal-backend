import { createLogger } from '../utils/errorHandling';

const logger = createLogger('DocumentClassifier');

export type AttachmentKind = 'cv' | 'document' | 'unknown';
export type DocumentType = 'passport' | 'cnic' | 'degree' | 'medical' | 'visa' | 'certificate' | 'unknown' | 'other';

interface ClassificationResult {
  attachmentKind: AttachmentKind;
  documentType: DocumentType | null;
  confidence: number;
}

/**
 * Classifies attachments as CV, supporting document, or unknown
 */
export class DocumentClassifier {
  
  /**
   * Classify an attachment based on filename, subject, and content hints
   */
  static classify(fileName: string, subject?: string, mimeType?: string): ClassificationResult {
    const normalizedFileName = fileName.toLowerCase();
    const normalizedSubject = (subject || '').toLowerCase();
    const combinedText = `${normalizedFileName} ${normalizedSubject}`;

    // Check if it's a CV
    if (this.isCv(combinedText)) {
      return {
        attachmentKind: 'cv',
        documentType: null,
        confidence: 0.9
      };
    }

    // Check specific document types
    const docType = this.identifyDocumentType(combinedText);
    if (docType !== 'unknown') {
      return {
        attachmentKind: 'document',
        documentType: docType,
        confidence: 0.85
      };
    }

    // Unknown - could be either
    logger.info(`Unknown attachment type: ${fileName}`);
    return {
      attachmentKind: 'unknown',
      documentType: 'unknown',
      confidence: 0.3
    };
  }

  /**
   * Check if attachment is a CV/Resume
   */
  private static isCv(text: string): boolean {
    const cvKeywords = [
      'cv', 'resume', 'résumé', 'curriculum vitae',
      'bio data', 'biodata', 'profile'
    ];
    
    return cvKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Identify specific document type
   */
  private static identifyDocumentType(text: string): DocumentType {
    // CNIC/ID keywords
    if (text.match(/\b(cnic|nic|id[\s\-_]?card|national[\s\-_]?id|identity[\s\-_]?card)\b/i)) {
      return 'cnic';
    }

    // Passport keywords
    if (text.match(/\b(passport|travel[\s\-_]?doc)\b/i)) {
      return 'passport';
    }

    // Degree/Education keywords
    if (text.match(/\b(degree|diploma|transcript|certificate|graduation|bachelor|master|phd|education)\b/i)) {
      return 'degree';
    }

    // Medical keywords
    if (text.match(/\b(medical|health|fitness|examination|chest[\s\-_]?xray|blood[\s\-_]?test)\b/i)) {
      return 'medical';
    }

    // Visa keywords
    if (text.match(/\b(visa|work[\s\-_]?permit|residence[\s\-_]?permit)\b/i)) {
      return 'visa';
    }

    // Generic certificate
    if (text.match(/\b(certificate|certification|certified)\b/i)) {
      return 'certificate';
    }

    return 'unknown';
  }

  /**
   * Extract potential metadata from filename for matching
   */
  static extractMetadataFromFilename(fileName: string): {
    name?: string;
    cnic?: string;
    phone?: string;
  } {
    const metadata: any = {};

    // Try to extract CNIC (13 digits, may have dashes)
    const cnicMatch = fileName.match(/\b(\d{5}[\-\s]?\d{7}[\-\s]?\d)\b/);
    if (cnicMatch) {
      metadata.cnic = cnicMatch[1].replace(/[\-\s]/g, '');
    }

    // Try to extract phone (Pakistani format)
    const phoneMatch = fileName.match(/\b(03\d{9}|\+92\d{10})\b/);
    if (phoneMatch) {
      metadata.phone = phoneMatch[1];
    }

    // Try to extract name (before common separators or document type keywords)
    const nameMatch = fileName.match(/^([a-z\s]+?)[\-_\d]/i);
    if (nameMatch) {
      metadata.name = nameMatch[1].trim();
    }

    return metadata;
  }

  /**
   * Generate storage path for matched document
   */
  static generateStoragePath(
    candidateId: string, 
    documentType: DocumentType, 
    fileName: string
  ): string {
    // Include a full timestamp to avoid overwriting same-day same-name uploads.
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    return `candidates/${candidateId}/documents/${documentType}/${ts}_${sanitizedFileName}`;
  }

  /**
   * Generate storage path for unmatched document
   */
  static generateUnmatchedPath(
    source: string,
    messageId: string,
    fileName: string
  ): string {
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    return `unmatched_documents/${source}/${messageId}/${sanitizedFileName}`;
  }
}
