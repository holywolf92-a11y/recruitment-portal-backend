// Shared normalization for parser output written onto `candidates` rows.
//
// The Python parser returns list fields (skills, languages, certifications,
// internships) as arrays and `education` as an array of {degree, institution}
// objects, and uses placeholders such as null / "missing" for fields it could
// not find. Candidate columns are text/VARCHAR, so arrays must be flattened to
// the same strings the create path (cvParserWorker) stores — otherwise
// PostgREST serializes them as JSON text, which overflows VARCHAR(255)
// (Postgres 22001) — and placeholders must never overwrite real data.

const PLACEHOLDER_STRINGS = new Set(['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided']);

/** True for values that carry no information: null/undefined, blank or placeholder strings, empty arrays/objects. */
export function isEmptyOrPlaceholderValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '' || PLACEHOLDER_STRINGS.has(normalized);
  }
  if (Array.isArray(value)) return value.every(isEmptyOrPlaceholderValue);
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function listItemToString(item: unknown): string {
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    const degree = typeof obj.degree === 'string' ? obj.degree.trim() : '';
    const institution = typeof obj.institution === 'string' ? obj.institution.trim() : '';
    if (degree || institution) return [degree, institution].filter(Boolean).join(' from ');
    const name = obj.name ?? obj.title ?? obj.language ?? obj.skill;
    if (typeof name === 'string') return name.trim();
    return Object.values(obj).filter((v) => typeof v === 'string' && v.trim()).join(' ');
  }
  return '';
}

// Text/VARCHAR candidate columns the parser fills with arrays.
const LIST_FIELDS = new Set(['skills', 'languages', 'education', 'certifications', 'internships', 'previous_employment']);

/**
 * Flatten array-valued parser fields into the string format stored on candidates:
 * education entries joined with "; ", every other list joined with ", ".
 * Values of other fields, and non-array values, are returned unchanged.
 */
export function flattenCandidateListField(field: string, value: unknown): unknown {
  if (!Array.isArray(value) || !LIST_FIELDS.has(field)) return value;
  const parts = value
    .map(listItemToString)
    .filter((part) => part && !isEmptyOrPlaceholderValue(part));
  return parts.join(listSeparator(field));
}

function listSeparator(field: string): string {
  return field === 'education' ? '; ' : ', ';
}

/**
 * Clamp a string to `max` chars for a VARCHAR column. For list fields, cut at the
 * last whole item instead of mid-word so no partial skill/degree is stored.
 */
export function clampCandidateText(field: string, value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  if (!LIST_FIELDS.has(field)) return cut;
  const lastSep = cut.lastIndexOf(listSeparator(field));
  return lastSep > 0 ? cut.slice(0, lastSep) : cut;
}
