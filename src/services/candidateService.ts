import { supabaseAdminClient } from '../config/database';
import { logProfileCreated, logProfileUpdated } from './timelineService';
import { DocumentLinkService } from './documentLinkService';
import { resolveBackendApiBaseUrl, resolveFrontendUrl } from '../utils/publicUrl';
import { deriveProfilePhotoStorageRef } from '../utils/profilePhotoStorage';

// Normalization helper functions
export function normalizeCNIC(cnic: string): string | null {
  if (!cnic) return null;
  // Extract only digits from CNIC
  const digitsOnly = cnic.replace(/\D/g, '');
  // CNIC should be 13 digits
  return digitsOnly.length === 13 ? digitsOnly : null;
}

export function normalizePassport(passport: string): string | null {
  if (!passport) return null;
  // Trim whitespace and convert to uppercase
  return passport.trim().toUpperCase();
}

export function normalizePhoneE164(phone: string): string | null {
  if (!phone) return null;
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');

  // Common Pakistan local mobile format: 03XXXXXXXXX (11 digits)
  // Convert to +923XXXXXXXXX
  if (digitsOnly.length === 11 && digitsOnly.startsWith('03')) {
    return `+92${digitsOnly.slice(1)}`;
  }

  // Another common form: 3XXXXXXXXX (10 digits) → +923XXXXXXXXX
  if (digitsOnly.length === 10 && digitsOnly.startsWith('3')) {
    return `+92${digitsOnly}`;
  }

  // Add Pakistan country code if not present
  if (digitsOnly.startsWith('92') && digitsOnly.length === 12) {
    return `+${digitsOnly}`;
  } else if (digitsOnly.length === 13 && digitsOnly.startsWith('923')) {
    return `+${digitsOnly}`;
  }
  return null;
}

export const CANDIDATE_STATUS_VALUES = ['Applied', 'Pending', 'Deployed', 'Hired', 'Cancelled'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUS_VALUES)[number];

export function parseCandidateStatus(value?: string | null, fallback: CandidateStatus = 'Applied'): CandidateStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  switch (normalized) {
    case 'applied':
      return 'Applied';
    case 'pending':
      return 'Pending';
    case 'deployed':
      return 'Deployed';
    case 'hired':
      return 'Hired';
    case 'cancelled':
      return 'Cancelled';
    default:
      throw new Error(`Invalid status: ${value}. Allowed values are ${CANDIDATE_STATUS_VALUES.join(', ')}`);
  }
}

export function parseCandidatePaymentAmount(value?: number | string | null, fallback = 0): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(parsed)) {
    throw new Error('Payment amount must be a valid number');
  }

  const normalized = Math.round(parsed);
  if (normalized < 0) {
    throw new Error('Payment amount cannot be negative');
  }

  return normalized;
}

// Generate candidate code in FL-03-26-1 format.
// The candidate_code field is the shared reference used across inbox ingestion,
// candidate management, Excel browser, and employer-safe CV output.
export async function generateCandidateCode(): Promise<string> {
  const db = supabaseAdminClient();
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  const prefix = `FL-${month}-${year}-`;

  // Allow up to 20 attempts to handle concurrent inserts gracefully
  for (let attempt = 0; attempt < 20; attempt++) {
    const { data: existingCandidates } = await db
      .from('candidates')
      .select('candidate_code')
      .like('candidate_code', `${prefix}%`)
      .limit(10000);

    let maxSequence = 0;

    for (const row of existingCandidates || []) {
      const code = row?.candidate_code;
      const match = typeof code === 'string' ? code.match(/^FL-\d{2}-\d{2}-(\d+)$/) : null;
      if (!match) continue;

      const parsed = Number.parseInt(match[1], 10);
      // Skip any timestamp-based artifacts (valid sequential codes are < 1,000,000)
      if (Number.isFinite(parsed) && parsed < 1_000_000 && parsed > maxSequence) {
        maxSequence = parsed;
      }
    }

    const candidateCode = `${prefix}${maxSequence + 1 + attempt}`;

    const { data: existing } = await db
      .from('candidates')
      .select('id')
      .eq('candidate_code', candidateCode)
      .maybeSingle();

    if (!existing) {
      return candidateCode;
    }
  }

  // Never fall back to a timestamp — throw so the caller surfaces the error
  // rather than silently producing a malformed candidate code.
  throw new Error(`Failed to generate a unique candidate code for prefix ${prefix} after 20 attempts`);
}

// Check for duplicates based on CNIC or passport
export async function checkForDuplicates(cnic?: string, passport?: string, excludeId?: string): Promise<any[]> {
  const db = supabaseAdminClient();
  const duplicates: any[] = [];

  // Priority 1: Check CNIC
  if (cnic) {
    const normalizedCnic = normalizeCNIC(cnic);
    if (normalizedCnic) {
      let query = db
        .from('candidates')
        .select('*')
        .eq('cnic_normalized', normalizedCnic);

      if (excludeId) {
        query = query.neq('id', excludeId);
      }

      const { data: cnicDuplicates } = await query;
      if (cnicDuplicates && cnicDuplicates.length > 0) {
        duplicates.push(...cnicDuplicates.map(d => ({ ...d, matchReason: 'CNIC', priority: 1 })));
      }
    }
  }

  // Priority 2: Check passport
  if (passport && duplicates.length === 0) {
    const normalizedPassport = normalizePassport(passport);
    if (normalizedPassport) {
      let query = db
        .from('candidates')
        .select('*')
        .eq('passport_normalized', normalizedPassport);

      if (excludeId) {
        query = query.neq('id', excludeId);
      }

      const { data: passportDuplicates } = await query;
      if (passportDuplicates && passportDuplicates.length > 0) {
        duplicates.push(...passportDuplicates.map(d => ({ ...d, matchReason: 'Passport', priority: 2 })));
      }
    }
  }

  return duplicates;
}

/**
 * Infer gender from a candidate's name using Pakistani/Arabic name patterns.
 * Returns 'Female', 'Male', or null if no strong match.
 */
function inferGenderFromName(name: string): 'Female' | 'Male' | null {
  if (!name) return null;
  // Strip titles and parenthetical suffixes, then uppercase
  const n = name.replace(/\([^)]*\)/g, '').replace(/^(dr\.?\s+|prof\.?\s+|eng\.?\s+|mr\.?\s+|mrs\.?\s+|ms\.?\s+|miss\s+)/i, '').trim().toUpperCase();
  if (!n) return null;

  const words = n.split(/\s+/);
  const first = words[0];
  const last = words[words.length - 1];

  // Female suffixes (last word)
  if (/^(BIBI|BEGUM|BANO|KHATOON|KHATUN|NISA|UNNISA|BEGAM|BIVI|MAI|BINTE|BINT)$/.test(last)) return 'Female';

  // Male suffixes — *ULLAH, *UDDIN endings always Male
  if (/ULLAH$/.test(last) || /UDDIN$/.test(last)) return 'Male';

  // Male prefixes (first word)
  const malePfx = ['MUHAMMAD','MOHAMMED','MOHAMMAD','MOHD','HAFIZ','MAULANA','MOLANA','HAJI',
    'SYED','SHEIKH','QARI','GHULAM','ABDUL','ABDUR','ABUL','ABU','ABAID','ABD',
    'MIAN','KHAWAJA','MIRZA','ALLAMA','SARDAR','AGHA'];
  if (malePfx.includes(first)) return 'Male';
  // ABD* variants
  if (/^ABD(UL|UR|AR|U|ULL)/.test(first)) return 'Male';
  // CH (Chaudhry prefix) → Male
  if (first === 'CH' || first.startsWith('CH.')) return 'Male';

  // Female prefixes
  if (['SYEDA','MISS','MRS'].includes(first)) return 'Female';

  // Female first names (common Pakistani/Arabic)
  const femaleNames = new Set([
    'HIRA','ANAM','RIMSHA','SIDRA','IQRA','KIRAN','MAHAM','MISBAH','NIDA','SUNDAS',
    'SANA','SARA','SARAH','AMNA','KAINAT','AREEBA','AROOJ','FARIHA','FAIZA','FARWA',
    'FIZA','HADIA','HAFSA','HALEEMA','HALIMA','HAMNA','HANIA','HUMERA','JAVERIA',
    'LUBNA','MALAIKA','MARWA','MEHREEN','MUSKAN','MUNEEBA','NABILA','NAILA','NAZIA',
    'NEHA','NOOR','NOREEN','RAFIA','RAHILA','RANIA','RIDA','RUBA','SABA','SEHRISH',
    'SHANZA','SHAZIA','SUMBUL','TAYYABA','TEHREEM','TOOBA','URWA','WARDA','YUMNA',
    'ZAHRA','ZEHRA','ZEBA','ZUNAIRA','ANEELA','AMIRA','AAMIRA','ASIYA','BEENISH',
    'BILQUEES','HOORIA','IRAM','IRHA','KOMAL','MAHVISH','MAMOONA','MASOOMA','NAILAH',
    'NISHA','QURATULAIN','RAHIMA','SHAMAILA','SUMERA','SUNDUS','TANIA','UJALA','WAJEEHA',
    'ZAREEN','AMBREEN','ARFA','ATIYA','AZRA','BISMAH','BUSHRA','DUAA','DUA','ESHA',
    'FALAK','FARAH','FATIMAH','FEHMEEDA','HADIQAH','HAMIDA','HUMA','HUMAIRA','IFFAT',
    'INAYA','ISHRAT','JASMINE','JUVERIAH','KANWAL','KHADEEJA','KHADIJA','KHIZRA',
    'LARAIB','LAYLA','MAHA','MAHNOOR','MAIRA','MALIHA','MEERA','MEHAK','MEHWISH',
    'MINHAL','MISHAL','MOMINA','MUQADDAS','NABIHA','NAEEMA','NAFEESA','NAHEED',
    'NAYAB','NAZISH','NIGAR','NIGHAT','NIMRA','NOSHEEN','NUDRAT','NUSRAT','PARVEEN',
    'RAHEELA','RAKSHANDA','RAMEEZA','REHANA','ROBINA','ROOHI','ROZINA','RUBAB',
    'RUBINA','RUKHSAR','RUMAISA','SADAF','SAIRA','SALEHA','SALMA','SAMIA','SAMINA',
    'SHAHIDA','SHAHINA','SHAHNAZ','SHAMIM','SHIRIN','SHUGUFTA','SOHAILA','SUMAIYA',
    'TABASSUM','TAHIRA','TALAT','TAQDEES','TAYYIBA','TUBA','UMAIRA','WAJIHA',
    'YASHFEEN','YASMIN','YASMEEN','ZARA','ZARISH','ZARNAB','ZEENAT','ZOBIA','ZOYA',
    'ZAINAB','FATIMA','MARYAM','AYESHA','AISHA','ANUM','ASMA','RABIA','NASREEN',
    'NASRIN','RUKHSANA','SAMRA','GULNAZ','SEHAR','MAHEEN','ALISHA','LAIBA','FAREEHA',
    'NADIA','SAIMA','FARZANA','SOBIA','UZMA','FOZIA','ANILA','TEHMINA','SHAISTA',
    'RAHAT','NAJMA','NARGIS','SADIA','GULSHAN','ALEENA','ALINA','AQSA','FARYAL',
    'JANNAT','KINZA','MADIHA','RAMSHA','RUHI','SEEMAB','SEERAT','SHAKEELA','SHAMSA',
    'SHEEBA','SHEEZA','SHEHLA','SIMRA','SUNBAL','TAHREEM','TASNIM','UROOBA','WARISHA',
    'ZAHIDA','ZULEKHA','ZUBIA','ABEERA','ABIYA','AESHA','AFSHAN','AFSHEEN','AIMAN',
    'AIMEN','ALIEHA','ALVEENA','IMAMA','IRSA','HIFZA','KARIMA','AREEJ','ALISHBA',
    'MAHRUKH','SAHRISH','SAMREEN','SANIA','MINHA','BOUCHRA','HAJRA','FARRAH','ANEESA',
    'BEENA','ANILA','MAHIRA','MAWRA','MAYRA','BAKHTAWAR','BATOOL','HOOR','ZUNERA',
  ]);
  if (femaleNames.has(first)) return 'Female';

  // Male first names (common Pakistani/Arabic)
  const maleNames = new Set([
    'HAMZA','ALI','USMAN','WALEED','DANISH','KAMRAN','BILAL','IMRAN','FAISAL','SALMAN',
    'WAQAS','ATIF','AAMIR','ADNAN','UMER','UMAR','ZUBAIR','RIZWAN','NADEEM','SHOAIB',
    'ASAD','JAWAD','SAJID','ZAHID','MAJID','RASHID','HAMID','HARIS','TARIQ','IRFAN',
    'JAVED','KASHIF','NAEEM','WASEEM','WASIM','NAVEED','SHAHID','BABAR','QASIM',
    'JUNAID','KHURRAM','MANSOOR','RAHEEL','SOHAIL','YASIR','NADIR','OWAIS','PERVEZ',
    'RAZA','SAAD','EJAZ','FAWAD','FARRUKH','ISHAQ','LUQMAN','MUDASSAR','NOMAN',
    'NAUMAN','RAEES','SARFRAZ','TALHA','WAJID','YOUSAF','YUSUF','ZAHEER','AFFAN',
    'ZEESHAN','REHAN','HASSAN','HASAN','HUSSAIN','HUSAIN','IBRAHIM','ISMAIL','KHALID',
    'AQEEL','TANVEER','TANVIR','ANWAR','ARIF','NASIR','MUNIR','JAMIL','FAHAD','FAROOQ',
    'OBAID','AHSAN','AHMER','DANIYAL','DANYAL','EHSAN','FAREED','HAMMAD','IFTIKHAR',
    'JAVAID','KARIM','LATIF','MUBARAK','MUZAMMIL','OMER','QADEER','RAFIQ','SAFDAR',
    'TAHIR','UZAIR','WAHEED','WAQAR','YAQOOB','ZAFAR','ABUBAKAR','ABUBAKR','ABUBAKKAR',
    'DAUD','DAWUD','SHAFIQ','MUNEEB','MOHSIN','SIRAJ','TAYYAB','AOUN','BASIT','FAIZAN',
    'ZAIN','ZOHAIB','TAUSEEF','ARSLAN','AWAIS','AZIZ','BURHAN','FARAZ','FARHAN',
    'FURQAN','HASNAIN','IKRAM','KALEEM','KHURSHID','LIAQUAT','LIAQAT','MUAZ','MUKHTAR',
    'MUSTAFA','NAJEEB','NASEEM','OMAR','OSAMA','OSMAN','PARVEZ','QAISAR','RAMZAN',
    'SAEED','SAMEER','SHABBIR','SHAHBAZ','SHAHRUKH','SHAKEEL','SHAUKAT','SHEHZAD',
    'SULTAN','SULEMAN','TAIMOOR','TOUQEER','UMAIR','YASEEN','ZAHIR','ZULFIQAR',
    'AMJAD','AMJID','ANEES','AQIB','ARSHAD','ASIF','ASIM','ASLAM','AZHAR','BADAR',
    'FAYAZ','HAFEEZ','HASHIM','HUSNAIN','JAHANGIR','JAMEEL','KHAWAR','MAHMOOD',
    'MUSHTAQ','NAZAR','NIAZ','QAMAR','RIAZ','SALEEM','SARWAR','SHAKIR','SIKANDER',
    'TAHSEEN','USAMA','ZAID','ZAYD','ANAS','SUFYAN','AYYUB','ILYAS','IDREES',
    'HAROON','ABRAR','AMEER','ARSALAN','SHAHZAD','SHIRAZ','SOHAIB','SUBHAN','TALAL',
    'TASHFEEN','TAUQEER','ZAMEER','AASIM','ABID','ADEEL','ADIL','AFTAB','AHAD',
    'AHTISHAM','AIZAZ','AJMAL','AKBAR','AKRAM','ALAM','ALAMGIR','ALEEM','AMEEN',
    'AMMAR','AQEEL','ARFAN','ARMAN','ARSLAN','ARYAN','ASHFAQ','ASHRAF','ASRAR',
    'ATHAR','ATIQ','AWAIS','AYAZ','BAKR','BASHIR','BASIT','BILEL','DILAWAR',
    'EHTISHAM','EJAZ','EMAD','FAIZ','FAIZAN','FARIS','FAZAL','GHAZI','GULFAM',
    'GULZAR','HANIF','HAYAT','HILAL','HUNAIN','HUSSAM','HUSNAIN','IJAZ','IKHLAQ',
    'IMAD','IMTIAZ','IRSHAD','IRTAZA','ISRAR','IZHAR','JAFAR','JAMAL','JUNAID',
    'KAASHIF','KAMIL','KHAQAN','KHIZAR','LAEEQ','MASOOD','MATEEN','MAZHAR','MOBIN',
    'MOIZ','MUBEEN','MUJAHID','MUJTABA','MUNIR','MURAD','MURTAZA','MUSAB','MUSAWAR',
    'MUTAHIR','MUZZAMMIL','NASEEB','NASEER','NOUMAN','OBAID','PERVEZ','QADIR','RAHIM',
    'RAUF','SABIR','SABTAIN','SAFI','SAFYAN','SAHIL','SAJJAD','SARMAD','SHAKEEL',
    'SIDDIQ','SOHRAB','SUBHAAN','SUFIAN','USWAQ','ZAFARYAB','ZAHOOR','ZAKIR','ZARAR',
    'ZUHAIB','AHMAD','AHMED','AAFAQ','AASHIR','AATIF','ALTAF','ALTAMISH','GHAZANFAR',
    'HAIDER','HAMAYUN','HAMEEDULLAH','HAMZULLAH','HANEEF','HANZALA','HANZLA','HASEEB',
    'HASSAAN','HASSAM','HAZRAT','HIDAYAT','HISAM','HOSSAIN','HUBAIB','HUMAIL','HUZAIFA',
    'HUZAIFAH','IBAD','IBRAR','IHTESHAM','INAMULLAH','INZAMAM','IZAZ','JAMSHED','JOHAR',
    'KABIR','KAMAL','KANWAR','KHATEEB','KHIZER','KONAIN','GULRAIZ','JAHANZAIB','JALAL',
    'NAWAZ','NOORULLAH','FAHIM','FAIQ','FAKHAR','FARZAND','FURKAN','GHAZANFER',
    'GOHAR','HAIDER','HANZALA','HANZLA',
  ]);
  if (maleNames.has(first)) return 'Male';

  return null;
}


export interface CreateCandidateData {
  name: string;
  father_name?: string;
  status?: CandidateStatus | string;
  payment_amount?: number;
  source?: 'WhatsApp' | 'Email' | 'Form' | 'Manual' | string;
  partner_id?: string;
  partner_name?: string;
  is_partner_candidate?: boolean;
  ai_score?: number;
  auto_extracted?: boolean;
  needs_review?: boolean;
  email?: string;
  phone?: string;
  date_of_birth?: string;
  gender?: string;
  marital_status?: string;
  address?: string;
  cnic?: string;
  passport?: string;

  // CV extraction/profile fields (migration 011)
  nationality?: string;
  position?: string;
  experience_years?: number;
  country_of_interest?: string;
  skills?: string;
  languages?: string;
  education?: string;
  certifications?: string;
  internships?: string;
  previous_employment?: string;
  passport_expiry?: string;
  professional_summary?: string;

  // Document checklist items (Migration 010)
  passport_received?: boolean;
  cnic_received?: boolean;
  degree_received?: boolean;
  medical_received?: boolean;
  visa_received?: boolean;

  // Candidate card doc flags (migration 012)
  cv_received?: boolean;
  photo_received?: boolean;
  certificate_received?: boolean;

  // Profile photo URL from parser
  profile_photo_url?: string;

  // Excel data fields (migration add_excel_data_columns)
  religion?: string;
  salary_expectation?: string;
  date_available?: string;
  interview_date?: string;
  medical_expiry?: string;
  license?: string;
  gcc_years?: number;

  // Social links
  youtube_link?: string;
}

export async function createCandidate(data: CreateCandidateData, userId?: string) {
  const db = supabaseAdminClient();

  // Normalize identifiers
  const cnicNormalized = data.cnic ? normalizeCNIC(data.cnic) : null;
  const passportNormalized = data.passport ? normalizePassport(data.passport) : null;
  const phoneNormalized = data.phone ? normalizePhoneE164(data.phone) : null;

  // Check for duplicates
  const duplicates = await checkForDuplicates(data.cnic, data.passport);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate candidate found: ${duplicates[0].name} (${duplicates[0].matchReason})`);
  }

  // Generate candidate code
  const candidateCode = await generateCandidateCode();

  // Validate profile_photo_url (only allow image URLs or Supabase signed URLs)
  let validProfilePhotoUrl = null;
  let profilePhotoBucket: string | undefined;
  let profilePhotoPath: string | undefined;
  if (data.profile_photo_url && typeof data.profile_photo_url === 'string') {
    const url = data.profile_photo_url.toLowerCase();
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
    const extMatch = url.match(/\.([a-z0-9]+)(?:\?|#|$)/);

    // Check for Supabase signed URLs which might not match extension regex easily
    const isSupabaseUrl = url.includes('supabase.co') && url.includes('/storage/v1/object/sign/');

    // Accept all valid image URLs including CV-extracted photos
    if (isSupabaseUrl || (extMatch && allowedExts.includes(extMatch[1]))) {
      validProfilePhotoUrl = data.profile_photo_url;
      const storageRef = deriveProfilePhotoStorageRef(validProfilePhotoUrl);
      if (storageRef) {
        profilePhotoBucket = storageRef.bucket;
        profilePhotoPath = storageRef.storagePath;
      }
      console.log(`[ProfilePhotoValidation] Accepted profile photo URL: ${data.profile_photo_url}`);
    } else {
      console.warn(`[ProfilePhotoValidation] Rejected non-image profile_photo_url: ${data.profile_photo_url}`);
    }
  }

  // Truncate VARCHAR-limited fields to prevent 22001 overflow errors (safety net for all callers)
  const VARCHAR_LIMITS_CREATE: Record<string, number> = {
    name: 255, email: 255, phone: 50, position: 255, education: 255,
    nationality: 100, country_of_interest: 100, marital_status: 20, gender: 20,
    father_name: 255,
    professional_summary: 255,
    skills: 255,
    languages: 255,
    certifications: 255,
    internships: 255,
    previous_employment: 255,
    address: 255,
  };
  const truncCreate = (val: any, maxLen: number) =>
    typeof val === 'string' && val.length > maxLen ? val.slice(0, maxLen) : val;

  // Auto-infer gender from name when not provided
  const resolvedGender = data.gender || inferGenderFromName(data.name) || undefined;

  // Create candidate record
  const candidateData = {
    candidate_code: candidateCode,
    name: truncCreate(data.name, VARCHAR_LIMITS_CREATE.name),
    father_name: truncCreate(data.father_name, VARCHAR_LIMITS_CREATE.father_name),
    status: parseCandidateStatus(data.status, 'Applied'),
    payment_amount: parseCandidatePaymentAmount(data.payment_amount, 0),
    source: data.source,
    partner_id: data.partner_id,
    partner_name: data.partner_name,
    is_partner_candidate: data.is_partner_candidate,
    ai_score: data.ai_score,
    auto_extracted: data.auto_extracted,
    needs_review: data.needs_review,
    email: truncCreate(data.email, VARCHAR_LIMITS_CREATE.email),
    phone: truncCreate(phoneNormalized, VARCHAR_LIMITS_CREATE.phone),
    date_of_birth: data.date_of_birth,
    gender: truncCreate(resolvedGender, VARCHAR_LIMITS_CREATE.gender),
    marital_status: truncCreate(data.marital_status, VARCHAR_LIMITS_CREATE.marital_status),
    address: truncCreate(data.address, VARCHAR_LIMITS_CREATE.address),
    cnic_normalized: cnicNormalized,
    passport_normalized: passportNormalized,

    nationality: truncCreate(data.nationality, VARCHAR_LIMITS_CREATE.nationality),
    position: truncCreate(data.position, VARCHAR_LIMITS_CREATE.position),
    experience_years: data.experience_years,
    country_of_interest: truncCreate(data.country_of_interest, VARCHAR_LIMITS_CREATE.country_of_interest),
    skills: truncCreate(data.skills, VARCHAR_LIMITS_CREATE.skills),
    languages: truncCreate(data.languages, VARCHAR_LIMITS_CREATE.languages),
    education: truncCreate(data.education, VARCHAR_LIMITS_CREATE.education),
    certifications: truncCreate(data.certifications, VARCHAR_LIMITS_CREATE.certifications),
    internships: truncCreate(data.internships, VARCHAR_LIMITS_CREATE.internships),
    previous_employment: truncCreate(data.previous_employment, VARCHAR_LIMITS_CREATE.previous_employment),
    passport_expiry: data.passport_expiry,
    professional_summary: truncCreate(data.professional_summary, VARCHAR_LIMITS_CREATE.professional_summary),

    // Include checklist items if provided (defaults handled by DB)
    passport_received: data.passport_received,
    cnic_received: data.cnic_received,
    degree_received: data.degree_received,
    medical_received: data.medical_received,
    visa_received: data.visa_received,

    // Candidate card doc flags (optional)
    cv_received: data.cv_received,
    photo_received: data.photo_received,
    certificate_received: data.certificate_received,

    // Profile photo URL (validated)
    profile_photo_url: validProfilePhotoUrl,
    profile_photo_bucket: profilePhotoBucket,
    profile_photo_path: profilePhotoPath,
  };

  const { data: candidate, error } = await db
    .from('candidates')
    .insert(candidateData)
    .select()
    .single();

  if (error) throw error;

  // Log timeline event
  try {
    await logProfileCreated(candidate.id, userId, {
      candidate_code: candidateCode,
      name: data.name,
    });
  } catch (timelineError) {
    console.error('Failed to log timeline event:', timelineError);
    // Don't fail the creation if timeline logging fails
  }

  // Trigger reconciliation for any unmatched documents with matching identifiers
  try {
    const documentLinkService = new DocumentLinkService();
    await documentLinkService.reconcileDocumentsForCandidate(candidate.id);
  } catch (reconcileError) {
    console.error('Failed to reconcile documents for new candidate:', reconcileError);
    // Don't fail candidate creation if reconciliation fails
  }

  return candidate;
}

export async function getCandidateById(id: string, userId: string) {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from('candidates')
    .select('*')
    .eq('id', id)
    .neq('status', 'Deleted') // Exclude soft-deleted candidates
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export interface CandidateFilters {
  search?: string;
  status?: string;
  position?: string;
  country_of_interest?: string;
  documents?: 'complete' | 'missing' | string;
  /** Filter by partner user ID (admin Partner tab) */
  partner_id?: string;
  /** Date Applied: from (ISO date or datetime, inclusive) */
  applied_from?: string;
  /** Date Applied: to (ISO date or datetime, inclusive) */
  applied_to?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CandidateBrowseCountItem {
  name: string;
  count: number;
}

export interface CandidateBrowseProfessionMetadata {
  name: string;
  count: number;
  countries: CandidateBrowseCountItem[];
  statuses: CandidateBrowseCountItem[];
  documents: {
    complete: number;
    missing: number;
  };
}

export interface CandidateBrowseMetadata {
  totalCandidates: number;
  professions: CandidateBrowseProfessionMetadata[];
  countries: CandidateBrowseCountItem[];
  statuses: CandidateBrowseCountItem[];
}

// Fields returned in list responses — excludes large text columns (skills, previous_employment,
// professional_summary, education, certifications) that are only needed in the detail view.
// Narrowing the select cuts list response payload by ~60-80% and reduces Railway egress.
const LIST_FIELDS = [
  'id', 'candidate_code', 'name', 'status', 'payment_amount', 'source', 'ai_score',
  'partner_id', 'partner_name', 'is_partner_candidate',
  'position', 'nationality', 'country_of_interest', 'experience_years',
  'phone', 'email', 'date_of_birth', 'gender', 'marital_status', 'address',
  'passport_normalized', 'cnic_normalized', 'passport_expiry',
  'languages', 'skills',
  'passport_received', 'cnic_received', 'degree_received', 'medical_received',
  'visa_received', 'cv_received', 'photo_received', 'certificate_received',
  'driving_license_received',
  'profile_photo_url', 'profile_photo_bucket', 'profile_photo_path',
  'needs_review', 'auto_extracted', 'created_at', 'updated_at',
  'youtube_link',
].join(',');

export async function listCandidates(filters: CandidateFilters = {}, userId: string) {
  const db = supabaseAdminClient();
  let query = db.from('candidates').select(LIST_FIELDS, { count: 'exact' });
  const normalizedSearch = (filters.search || '').trim();
  const normalizedSearchLower = normalizedSearch.toLowerCase();
  const genderSearch = (normalizedSearchLower === 'female' || normalizedSearchLower === 'females')
    ? 'Female'
    : (normalizedSearchLower === 'male' || normalizedSearchLower === 'males')
      ? 'Male'
      : (normalizedSearchLower === 'other' || normalizedSearchLower === 'others')
        ? 'Other'
        : null;

  // By default, exclude deleted candidates (unless explicitly filtering for them)
  if (!filters.status || filters.status !== 'Deleted') {
    query = query.neq('status', 'Deleted');
  }

  // Global search: partial, case-insensitive, across name, passport, CNIC, email, phone, position, skills (server-side)
  if (normalizedSearch) {
    if (genderSearch) {
      query = query.eq('gender', genderSearch);
    } else {
      query = query.or(
        `name.ilike.%${normalizedSearch}%,email.ilike.%${normalizedSearch}%,candidate_code.ilike.%${normalizedSearch}%,phone.ilike.%${normalizedSearch}%,passport_normalized.ilike.%${normalizedSearch}%,cnic_normalized.ilike.%${normalizedSearch}%,position.ilike.%${normalizedSearch}%,partner_name.ilike.%${normalizedSearch}%,skills.ilike.%${normalizedSearch}%,nationality.ilike.%${normalizedSearch}%,gender.ilike.%${normalizedSearch}%,country_of_interest.ilike.%${normalizedSearch}%`
      );
    }
  }

  // Apply status filter
  if (filters.status && filters.status !== 'all' && filters.status !== 'Deleted') {
    query = query.eq('status', filters.status);
  } else if (filters.status === 'Deleted') {
    // Only show deleted if explicitly requested
    query = query.eq('status', 'Deleted');
  }

  // Apply profession (position) filter
  if (filters.position && filters.position !== 'all') {
    query = query.eq('position', filters.position);
  }

  // Apply country-of-interest filter
  if (filters.country_of_interest && filters.country_of_interest !== 'all') {
    query = query.eq('country_of_interest', filters.country_of_interest);
  }

  // Apply partner filter (admin Partners tab)
  if (filters.partner_id) {
    query = query.eq('partner_id', filters.partner_id);
  }

  // Date Applied filter (created_at = when candidate applied)
  if (filters.applied_from) {
    const from = filters.applied_from.endsWith('Z') || filters.applied_from.includes('T')
      ? filters.applied_from
      : `${filters.applied_from}T00:00:00.000Z`;
    query = query.gte('created_at', from);
  }
  if (filters.applied_to) {
    const to = filters.applied_to.endsWith('Z') || filters.applied_to.includes('T')
      ? filters.applied_to
      : `${filters.applied_to}T23:59:59.999Z`;
    query = query.lte('created_at', to);
  }

  // Apply document completeness filter (card-required docs)
  // Complete means: CV + Passport + Certificate + Photo + Medical are present.
  if (filters.documents === 'complete') {
    query = query
      .eq('cv_received', true)
      .eq('passport_received', true)
      .eq('certificate_received', true)
      .eq('photo_received', true)
      .eq('medical_received', true);
  } else if (filters.documents === 'missing') {
    query = query.or(
      'cv_received.eq.false,passport_received.eq.false,certificate_received.eq.false,photo_received.eq.false,medical_received.eq.false'
    );
  }

  // Apply pagination
  if (filters.limit && filters.offset !== undefined) {
    query = query.range(filters.offset, filters.offset + filters.limit - 1);
  } else if (filters.limit) {
    query = query.limit(filters.limit);
  }

  // Multi-column sort (server-side). Default: created_at desc
  const orderCol = filters.sort_by || 'created_at';
  const ascending = filters.sort_order === 'asc';
  query = query.order(orderCol, { ascending });
  if (orderCol !== 'created_at') {
    query = query.order('created_at', { ascending: false }); // secondary tie-break
  }

  const { data, error, count } = await query;

  if (error) throw error;

  // Map passport_normalized to passport for frontend compatibility
  // Frontend expects 'passport' but database only has 'passport_normalized'
  const mappedCandidates = (data || []).map((candidate: any) => ({
    ...candidate,
    cnic: candidate.cnic_normalized || candidate.cnic || null,
    passport: candidate.passport_normalized || candidate.passport || null,
  }));

  return {
    candidates: mappedCandidates,
    total: count,
    limit: filters.limit,
    offset: filters.offset
  };
}

export async function getCandidateBrowseMetadata(userId: string): Promise<CandidateBrowseMetadata> {
  const db = supabaseAdminClient();
  type CandidateBrowseMetadataRow = {
    position?: string | null;
    country_of_interest?: string | null;
    status?: string | null;
    cv_received?: boolean | null;
    passport_received?: boolean | null;
    certificate_received?: boolean | null;
    photo_received?: boolean | null;
    medical_received?: boolean | null;
  };

  // Paginate through ALL records to avoid PostgREST's default max_rows=1000 cap.
  // Without pagination, the single fetch is silently truncated and profession counts
  // are computed from an incomplete dataset, producing wrong totals.
  const PAGE_SIZE = 1000;
  const allRows: CandidateBrowseMetadataRow[] = [];
  let page = 0;
  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await db
      .from('candidates')
      .select([
        'position',
        'country_of_interest',
        'status',
        'cv_received',
        'passport_received',
        'certificate_received',
        'photo_received',
        'medical_received',
      ].join(','))
      .neq('status', 'Deleted')
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...(data as CandidateBrowseMetadataRow[]));
    if (data.length < PAGE_SIZE) break; // last page
    page++;
  }

  const rows = allRows;

  const professionMap = new Map<string, {
    count: number;
    countries: Map<string, number>;
    statuses: Map<string, number>;
    documents: { complete: number; missing: number };
  }>();
  const countryMap = new Map<string, number>();
  const statusMap = new Map<string, number>();

  for (const candidate of rows) {
    const position = (candidate.position || '').trim();
    const country = (candidate.country_of_interest || '').trim();
    const status = ((candidate.status || 'Applied') as string).trim() || 'Applied';
    const hasCompleteDocuments = Boolean(
      candidate.cv_received &&
      candidate.passport_received &&
      candidate.certificate_received &&
      candidate.photo_received &&
      candidate.medical_received
    );

    if (position) {
      let entry = professionMap.get(position);
      if (!entry) {
        entry = {
          count: 0,
          countries: new Map<string, number>(),
          statuses: new Map<string, number>(),
          documents: { complete: 0, missing: 0 },
        };
        professionMap.set(position, entry);
      }

      entry.count += 1;
      entry.statuses.set(status, (entry.statuses.get(status) || 0) + 1);
      if (country) {
        entry.countries.set(country, (entry.countries.get(country) || 0) + 1);
      }
      if (hasCompleteDocuments) {
        entry.documents.complete += 1;
      } else {
        entry.documents.missing += 1;
      }
    }

    if (country) {
      countryMap.set(country, (countryMap.get(country) || 0) + 1);
    }
    statusMap.set(status, (statusMap.get(status) || 0) + 1);
  }

  const toSortedCountItems = (map: Map<string, number>): CandidateBrowseCountItem[] =>
    Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => left.name.localeCompare(right.name));

  return {
    totalCandidates: rows.length,
    professions: Array.from(professionMap.entries())
      .map(([name, entry]) => ({
        name,
        count: entry.count,
        countries: toSortedCountItems(entry.countries),
        statuses: toSortedCountItems(entry.statuses),
        documents: entry.documents,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    countries: toSortedCountItems(countryMap),
    statuses: toSortedCountItems(statusMap),
  };
}

export interface DailyStatsFilters {
  applied_from?: string;
  applied_to?: string;
  position?: string;
  country_of_interest?: string;
  documents?: 'complete' | 'missing' | string;
  search?: string;
}

export interface DailyStats {
  total_candidates: number;
  total: number;
  applied: number;
  verified: number;
  pending: number;
  rejected: number;
  documents_uploaded: number;
}

export interface CandidateDashboardStats {
  totalCandidates: number;
  totalProfessions: number;
  pendingReview: number;
  deployed: number;
  newThisWeek: number;
  totalPartners: number;
  totalEmployers: number;
}

/** Daily summary for Excel-style report cards. Respects same filters as list (date range, folder, search). */
export async function getDailyStats(filters: DailyStatsFilters, userId: string): Promise<DailyStats> {
  const db = supabaseAdminClient();
  const normalizedSearch = (filters.search || '').trim();
  const normalizedSearchLower = normalizedSearch.toLowerCase();
  const genderSearch = (normalizedSearchLower === 'female' || normalizedSearchLower === 'females')
    ? 'Female'
    : (normalizedSearchLower === 'male' || normalizedSearchLower === 'males')
      ? 'Male'
      : (normalizedSearchLower === 'other' || normalizedSearchLower === 'others')
        ? 'Other'
        : null;

  function buildBaseQuery(options?: { includeDateFilters?: boolean }) {
    let q = db.from('candidates').select('id', { count: 'exact' });
    q = q.neq('status', 'Deleted');
    if (normalizedSearch) {
      if (genderSearch) {
        q = q.eq('gender', genderSearch);
      } else {
        q = q.or(`name.ilike.%${normalizedSearch}%,email.ilike.%${normalizedSearch}%,phone.ilike.%${normalizedSearch}%,passport_normalized.ilike.%${normalizedSearch}%,cnic_normalized.ilike.%${normalizedSearch}%`);
      }
    }
    if (filters.position && filters.position !== 'all') q = q.eq('position', filters.position);
    if (filters.country_of_interest && filters.country_of_interest !== 'all') q = q.eq('country_of_interest', filters.country_of_interest);
    if (options?.includeDateFilters !== false && filters.applied_from) {
      const from = filters.applied_from.endsWith('Z') || filters.applied_from.includes('T') ? filters.applied_from : `${filters.applied_from}T00:00:00.000Z`;
      q = q.gte('created_at', from);
    }
    if (options?.includeDateFilters !== false && filters.applied_to) {
      const to = filters.applied_to.endsWith('Z') || filters.applied_to.includes('T') ? filters.applied_to : `${filters.applied_to}T23:59:59.999Z`;
      q = q.lte('created_at', to);
    }
    if (filters.documents === 'complete') {
      q = q.eq('cv_received', true).eq('passport_received', true).eq('certificate_received', true).eq('photo_received', true).eq('medical_received', true);
    } else if (filters.documents === 'missing') {
      q = q.or('cv_received.eq.false,passport_received.eq.false,certificate_received.eq.false,photo_received.eq.false,medical_received.eq.false');
    }
    return q.limit(0);
  }

  const [totalCandidatesRes, totalRes, appliedRes, verifiedRes, pendingRes, rejectedRes, docsRes] = await Promise.all([
    db.from('candidates').select('id', { count: 'exact' }).neq('status', 'Deleted').limit(0),
    buildBaseQuery(),
    buildBaseQuery().eq('status', 'Applied'),
    buildBaseQuery().eq('status', 'Deployed'),
    buildBaseQuery().eq('status', 'Pending'),
    buildBaseQuery().eq('status', '__unused__'),
    buildBaseQuery().or('cv_received.eq.true,passport_received.eq.true'),
  ]);

  return {
    total_candidates: totalCandidatesRes.count ?? 0,
    total: totalRes.count ?? 0,
    applied: appliedRes.count ?? 0,
    verified: verifiedRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    rejected: 0,
    documents_uploaded: docsRes.count ?? 0,
  };
}

export async function getCandidateDashboardStats(userId: string): Promise<CandidateDashboardStats> {
  const db = supabaseAdminClient();
  const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalCandidatesRes,
    pendingReviewRes,
    deployedRes,
    newThisWeekRes,
    partnersRes,
    employersRes,
  ] = await Promise.all([
    db.from('candidates').select('id', { count: 'exact' }).neq('status', 'Deleted').limit(0),
    db.from('candidates').select('id', { count: 'exact' }).neq('status', 'Deleted').eq('needs_review', true).limit(0),
    db.from('candidates').select('id', { count: 'exact' }).neq('status', 'Deleted').eq('status', 'Deployed').limit(0),
    db.from('candidates').select('id', { count: 'exact' }).neq('status', 'Deleted').gte('created_at', weekAgoIso).limit(0),
    db.from('users').select('id', { count: 'exact' }).eq('role', 'partner').limit(0),
    db.from('users').select('id', { count: 'exact' }).eq('role', 'employer').limit(0),
  ]);

  // Paginate through all candidates to get distinct professions — Supabase max_rows caps single queries at 1000
  const distinctProfessions = new Set<string>();
  let pg = 0;
  const PG = 1000;
  while (true) {
    const { data: posData } = await db
      .from('candidates')
      .select('position')
      .neq('status', 'Deleted')
      .not('position', 'is', null)
      .range(pg * PG, (pg + 1) * PG - 1);
    if (!posData || posData.length === 0) break;
    posData.forEach((row: any) => {
      const p = String(row.position || '').trim();
      if (p) distinctProfessions.add(p);
    });
    if (posData.length < PG) break;
    pg++;
  }

  return {
    totalCandidates: totalCandidatesRes.count ?? 0,
    totalProfessions: distinctProfessions.size,
    pendingReview: pendingReviewRes.count ?? 0,
    deployed: deployedRes.count ?? 0,
    newThisWeek: newThisWeekRes.count ?? 0,
    totalPartners: partnersRes.count ?? 0,
    totalEmployers: employersRes.count ?? 0,
  };
}

/** Export candidates to CSV or Excel. Returns buffer and filename. */
export async function exportCandidates(
  filters: CandidateFilters,
  format: 'csv' | 'xlsx',
  userId: string
): Promise<{ buffer: Buffer; filename: string }> {
  // Fetch all candidates matching filters (no pagination)
  const exportFilters = { ...filters, limit: undefined, offset: undefined };
  const result = await listCandidates(exportFilters, userId);
  const candidates = result.candidates || [];

  if (format === 'csv') {
    return exportToCSV(candidates);
  } else {
    return exportToExcel(candidates);
  }
}

function exportToCSV(candidates: any[]): { buffer: Buffer; filename: string } {
  if (candidates.length === 0) {
    return { buffer: Buffer.from(''), filename: `candidates_${new Date().toISOString().split('T')[0]}.csv` };
  }

  // Get frontend URL from environment
  const frontendUrl = resolveFrontendUrl(process.env.FRONTEND_URL);
  const apiBaseUrl = resolveBackendApiBaseUrl(process.env.BACKEND_URL);

  // CSV headers - now includes Profile Link and Employer CV
  const headers = [
    'ID', 'Code', 'Name', 'Email', 'Phone', 'Position', 'Nationality', 'Country of Interest',
    'Status', 'Age', 'Experience (Years)', 'Date of Birth', 'Gender', 'Marital Status',
    'Passport', 'CNIC', 'Passport Expiry', 'Address', 'Profile Link', 'Employer CV', 'Applied Date', 'Updated Date'
  ];

  // Build CSV rows
  const rows = [headers.join(',')];
  for (const c of candidates) {
    const age = c.date_of_birth ? calculateAgeFromDOB(c.date_of_birth) : '';
    const slug = (c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const profileLink = `${frontendUrl}/profile/${c.id}/${slug}`;
    const cvLink = `${apiBaseUrl}/cv-generator/${c.id}/download?format=employer-safe&force=true`;

    const row = [
      c.id || '',
      c.candidate_code || '',
      escapeCSV(c.name || ''),
      escapeCSV(c.email || ''),
      escapeCSV(c.phone || ''),
      escapeCSV(c.position || ''),
      escapeCSV(c.nationality || ''),
      escapeCSV(c.country_of_interest || ''),
      escapeCSV(c.status || ''),
      age,
      c.experience_years || '',
      c.date_of_birth || '',
      escapeCSV(c.gender || ''),
      escapeCSV(c.marital_status || ''),
      escapeCSV(c.passport || ''),
      escapeCSV(c.cnic || ''),
      c.passport_expiry || '',
      escapeCSV(c.address || ''),
      profileLink,
      cvLink,
      c.created_at || '',
      c.updated_at || ''
    ];
    rows.push(row.join(','));
  }

  const csv = rows.join('\n');
  const buffer = Buffer.from(csv, 'utf-8');
  const filename = `candidates_${new Date().toISOString().split('T')[0]}.csv`;
  return { buffer, filename };
}

function exportToExcel(candidates: any[]): { buffer: Buffer; filename: string } {
  const XLSX = require('xlsx');

  if (candidates.length === 0) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['No candidates to export']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return { buffer, filename: `candidates_${new Date().toISOString().split('T')[0]}.xlsx` };
  }

  // Get frontend URL from environment
  const frontendUrl = resolveFrontendUrl(process.env.FRONTEND_URL);
  const apiBaseUrl = resolveBackendApiBaseUrl(process.env.BACKEND_URL);

  // Build data array with headers
  const data: any[][] = [[
    'ID', 'Code', 'Name', 'Email', 'Phone', 'Position', 'Nationality', 'Country of Interest',
    'Status', 'Age', 'Experience (Years)', 'Date of Birth', 'Gender', 'Marital Status',
    'Passport', 'CNIC', 'Passport Expiry', 'Address', 'Profile Link', 'Employer CV', 'Applied Date', 'Updated Date'
  ]];

  // Add candidate rows
  for (const c of candidates) {
    const age = c.date_of_birth ? calculateAgeFromDOB(c.date_of_birth) : '';
    const slug = (c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const profileLink = `${frontendUrl}/profile/${c.id}/${slug}`;
    const cvLink = `${apiBaseUrl}/cv-generator/${c.id}/download?format=employer-safe&force=true`;

    data.push([
      c.id || '',
      c.candidate_code || '',
      c.name || '',
      c.email || '',
      c.phone || '',
      c.position || '',
      c.nationality || '',
      c.country_of_interest || '',
      c.status || '',
      age,
      c.experience_years || '',
      c.date_of_birth || '',
      c.gender || '',
      c.marital_status || '',
      c.passport || '',
      c.cnic || '',
      c.passport_expiry || '',
      c.address || '',
      profileLink, // Profile Link column (will be converted to hyperlink)
      cvLink, // Employer CV column (will be converted to hyperlink)
      c.created_at || '',
      c.updated_at || ''
    ]);
  }

  // Create worksheet from data
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Add hyperlinks to Profile Link (column S, index 18) and Employer CV (column T, index 19)
  // Excel uses A1 notation (A=0, B=1, ..., S=18, T=19)
  for (let row = 2; row <= candidates.length + 1; row++) { // Start from row 2 (skip header)
    const profileCell = XLSX.utils.encode_cell({ r: row - 1, c: 18 }); // Column S (Profile Link)
    const cvCell = XLSX.utils.encode_cell({ r: row - 1, c: 19 }); // Column T (Employer CV)

    if (ws[profileCell]) {
      ws[profileCell].l = { Target: ws[profileCell].v, Tooltip: 'Click to open profile' };
      ws[profileCell].s = { font: { color: { rgb: '0563C1' }, underline: true } };
    }

    if (ws[cvCell]) {
      ws[cvCell].l = { Target: ws[cvCell].v, Tooltip: 'Click to open employer CV' };
      ws[cvCell].s = { font: { color: { rgb: '7030A0' }, underline: true } };
    }
  }

  // Set column widths
  ws['!cols'] = [
    { wch: 36 }, // ID
    { wch: 12 }, // Code
    { wch: 20 }, // Name
    { wch: 25 }, // Email
    { wch: 15 }, // Phone
    { wch: 20 }, // Position
    { wch: 15 }, // Nationality
    { wch: 15 }, // Country of Interest
    { wch: 12 }, // Status
    { wch: 5 },  // Age
    { wch: 12 }, // Experience
    { wch: 12 }, // DOB
    { wch: 10 }, // Gender
    { wch: 12 }, // Marital Status
    { wch: 15 }, // Passport
    { wch: 15 }, // CNIC
    { wch: 12 }, // Passport Expiry
    { wch: 30 }, // Address
    { wch: 60 }, // Profile Link
    { wch: 60 }, // Employer CV
    { wch: 20 }, // Applied Date
    { wch: 20 }  // Updated Date
  ];

  // Create workbook and add worksheet
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Candidates');

  // Write to buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `candidates_${new Date().toISOString().split('T')[0]}.xlsx`;

  return { buffer, filename };
}

function escapeCSV(value: string): string {
  if (!value) return '';
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  const str = String(value).replace(/"/g, '""');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str}"`;
  }
  return str;
}

function calculateAgeFromDOB(dateOfBirth: string): number | '' {
  if (!dateOfBirth) return '';
  try {
    const birthDate = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  } catch {
    return '';
  }
}

export async function bulkUpdateCandidateStatus(
  candidateIds: string[],
  status: CandidateStatus | string,
  userId: string
) {
  const db = supabaseAdminClient();

  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    throw new Error('candidateIds must be a non-empty array');
  }

  const normalizedStatus = parseCandidateStatus(status);

  const { data, error } = await db
    .from('candidates')
    .update({ status: normalizedStatus, updated_at: new Date().toISOString() })
    .in('id', candidateIds)
    .select('id,status');

  if (error) throw error;

  return {
    updated: (data || []).length,
    candidates: data || [],
  };
}

export async function updateCandidate(id: string, data: Partial<CreateCandidateData>, userId: string) {
  const db = supabaseAdminClient();

  // Normalize identifiers if provided
  const updateData: any = { ...data };
  if (data.status !== undefined) {
    updateData.status = parseCandidateStatus(data.status, 'Applied');
  }
  if (data.payment_amount !== undefined) {
    updateData.payment_amount = parseCandidatePaymentAmount(data.payment_amount, 0);
  }
  if (data.cnic) {
    updateData.cnic_normalized = normalizeCNIC(data.cnic);
  }
  if (data.passport) {
    updateData.passport_normalized = normalizePassport(data.passport);
  }
  if (data.phone) {
    updateData.phone = normalizePhoneE164(data.phone);
  }

  // Validate profile_photo_url if provided (accept all valid image URLs including CV-extracted photos)
  if (data.profile_photo_url && typeof data.profile_photo_url === 'string') {
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
    const url = data.profile_photo_url.toLowerCase();
    const extMatch = url.match(/\.([a-z0-9]+)(?:\?|#|$)/);

    // Accept all valid image URLs including CV-extracted photos
    if (!(extMatch && allowedExts.includes(extMatch[1]))) {
      console.warn(`[ProfilePhotoValidation] Rejected non-image profile_photo_url for update: ${data.profile_photo_url}`);
      // Remove invalid profile_photo_url from update
      delete updateData.profile_photo_url;
    } else {
      console.log(`[ProfilePhotoValidation] Accepted profile photo URL for update: ${data.profile_photo_url}`);
    }
  }

  // Check for duplicates (excluding current candidate)
  if (data.cnic || data.passport) {
    const duplicates = await checkForDuplicates(data.cnic, data.passport, id);
    if (duplicates.length > 0) {
      throw new Error(`Duplicate candidate found: ${duplicates[0].name} (${duplicates[0].matchReason})`);
    }
  }

  updateData.updated_at = new Date().toISOString();

  // Truncate VARCHAR-limited fields to prevent 22001 overflow errors
  const VARCHAR_LIMITS: Record<string, number> = {
    name: 255, email: 255, phone: 50, position: 255, education: 255,
    nationality: 100, country_of_interest: 100, marital_status: 20, gender: 20,
    father_name: 255,
    professional_summary: 255,
    skills: 255,
    languages: 255,
    certifications: 255,
    internships: 255,
    previous_employment: 255,
    address: 255,
  };
  for (const [col, maxLen] of Object.entries(VARCHAR_LIMITS)) {
    if (typeof updateData[col] === 'string' && updateData[col].length > maxLen) {
      updateData[col] = updateData[col].slice(0, maxLen);
    }
  }

  // Strip unknown columns to prevent PGRST204 schema errors
  const KNOWN_CANDIDATE_COLUMNS_UPDATE = new Set([
    'name', 'father_name', 'email', 'phone', 'date_of_birth', 'gender',
    'marital_status', 'address', 'cnic_normalized', 'passport_normalized',
    'nationality', 'position', 'experience_years', 'country_of_interest',
    'skills', 'languages', 'education', 'certifications', 'internships',
    'previous_employment', 'passport_expiry', 'professional_summary',
    'status', 'payment_amount', 'source', 'ai_score', 'auto_extracted', 'needs_review',
    'partner_id', 'partner_name', 'is_partner_candidate',
    'updated_at', 'field_sources', 'extraction_confidence', 'extraction_source',
    'extracted_at', 'passport_received', 'cnic_received', 'degree_received',
    'medical_received', 'visa_received', 'cv_received', 'photo_received',
    'certificate_received', 'profile_photo_url',
    'driving_license_received',
    // Excel data fields
    'religion', 'salary_expectation', 'date_available', 'interview_date',
    'medical_expiry', 'license', 'gcc_years',
    // Social links
    'youtube_link',
  ]);
  for (const col of Object.keys(updateData)) {
    if (!KNOWN_CANDIDATE_COLUMNS_UPDATE.has(col)) {
      console.warn(`[CandidateService] Stripping unknown column '${col}' from updateCandidate`);
      delete updateData[col];
    }
  }

  const { data: candidate, error } = await db
    .from('candidates')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  // Log timeline event
  try {
    await logProfileUpdated(id, userId, {
      fields_updated: Object.keys(data),
    });
  } catch (timelineError) {
    console.error('Failed to log timeline event:', timelineError);
  }

  return candidate;
}

export async function deleteCandidate(id: string, userId: string) {
  const db = supabaseAdminClient();

  // Soft delete by setting status to 'Deleted'
  const { data, error } = await db
    .from('candidates')
    .update({
      status: 'Deleted',
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}