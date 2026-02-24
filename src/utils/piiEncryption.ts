/**
 * piiEncryption.ts
 *
 * Field-level AES-256-GCM encryption for PII fields:
 *   cnic, passport, phone, email
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 * Encrypted values are stored as a prefixed string:
 *   enc:<hex-iv>:<hex-authTag>:<hex-ciphertext>
 *
 * Unencrypted values (legacy data or fields not subject to encryption) pass
 * through transparently — encrypt/decrypt are safe to call on already-plain
 * or already-encrypted strings.
 *
 * ── Key management ───────────────────────────────────────────────────────────
 * Key is read from env var:  PII_ENCRYPTION_KEY  (32-byte hex, 64 chars)
 * Generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * If the key is not set, encryption is a no-op (plaintext stored as-is).
 * Set PII_ENCRYPTION_KEY in Railway environment variables.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   import { encryptPII, decryptPII, isPIIEncrypted } from '../utils/piiEncryption';
 *
 *   // Before storing to DB:
 *   candidate.cnic     = encryptPII(rawCnic);
 *   candidate.passport = encryptPII(rawPassport);
 *
 *   // After reading from DB:
 *   const cnic = decryptPII(candidate.cnic);
 *
 *   // For matching (always decrypt before comparing):
 *   const normalizedCnic = decryptPII(candidate.cnic).replace(/[^\d]/g, '');
 *
 * ── Matching compatibility ────────────────────────────────────────────────────
 * The cnic_normalized and passport_normalized columns store the PLAIN normalized
 * form (digits-only) for DB-level index matching. Only the display/raw columns
 * (cnic, passport, phone, email) are encrypted.
 *
 * This means identity matching still works efficiently via indexes; encryption
 * only protects the human-readable PII from raw DB access.
 */

import * as crypto from 'crypto';
import { createLogger } from './errorHandling';

const logger = createLogger('PIIEncryption');

const ENCRYPTION_PREFIX = 'enc:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;      // bytes — AES GCM standard
const TAG_LENGTH = 16;     // bytes — GCM auth tag

/**
 * Load and validate the 32-byte key from PII_ENCRYPTION_KEY env var.
 * Returns null if the key is absent/invalid (encryption disabled).
 */
function getKey(): Buffer | null {
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (!hex) return null;

  if (hex.length !== 64) {
    logger.warn(
      'PII_ENCRYPTION_KEY is set but has wrong length (expected 64 hex chars = 32 bytes). ' +
      'PII encryption is DISABLED. Set a valid 64-char hex key to enable.'
    );
    return null;
  }

  try {
    return Buffer.from(hex, 'hex');
  } catch {
    logger.warn('PII_ENCRYPTION_KEY is not valid hex. PII encryption is DISABLED.');
    return null;
  }
}

/** True if the value looks like it has been encrypted by this module. */
export function isPIIEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTION_PREFIX);
}

/**
 * Encrypt a PII string value.
 *
 * - If PII_ENCRYPTION_KEY is not configured, returns value unchanged (plaintext).
 * - If value is already encrypted (starts with "enc:"), returns it unchanged.
 * - If value is null/undefined/'', returns it unchanged.
 *
 * Each call generates a fresh random IV — identical plaintext → different ciphertext.
 */
export function encryptPII(value: string | null | undefined): string {
  if (!value) return value as string;
  if (isPIIEncrypted(value)) return value;  // already encrypted

  const key = getKey();
  if (!key) return value;  // encryption disabled

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM;

  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a PII string value.
 *
 * - If value does not start with "enc:", returns it unchanged (backward-compatible
 *   with plaintext rows created before encryption was enabled).
 * - If decryption fails (wrong key, tampered data), logs a warning and returns the
 *   raw encrypted string — does NOT throw, to prevent data access outages.
 */
export function decryptPII(value: string | null | undefined): string {
  if (!value) return value as string;
  if (!isPIIEncrypted(value)) return value;  // plaintext (legacy or unencrypted field)

  const key = getKey();
  if (!key) {
    // Key not present — return raw encrypted string (operator must configure key)
    logger.warn('Cannot decrypt PII: PII_ENCRYPTION_KEY not configured');
    return value;
  }

  try {
    const parts = value.slice(ENCRYPTION_PREFIX.length).split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');

    const [ivHex, tagHex, cipherHex] = parts;
    const iv         = Buffer.from(ivHex,     'hex');
    const tag        = Buffer.from(tagHex,    'hex');
    const ciphertext = Buffer.from(cipherHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (err: any) {
    logger.warn('PII decryption failed (returning raw value)', { message: err?.message });
    return value;  // fail-open to prevent read outages
  }
}

/**
 * Encrypt all detectable PII fields in a candidate-shaped object.
 * Safe to call even if some fields are already encrypted.
 *
 * Usage before upsert:
 *   const safePayload = encryptCandidatePII(parsedData);
 *   await db.from('candidates').upsert(safePayload);
 */
export function encryptCandidatePII<T extends Record<string, any>>(candidate: T): T {
  return {
    ...candidate,
    cnic:     encryptPII(candidate.cnic),
    passport: encryptPII(candidate.passport),
    phone:    encryptPII(candidate.phone),
    email:    encryptPII(candidate.email),
  };
}

/**
 * Decrypt all PII fields in a candidate-shaped object read from the DB.
 * Safe to call even if fields are already plaintext (pre-encryption rows).
 *
 * Usage after DB read:
 *   const readable = decryptCandidatePII(dbRow);
 */
export function decryptCandidatePII<T extends Record<string, any>>(candidate: T): T {
  return {
    ...candidate,
    cnic:     decryptPII(candidate.cnic),
    passport: decryptPII(candidate.passport),
    phone:    decryptPII(candidate.phone),
    email:    decryptPII(candidate.email),
  };
}
