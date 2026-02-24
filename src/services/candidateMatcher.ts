import { supabaseAdminClient } from '../config/database';
import { createLogger } from '../utils/errorHandling';
import { normalizePhoneE164 } from './candidateService';

const logger = createLogger('CandidateMatcher');

interface MatchCriteria {
  cnic?: string;
  passport?: string;
  email?: string;
  phone?: string;
  name?: string;
  fatherName?: string;
  dateOfBirth?: string;
}

interface MatchResult {
  candidateId: string | null;
  matchedBy: 'cnic' | 'passport' | 'email' | 'phone' | 'name_dob' | 'name_father' | 'name' | null;
  confidence: number;
  multipleMatches: boolean;
  matchCount: number;
  needsManualReview: boolean;
  reviewReasons?: string[];
}

/**
 * Matches documents to candidates using priority: CNIC → Passport → Email → Phone → Name+DOB → Name+Father → Name
 */
export class CandidateMatcher {

  private static normalizePassport(passport: string): string | null {
    if (!passport) return null;
    return passport.trim().toUpperCase();
  }

  private static parseDateToISO(dateStr: string | null | undefined): string | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const trimmed = dateStr.trim();
    if (!trimmed) return null;

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
  static async findCandidate(criteria: MatchCriteria): Promise<MatchResult> {
    const db = supabaseAdminClient();

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
        } else {
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
          } else {
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

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Probabilistic soft-signal matching
    //
    // Unlike the hard identifiers above (CNIC/Passport), soft signals individually
    // carry <100% confidence.  We therefore collect ALL matching signals first and
    // then aggregate:
    //   • All signals agree on the same candidate  → auto-link (with corroboration bonus)
    //   • Signals point to DIFFERENT candidates    → conflict → needsManualReview
    //
    // Corroboration bonus: +3 % per additional confirming signal (capped at 0.99).
    // e.g. email (0.95) + phone (0.90) both agree → final confidence = min(0.99, 0.95 + 0.03) = 0.98
    // ─────────────────────────────────────────────────────────────────────────

    interface SoftSignal {
      source: 'email' | 'phone' | 'name_dob' | 'name_father' | 'name';
      confidence: number;
      candidateId: string;
      label?: string;
    }

    const signals: SoftSignal[] = [];

    // ── Email ──────────────────────────────────────────────────────────────────
    if (criteria.email && !this.isGovernmentEmail(criteria.email)) {
      const normalizedEmail = criteria.email.toLowerCase().trim();
      const { data: emailData, error: emailError } = await db
        .from('candidates')
        .select('id')
        .ilike('email', normalizedEmail)
        .neq('status', 'Deleted');

      if (!emailError && emailData) {
        if (emailData.length === 1) {
          signals.push({ source: 'email', confidence: 0.95, candidateId: emailData[0].id });
          logger.info(`Soft signal: email → ${emailData[0].id}`);
        } else if (emailData.length > 1) {
          // Ambiguous email shared by multiple candidates — escalate immediately.
          return {
            candidateId: null, matchedBy: null, confidence: 0,
            multipleMatches: true, matchCount: emailData.length, needsManualReview: true,
            reviewReasons: [`Multiple candidates (${emailData.length}) share email: ${normalizedEmail}`],
          };
        }
      }
    } else if (criteria.email && this.isGovernmentEmail(criteria.email)) {
      logger.info(`Skipped email matching for government/generic email: ${criteria.email}`);
    }

    // ── Phone ──────────────────────────────────────────────────────────────────
    if (criteria.phone) {
      const e164 = normalizePhoneE164(criteria.phone);
      if (e164) {
        const { data: phoneData, error: phoneError } = await db
          .from('candidates')
          .select('id')
          .eq('phone', e164)
          .neq('status', 'Deleted');

        if (!phoneError && phoneData) {
          if (phoneData.length === 1) {
            signals.push({ source: 'phone', confidence: 0.90, candidateId: phoneData[0].id });
            logger.info(`Soft signal: phone → ${phoneData[0].id}`);
          } else if (phoneData.length > 1) {
            return {
              candidateId: null, matchedBy: null, confidence: 0,
              multipleMatches: true, matchCount: phoneData.length, needsManualReview: true,
              reviewReasons: [`Multiple candidates (${phoneData.length}) share phone: ${e164}`],
            };
          }
        }
      }
    }

    // ── Name-based signals (single batched DB query) ───────────────────────────
    // Load candidates once rather than issuing 3 separate full-table reads.
    if (criteria.name) {
      const normalizedName = this.normalizeName(criteria.name);
      const normalizedFather = criteria.fatherName ? this.normalizeName(criteria.fatherName) : null;
      const dobISO = criteria.dateOfBirth ? this.parseDateToISO(criteria.dateOfBirth) : null;

      const { data: nameData, error: nameError } = await db
        .from('candidates')
        .select('id, name, father_name, date_of_birth')
        .not('name', 'is', null)
        .neq('status', 'Deleted');

      if (!nameError && nameData && nameData.length > 0) {

        // Name + DOB
        if (dobISO) {
          const dobMatches = nameData.filter((c: any) => {
            const cn = this.normalizeName(c.name || '');
            const cd = this.parseDateToISO(String(c.date_of_birth || ''));
            return cd === dobISO && this.calculateSimilarity(normalizedName, cn) >= 0.90;
          });
          if (dobMatches.length === 1) {
            signals.push({ source: 'name_dob', confidence: 0.86, candidateId: dobMatches[0].id });
            logger.info(`Soft signal: name+DOB → ${dobMatches[0].id}`);
          } else if (dobMatches.length > 1) {
            // Multiple candidates with same name+DOB → conflict, add all
            for (const m of dobMatches) {
              signals.push({ source: 'name_dob', confidence: 0.86, candidateId: m.id });
            }
          }
        }

        // Name + Father — only run if no name_dob signal already found for these candidates
        if (normalizedFather) {
          const fatherMatches = nameData.filter((c: any) => {
            if (!c.father_name) return false;
            const cn = this.normalizeName(c.name || '');
            const cf = this.normalizeName(c.father_name || '');
            return this.calculateSimilarity(normalizedName, cn) >= 0.92 &&
                   this.calculateSimilarity(normalizedFather, cf) >= 0.92;
          });
          if (fatherMatches.length === 1) {
            // Only add if not already covered by a name_dob signal for the same candidate
            if (!signals.some(s => s.source === 'name_dob' && s.candidateId === fatherMatches[0].id)) {
              signals.push({ source: 'name_father', confidence: 0.85, candidateId: fatherMatches[0].id });
              logger.info(`Soft signal: name+father → ${fatherMatches[0].id}`);
            } else {
              // Corroborating signal — add anyway so the bonus is counted
              signals.push({ source: 'name_father', confidence: 0.85, candidateId: fatherMatches[0].id });
              logger.info(`Soft signal: name+father corroborates name+DOB → ${fatherMatches[0].id}`);
            }
          } else if (fatherMatches.length > 1) {
            for (const m of fatherMatches) {
              signals.push({ source: 'name_father', confidence: 0.85, candidateId: m.id });
            }
          }
        }

        // Name-only fallback — only runs if no stronger name signal was found
        const hasNameSignal = signals.some(s => s.source === 'name_dob' || s.source === 'name_father');
        if (!hasNameSignal) {
          const nameMatches = nameData.filter((c: any) => {
            const cn = this.normalizeName(c.name || '');
            return this.calculateSimilarity(normalizedName, cn) >= 0.85;
          });
          if (nameMatches.length === 1) {
            const sim = this.calculateSimilarity(normalizedName, this.normalizeName(nameMatches[0].name || ''));
            signals.push({
              source: 'name', confidence: 0.80, candidateId: nameMatches[0].id,
              label: `${(sim * 100).toFixed(0)}% name similarity`,
            });
            logger.info(`Soft signal: name-only → ${nameMatches[0].id} (${(sim * 100).toFixed(0)}% sim)`);
          }
          // If > 1 name-only matches, no signal is pushed (too ambiguous for a soft signal)
        }
      }
    }

    // ── Aggregate signals ─────────────────────────────────────────────────────
    if (signals.length === 0) {
      logger.info('No candidate match found', criteria);
      return {
        candidateId: null, matchedBy: null, confidence: 0,
        multipleMatches: false, matchCount: 0, needsManualReview: false,
      };
    }

    // Group by candidates that were pointed to
    const byCandidate = new Map<string, SoftSignal[]>();
    for (const sig of signals) {
      const existing = byCandidate.get(sig.candidateId) ?? [];
      existing.push(sig);
      byCandidate.set(sig.candidateId, existing);
    }

    // Conflict: signals point to different candidates
    if (byCandidate.size > 1) {
      const conflictDetails = [...byCandidate.entries()].map(
        ([cid, sigs]) => `${cid} via [${sigs.map(s => s.source).join(', ')}]`
      );
      logger.warn('Signal conflict across multiple candidates', { conflicts: conflictDetails });
      return {
        candidateId: null, matchedBy: null, confidence: 0,
        multipleMatches: true, matchCount: byCandidate.size, needsManualReview: true,
        reviewReasons: [
          `Signal conflict: different candidates matched by different signals — ${conflictDetails.join(' | ')}`,
        ],
      };
    }

    // All signals agree on one candidate
    const [matchedCandidateId, matchedSignals] = [...byCandidate.entries()][0];

    // Compute combined confidence: highest single signal + corroboration bonus (+3 % per extra signal)
    const maxConf = Math.max(...matchedSignals.map(s => s.confidence));
    const corroborationBonus = (matchedSignals.length - 1) * 0.03;
    const finalConfidence = Math.min(0.99, maxConf + corroborationBonus);

    // Determine primary source (highest-confidence signal)
    const primarySignal = matchedSignals.reduce((best, s) => s.confidence > best.confidence ? s : best);
    const isNameOnly = matchedSignals.every(s => s.source === 'name');

    const reviewReasons: string[] = [];
    if (isNameOnly) {
      const ns = matchedSignals.find(s => s.source === 'name');
      reviewReasons.push(`Name-only match (${ns?.label ?? ''}) — verify identity before linking`);
    }

    if (matchedSignals.length > 1) {
      logger.info(
        `Probabilistic match: candidate=${matchedCandidateId}, signals=[${matchedSignals.map(s => s.source).join(', ')}], ` +
        `base=${maxConf.toFixed(2)}, bonus=${corroborationBonus.toFixed(2)}, final=${finalConfidence.toFixed(3)}`
      );
    }

    return {
      candidateId: matchedCandidateId,
      matchedBy: primarySignal.source as MatchResult['matchedBy'],
      confidence: finalConfidence,
      multipleMatches: false,
      matchCount: matchedSignals.length,
      needsManualReview: isNameOnly,
      ...(reviewReasons.length > 0 ? { reviewReasons } : {}),
    };
  }

  /**
   * Normalize CNIC to digits only
   */
  private static normalizeCnic(cnic: string): string {
    return cnic.replace(/[^\d]/g, '');
  }

  /**
   * Normalize phone to digits only (simple v1)
   */
  private static normalizePhone(phone: string): string {
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
  private static normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '') // Remove special chars
      .replace(/\s+/g, ' '); // Normalize spaces
  }

  /**
   * Calculate string similarity (Levenshtein distance based)
   */
  private static calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0.0;

    const distance = this.levenshteinDistance(str1, str2);
    const maxLen = Math.max(str1.length, str2.length);
    return 1 - (distance / maxLen);
  }

  /**
   * Levenshtein distance algorithm
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

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
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Check if email is from a government/police department (should not be used for matching)
   */
  static isGovernmentEmail(email: string): boolean {
    if (!email) return false;
    
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
