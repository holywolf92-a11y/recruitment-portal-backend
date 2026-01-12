import crypto from 'crypto';

// Deterministic stringify to avoid hash drift from key ordering
function stableStringify(value: any): string {
  if (value === null || value === undefined) return String(value);

  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');

  const valueType = typeof value;
  if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
    return String(value);
  }
  if (valueType === 'string') return value;

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (valueType === 'object') {
    const keys = Object.keys(value).sort();
    const serialized = keys.map((key) => `${key}:${stableStringify(value[key])}`).join(',');
    return `{${serialized}}`;
  }

  return String(value);
}

export function hashString(input: string): string {
  return crypto.createHash('sha256').update(input || '').digest('hex');
}

export function hashRequest(payload: any): string {
  const serialized = stableStringify(payload ?? {});
  return hashString(serialized);
}

export function hashFile(fileBuffer: Buffer): string {
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}
