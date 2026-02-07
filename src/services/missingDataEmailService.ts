import crypto from 'crypto';
import { supabaseAdminClient } from '../config/database';
import { createLogger } from '../utils/errorHandling';
import { sendThreadReply } from './gmailService';

const logger = createLogger('MissingDataEmailService');

type MissingDocKey =
  | 'cv'
  | 'passport'
  | 'cnic'
  | 'driving_license'
  | 'degree'
  | 'medical'
  | 'certificate';

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getCandidatePreferredEmail(candidate: any): string | null {
  const gmailFrom = safeString(candidate?.gmail_from_email).trim();
  const email = safeString(candidate?.email).trim();
  return gmailFrom || email || null;
}

function computeMissingDocs(candidate: any, missingFields: string[]): MissingDocKey[] {
  const flags = {
    cv_received: !!candidate?.cv_received,
    passport_received: !!candidate?.passport_received,
    cnic_received: !!candidate?.cnic_received,
    driving_license_received: !!candidate?.driving_license_received,
    degree_received: !!candidate?.degree_received,
    medical_received: !!candidate?.medical_received,
    certificate_received: !!candidate?.certificate_received,
  };

  const wantsPassport = missingFields.includes('passport') || missingFields.includes('passport_expiry');
  const wantsCnic = missingFields.includes('cnic');
  const wantsLicense = missingFields.includes('driving_license');
  const wantsDegree = missingFields.includes('education');
  const wantsMedical = missingFields.includes('medical_expiry');
  const wantsCertificate = missingFields.includes('certifications');

  const missing: MissingDocKey[] = [];

  // Always-required docs for the loop
  if (!flags.cv_received) missing.push('cv');
  if (!flags.passport_received) missing.push('passport');

  // Conditional docs based on what we're missing
  if (wantsCnic && !flags.cnic_received) missing.push('cnic');
  if (wantsLicense && !flags.driving_license_received) missing.push('driving_license');
  if (wantsDegree && !flags.degree_received) missing.push('degree');
  if (wantsMedical && !flags.medical_received) missing.push('medical');
  if (wantsCertificate && !flags.certificate_received) missing.push('certificate');

  // If we explicitly need passport info, still request passport even if flag says received.
  // (Sometimes the doc exists but the field wasn’t extracted.)
  if (wantsPassport && !missing.includes('passport')) {
    missing.unshift('passport');
  }

  return Array.from(new Set(missing));
}

function docLabel(doc: MissingDocKey): string {
  switch (doc) {
    case 'cv':
      return 'CV / Resume';
    case 'passport':
      return 'Passport';
    case 'cnic':
      return 'CNIC / National ID';
    case 'driving_license':
      return 'Driving License';
    case 'degree':
      return 'Education documents (degree/diploma/transcript)';
    case 'medical':
      return 'Medical report';
    case 'certificate':
      return 'Certificates';
    default:
      return doc;
  }
}

function renderMissingDataEmail(args: {
  candidateId: string;
  candidateName?: string | null;
  missingFields: Array<{ field: string; label: string }>;
  missingDocs: MissingDocKey[];
}): { subject: string; bodyText: string; snapshotHash: string } {
  const name = (args.candidateName || '').trim() || 'Candidate';

  const fieldsBlock = args.missingFields
    .map((f) => `- ${f.label}:`)
    .join('\n');

  const docsBlock = args.missingDocs.length
    ? args.missingDocs.map((d) => `- ${docLabel(d)}`).join('\n')
    : '';

  const machineReadable = [
    'BEGIN_RAP_MISSING_DATA_V1',
    `candidate_id: ${args.candidateId}`,
    'fields:',
    ...args.missingFields.map((f) => `- ${f.field}`),
    'docs:',
    ...args.missingDocs.map((d) => `- ${d}`),
    'END_RAP_MISSING_DATA_V1',
  ].join('\n');

  const subject = 'Missing information for your application';
  const bodyText = [
    `Assalam o Alaikum ${name},`,
    '',
    'Thanks for your application. To complete your profile, please reply to this email with the missing details below (you can type the answers directly in your reply):',
    '',
    fieldsBlock || '- (No fields listed)',
    '',
    args.missingDocs.length
      ? 'Also, please attach clear photos/scans of the following document(s):\n' + docsBlock
      : 'If you have any documents to share (passport/CV), please attach them in your reply.',
    '',
    'Notes:',
    '- Please keep this email thread (reply here).',
    '- Do not send passwords/OTPs.',
    '',
    machineReadable,
    '',
    'JazakAllah.',
  ].join('\n');

  const snapshotHash = sha256(
    JSON.stringify({
      candidate_id: args.candidateId,
      missing_fields: args.missingFields.map((f) => f.field),
      missing_docs: args.missingDocs,
    })
  );

  return { subject, bodyText, snapshotHash };
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export async function maybeSendMissingDataEmail(args: { candidateId: string; trigger: string }) {
  const db = supabaseAdminClient();

  try {
    const { data: candidate, error } = await db
      .from('candidates')
      .select('*')
      .eq('id', args.candidateId)
      .maybeSingle();

    if (error || !candidate) {
      logger.warn('Candidate not found for missing-data email', { candidateId: args.candidateId, error });
      return { sent: false, reason: 'candidate_not_found' } as const;
    }

    const toEmail = getCandidatePreferredEmail(candidate);
    const threadId = safeString(candidate.gmail_thread_id).trim();
    const inReplyTo = safeString(candidate.gmail_last_message_id).trim();
    const lastSubject = safeString(candidate.gmail_last_subject).trim();

    if (!toEmail) {
      return { sent: false, reason: 'missing_email' } as const;
    }

    if (!threadId) {
      return { sent: false, reason: 'missing_thread' } as const;
    }

    const { calculateMissingFields, EXCEL_BROWSER_FIELDS } = await import('./progressiveDataCompletionService');
    const missingFieldsRaw: string[] = calculateMissingFields(candidate);

    const missingFields = missingFieldsRaw.map((field) => ({
      field,
      label: (EXCEL_BROWSER_FIELDS as any)[field] || field,
    }));

    const missingDocs = computeMissingDocs(candidate, missingFieldsRaw);

    if (missingFields.length === 0 && missingDocs.length === 0) {
      if (candidate.missing_data_email_status !== 'completed') {
        await db
          .from('candidates')
          .update({
            missing_data_email_status: 'completed',
            missing_data_email_next_send_at: null,
          })
          .eq('id', args.candidateId);
      }
      return { sent: false, reason: 'nothing_missing' } as const;
    }

    const status = safeString(candidate.missing_data_email_status).trim() || 'inactive';
    const attempts = Number(candidate.missing_data_email_attempts || 0);

    if (status === 'stopped' || status === 'completed') {
      return { sent: false, reason: 'status_blocked' } as const;
    }

    if (attempts >= 3) {
      await db
        .from('candidates')
        .update({
          missing_data_email_status: 'stopped',
          missing_data_email_next_send_at: null,
        })
        .eq('id', args.candidateId);
      return { sent: false, reason: 'max_attempts' } as const;
    }

    const now = new Date();
    const nextSendAt = candidate.missing_data_email_next_send_at
      ? new Date(String(candidate.missing_data_email_next_send_at))
      : null;

    if (nextSendAt && nextSendAt.getTime() > now.getTime()) {
      return { sent: false, reason: 'cooldown' } as const;
    }

    const rendered = renderMissingDataEmail({
      candidateId: args.candidateId,
      candidateName: candidate.name,
      missingFields,
      missingDocs,
    });

    const subject = lastSubject ? `Re: ${lastSubject.replace(/^re:\s*/i, '')}` : rendered.subject;

    await sendThreadReply({
      toEmail,
      subject,
      bodyText: rendered.bodyText,
      threadId,
      inReplyToMessageId: inReplyTo || undefined,
      referencesMessageId: inReplyTo || undefined,
    });

    const newAttempts = attempts + 1;
    const newNextSendAt = addHours(now, 24);

    await db
      .from('candidates')
      .update({
        missing_data_email_status: 'active',
        missing_data_email_attempts: newAttempts,
        missing_data_email_last_sent_at: now.toISOString(),
        missing_data_email_next_send_at: newNextSendAt.toISOString(),
        missing_data_email_last_snapshot_hash: rendered.snapshotHash,
      })
      .eq('id', args.candidateId);

    try {
      await db.from('candidate_missing_data_email_log').insert({
        candidate_id: args.candidateId,
        gmail_thread_id: threadId,
        to_email: toEmail,
        subject,
        body_text: rendered.bodyText,
        missing_fields: missingFieldsRaw,
        missing_docs: missingDocs,
        attempt_no: newAttempts,
        trigger: args.trigger,
      });
    } catch (logErr) {
      logger.warn('Failed to write missing-data email log (non-fatal)', { candidateId: args.candidateId, error: logErr });
    }

    return { sent: true, attempt: newAttempts } as const;
  } catch (err) {
    logger.error('maybeSendMissingDataEmail failed', err, { candidateId: args.candidateId, trigger: args.trigger });
    return { sent: false, reason: 'error' } as const;
  }
}

export async function generateMissingDataEmailContent(args: {
  candidateId: string;
}): Promise<
  | {
      ok: true;
      toEmail: string;
      subject: string;
      bodyText: string;
      missingFields: Array<{ field: string; label: string }>;
      missingDocs: MissingDocKey[];
      snapshotHash: string;
    }
  | { ok: false; reason: string }
> {
  const db = supabaseAdminClient();

  const { data: candidate, error } = await db
    .from('candidates')
    .select('*')
    .eq('id', args.candidateId)
    .maybeSingle();

  if (error || !candidate) {
    return { ok: false, reason: 'candidate_not_found' };
  }

  const toEmail = getCandidatePreferredEmail(candidate);
  if (!toEmail) {
    return { ok: false, reason: 'missing_email' };
  }

  const { calculateMissingFields, EXCEL_BROWSER_FIELDS } = await import('./progressiveDataCompletionService');
  const missingFieldsRaw: string[] = calculateMissingFields(candidate);
  const missingFields = missingFieldsRaw.map((field) => ({
    field,
    label: (EXCEL_BROWSER_FIELDS as any)[field] || field,
  }));
  const missingDocs = computeMissingDocs(candidate, missingFieldsRaw);

  const rendered = renderMissingDataEmail({
    candidateId: args.candidateId,
    candidateName: candidate.name,
    missingFields,
    missingDocs,
  });

  return {
    ok: true,
    toEmail,
    subject: rendered.subject,
    bodyText: rendered.bodyText,
    missingFields,
    missingDocs,
    snapshotHash: rendered.snapshotHash,
  };
}

/**
 * Send standalone missing-data email via Brevo/SMTP for manual CV uploads
 * (not Gmail-threaded). Same missing-fields logic + cooldown/max-attempts.
 */
export async function sendStandaloneMissingDataEmail(args: {
  candidateId: string;
  trigger: string;
}): Promise<{ sent: boolean; reason?: string; attempt?: number }> {
  const db = supabaseAdminClient();

  try {
    const { data: candidate, error } = await db
      .from('candidates')
      .select('*')
      .eq('id', args.candidateId)
      .maybeSingle();

    if (error || !candidate) {
      return { sent: false, reason: 'candidate_not_found' };
    }

    const toEmail = getCandidatePreferredEmail(candidate);
    if (!toEmail) {
      return { sent: false, reason: 'missing_email' };
    }

    const { calculateMissingFields, EXCEL_BROWSER_FIELDS } = await import(
      './progressiveDataCompletionService'
    );
    const missingFieldsRaw: string[] = calculateMissingFields(candidate);

    const missingFields = missingFieldsRaw.map((field) => ({
      field,
      label: (EXCEL_BROWSER_FIELDS as any)[field] || field,
    }));
    const missingDocs = computeMissingDocs(candidate, missingFieldsRaw);

    if (missingFields.length === 0 && missingDocs.length === 0) {
      if (candidate.missing_data_email_status !== 'completed') {
        await db
          .from('candidates')
          .update({
            missing_data_email_status: 'completed',
            missing_data_email_next_send_at: null,
          })
          .eq('id', args.candidateId);
      }
      return { sent: false, reason: 'nothing_missing' };
    }

    const status = safeString(candidate.missing_data_email_status).trim() || 'inactive';
    const attempts = Number(candidate.missing_data_email_attempts || 0);

    if (status === 'stopped' || status === 'completed') {
      return { sent: false, reason: 'status_blocked' };
    }

    if (attempts >= 3) {
      await db
        .from('candidates')
        .update({
          missing_data_email_status: 'stopped',
          missing_data_email_next_send_at: null,
        })
        .eq('id', args.candidateId);
      return { sent: false, reason: 'max_attempts' };
    }

    const now = new Date();
    const nextSendAt = candidate.missing_data_email_next_send_at
      ? new Date(String(candidate.missing_data_email_next_send_at))
      : null;

    if (nextSendAt && nextSendAt.getTime() > now.getTime()) {
      return { sent: false, reason: 'cooldown' };
    }

    const rendered = renderMissingDataEmail({
      candidateId: args.candidateId,
      candidateName: candidate.name,
      missingFields,
      missingDocs,
    });

    // Send via Brevo/emailService (SMTP, not Gmail)
    const { emailService: emailSvc } = await import('./emailService');
    const brevoResult = await emailSvc.sendEmail({
      to: toEmail,
      subject: rendered.subject,
      html: rendered.bodyText,
      text: rendered.bodyText,
    });

    if (!brevoResult) {
      return { sent: false, reason: 'send_failed' };
    }

    const newAttempts = attempts + 1;
    const newNextSendAt = addHours(now, 24);

    await db
      .from('candidates')
      .update({
        missing_data_email_status: 'active',
        missing_data_email_attempts: newAttempts,
        missing_data_email_last_sent_at: now.toISOString(),
        missing_data_email_next_send_at: newNextSendAt.toISOString(),
        missing_data_email_last_snapshot_hash: rendered.snapshotHash,
      })
      .eq('id', args.candidateId);

    try {
      await db.from('candidate_missing_data_email_log').insert({
        candidate_id: args.candidateId,
        gmail_thread_id: null,
        to_email: toEmail,
        subject: rendered.subject,
        body_text: rendered.bodyText,
        missing_fields: missingFieldsRaw,
        missing_docs: missingDocs,
        attempt_no: newAttempts,
        trigger: args.trigger,
      });
    } catch (logErr) {
      logger.warn('Failed to write missing-data email log (non-fatal)', { candidateId: args.candidateId });
    }

    return { sent: true, attempt: newAttempts };
  } catch (err) {
    logger.error('sendStandaloneMissingDataEmail failed', err, { candidateId: args.candidateId });
    return { sent: false, reason: 'error' };
  }
}
