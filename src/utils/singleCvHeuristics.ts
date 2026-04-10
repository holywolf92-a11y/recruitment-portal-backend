const CV_FILENAME_HINTS = [
  /\bcv\b/i,
  /resume/i,
  /curriculum\s+vitae/i,
  /bio\s*data/i,
];

const BUNDLE_FILENAME_HINTS = [
  /passport/i,
  /cnic/i,
  /national[_\s-]?id/i,
  /driving[_\s-]?licen[cs]e/i,
  /medical/i,
  /police/i,
  /pcc/i,
  /certificate/i,
  /degree/i,
  /diploma/i,
  /transcript/i,
  /contract/i,
  /visa/i,
  /photo/i,
  /document/i,
  /documents/i,
  /docs/i,
  /attachment/i,
  /attachments/i,
];

function hasMeaningfulText(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return !['unknown', 'n/a', 'na', 'none', 'null', 'undefined', 'not provided', 'missing'].includes(lower);
}

export function shouldSkipSplitAndCategorizeForSingleCvUpload(args: {
  fileName: string;
  attachmentKind?: string | null;
  parsedCandidate?: Record<string, any> | null;
}): boolean {
  const attachmentKind = (args.attachmentKind || '').trim().toLowerCase();
  if (attachmentKind && attachmentKind !== 'cv') {
    return false;
  }

  const normalizedFileName = String(args.fileName || '').toLowerCase();
  if (!normalizedFileName.endsWith('.pdf')) {
    return false;
  }

  if (BUNDLE_FILENAME_HINTS.some((pattern) => pattern.test(normalizedFileName))) {
    return false;
  }

  const parsedCandidate = args.parsedCandidate || {};
  const cvSignalCount = [
    Array.isArray(parsedCandidate.experience) && parsedCandidate.experience.length > 0,
    Array.isArray(parsedCandidate.education) && parsedCandidate.education.length > 0,
    Array.isArray(parsedCandidate.skills) && parsedCandidate.skills.length > 0,
    Array.isArray(parsedCandidate.languages) && parsedCandidate.languages.length > 0,
    Array.isArray(parsedCandidate.certifications) && parsedCandidate.certifications.length > 0,
    Array.isArray(parsedCandidate.internships) && parsedCandidate.internships.length > 0,
    hasMeaningfulText(parsedCandidate.position),
    hasMeaningfulText(parsedCandidate.professional_summary),
    hasMeaningfulText(parsedCandidate.summary),
    hasMeaningfulText(parsedCandidate.previous_employment),
    typeof parsedCandidate.experience_years === 'number' && parsedCandidate.experience_years > 0,
  ].filter(Boolean).length;

  const fileNameLooksLikeCv = CV_FILENAME_HINTS.some((pattern) => pattern.test(normalizedFileName));

  if (fileNameLooksLikeCv) {
    return cvSignalCount >= 1;
  }

  return cvSignalCount >= 3;
}