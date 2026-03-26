import { createLogger } from '../utils/errorHandling';

const logger = createLogger('DocumentClassifier');

export type AttachmentKind = 'cv' | 'document' | 'unknown';
export type DocumentType = 'passport' | 'cnic' | 'degree' | 'medical' | 'visa' | 'certificate' | 'unknown' | 'other';

interface ClassificationResult {
  attachmentKind: AttachmentKind;
  documentType: DocumentType | null;
  confidence: number;
}

const CV_SECTION_KEYWORDS = [
  'experience',
  'work experience',
  'employment',
  'work history',
  'education',
  'qualification',
  'skills',
  'technical skills',
  'professional summary',
  'summary',
  'objective',
  'career objective',
  'references',
  'languages',
  'certifications',
  'projects',
  'internship',
];

/**
 * Classifies attachments as CV, supporting document, or unknown
 */
export class DocumentClassifier {
  
  /**
   * Classify an attachment based on filename, subject, and content hints
   */
  static classify(fileName: string, subject?: string, mimeType?: string, fileBuffer?: Buffer): ClassificationResult {
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

    if (fileBuffer && this.isLikelyCvFromContent(fileBuffer, mimeType, fileName)) {
      logger.info(`Detected CV from cheap content heuristic: ${fileName}`);
      return {
        attachmentKind: 'cv',
        documentType: null,
        confidence: 0.7,
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

  private static isLikelyCvFromContent(fileBuffer: Buffer, mimeType?: string, fileName?: string): boolean {
    const text = this.extractCheapTextSnippet(fileBuffer, mimeType, fileName);
    if (!text) return false;

    const normalized = text.toLowerCase();
    const sectionHits = CV_SECTION_KEYWORDS.filter((keyword) => normalized.includes(keyword)).length;
    const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(normalized);
    const hasPhone = /(?:\+?\d[\d\s\-()]{7,}\d)/.test(text);
    const hasYearDensity = (normalized.match(/\b(?:19|20)\d{2}\b/g) || []).length >= 2;
    const hasProfessionalTerms = /(engineer|manager|supervisor|technician|driver|operator|accountant|sales|teacher|developer|designer|assistant)/i.test(normalized);

    let score = 0;
    if (sectionHits >= 2) score += 2;
    else if (sectionHits === 1) score += 1;
    if (hasEmail) score += 1;
    if (hasPhone) score += 1;
    if (hasYearDensity) score += 1;
    if (hasProfessionalTerms) score += 1;

    return score >= 3 && (sectionHits >= 1 || (hasEmail && hasPhone));
  }

  private static extractCheapTextSnippet(fileBuffer: Buffer, mimeType?: string, fileName?: string): string {
    const lowerMime = String(mimeType || '').toLowerCase();
    const lowerName = String(fileName || '').toLowerCase();

    if (lowerMime.startsWith('image/')) return '';
    if (lowerMime.startsWith('video/') || lowerMime.startsWith('audio/')) return '';

    if (lowerMime.startsWith('text/') || lowerName.endsWith('.txt')) {
      return this.normalizeText(fileBuffer.toString('utf8').slice(0, 12000));
    }

    if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) {
      return this.extractPdfTextSnippet(fileBuffer);
    }

    const utf8Text = this.normalizeText(fileBuffer.toString('utf8', 0, Math.min(fileBuffer.length, 12000)));
    if (utf8Text.length >= 80) return utf8Text;

    return '';
  }

  private static extractPdfTextSnippet(fileBuffer: Buffer): string {
    const raw = fileBuffer.toString('latin1', 0, Math.min(fileBuffer.length, 220000));
    const textChunks: string[] = [];
    const textMatches = raw.match(/\(([^\)]{2,200})\)/g) || [];

    for (const match of textMatches.slice(0, 400)) {
      const cleaned = match
        .slice(1, -1)
        .replace(/\\[rnftb]/g, ' ')
        .replace(/\\\d{1,3}/g, ' ')
        .replace(/\\\(|\\\)|\\\\/g, ' ');
      if (/[a-zA-Z]{3,}/.test(cleaned)) {
        textChunks.push(cleaned);
      }
    }

    if (textChunks.length > 0) {
      return this.normalizeText(textChunks.join(' ').slice(0, 12000));
    }

    const fallback = raw.replace(/[^\x20-\x7E\n]/g, ' ');
    return this.normalizeText(fallback.slice(0, 12000));
  }

  private static normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
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
