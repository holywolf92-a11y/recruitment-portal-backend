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
  | 'police_certificate'
  | 'degree';

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function generateTrackingToken(): string {
  // Generate 8-char alphanumeric tracking token (production-grade approach)
  // Format: 2 letters + 6 digits (e.g., FL123456)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const prefix = chars[Math.floor(Math.random() * chars.length)] + chars[Math.floor(Math.random() * chars.length)];
  const numbers = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}${numbers}`;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCandidatePreferredEmail(candidate: any): string | null {
  // IMPORTANT:
  // Always prefer the candidate's extracted email.
  // Do NOT fall back to gmail_from_email because it can be a forwarder/sender
  // and may not belong to the candidate.
  const email = safeString(candidate?.email).trim();
  return email || null;
}

async function maybeBackfillGmailThreadIdentity(candidateId: string): Promise<
  | {
      ok: true;
      threadId: string;
      subject: string | null;
      messageIdHeader: string | null;
      fromEmail: string | null;
    }
  | { ok: false }
> {
  try {
    const db = supabaseAdminClient();

    const { data: candidate } = await db
      .from('candidates')
      .select('id,email,gmail_thread_id,gmail_from_email')
      .eq('id', candidateId)
      .maybeSingle();

    if (!candidate) return { ok: false };
    if (safeString((candidate as any).gmail_thread_id).trim()) return { ok: false };

    const { data: rows, error } = await db
      .from('inbox_attachments')
      .select('inbox_message_id, created_at, inbox_messages (source, payload)')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error || !rows || rows.length === 0) return { ok: false };

    for (const row of rows as any[]) {
      const msg = row?.inbox_messages;
      if (!msg || msg.source !== 'gmail') continue;

      const payload: any = msg.payload || {};
      const threadId = typeof payload.threadId === 'string' ? payload.threadId.trim() : '';
      if (!threadId) continue;

      const subject = typeof payload.subject === 'string' ? payload.subject : null;

      const messageIdHeader =
        typeof payload.messageIdHeader === 'string'
          ? payload.messageIdHeader
          : typeof payload.messageId === 'string'
            ? payload.messageId
            : null;

      const fromRaw = typeof payload.from === 'string' ? payload.from : '';
      const emailMatch = fromRaw.match(/<([^>]+)>/) || fromRaw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
      const fromEmail = (emailMatch?.[1] || emailMatch?.[0] || '').trim() || null;

      const candidateEmail = safeString((candidate as any).email).trim();

      const update: any = {
        gmail_thread_id: threadId,
        gmail_last_subject: subject,
        gmail_last_message_id: messageIdHeader,
      };

      // Only set gmail_from_email if candidate has no real email.
      // This avoids accidentally preferring a forwarding sender over the candidate's actual email.
      if (!candidateEmail && fromEmail) {
        update.gmail_from_email = fromEmail;
      }

      await db.from('candidates').update(update).eq('id', candidateId);

      return { ok: true, threadId, subject, messageIdHeader, fromEmail };
    }

    return { ok: false };
  } catch {
    return { ok: false };
  }
}

async function computeMissingDocsForCandidate(args: {
  candidateId: string;
  candidate: any;
  missingFields: string[];
}): Promise<MissingDocKey[]> {
  const candidate = args.candidate;

  const flags = {
    cv_received: !!candidate?.cv_received,
    passport_received: !!candidate?.passport_received,
    cnic_received: !!candidate?.cnic_received,
    driving_license_received: !!candidate?.driving_license_received,
    degree_received: !!candidate?.degree_received,
  };

  let docs: Array<{ category?: string | null; document_type?: string | null; file_name?: string | null }> = [];
  try {
    const db = supabaseAdminClient();
    const { data } = await db
      .from('candidate_documents')
      .select('category, document_type, file_name')
      .eq('candidate_id', args.candidateId)
      .limit(200);
    docs = (data as any[]) || [];
  } catch {
    // Non-fatal: fallback to flags only.
    docs = [];
  }

  const categories = new Set(
    docs
      .map((d) => (typeof d?.category === 'string' ? d.category.toLowerCase().trim() : ''))
      .filter(Boolean)
  );
  const docTypes = new Set(
    docs
      .map((d) => (typeof d?.document_type === 'string' ? d.document_type.toLowerCase().trim() : ''))
      .filter(Boolean)
  );
  const fileNames = docs
    .map((d) => (typeof d?.file_name === 'string' ? d.file_name.toLowerCase() : ''))
    .filter(Boolean);

  const hasCv = flags.cv_received || categories.has('cv_resume') || categories.has('cv');
  const hasPassport =
    flags.passport_received || categories.has('passport') || docTypes.has('passport') || fileNames.some((n) => n.includes('passport'));
  const hasCnic =
    flags.cnic_received || categories.has('cnic') || docTypes.has('cnic') || fileNames.some((n) => n.includes('cnic') || n.includes('nic'));
  const hasDrivingLicense =
    flags.driving_license_received || categories.has('driving_license') || docTypes.has('driving_license') || fileNames.some((n) => n.includes('driving') || n.includes('license') || n.includes('licence'));
  const hasEducation =
    flags.degree_received || categories.has('educational_documents') || docTypes.has('degree') || fileNames.some((n) => n.includes('degree') || n.includes('diploma') || n.includes('transcript'));
  const hasPolice = categories.has('police_character_certificate') || fileNames.some((n) => n.includes('police'));

  const missing: MissingDocKey[] = [];

  // Only request the core documents requested by the client.
  if (!hasCv) missing.push('cv');
  if (!hasPassport) missing.push('passport');
  if (!hasCnic) missing.push('cnic');
  if (!hasDrivingLicense) missing.push('driving_license');
  if (!hasPolice) missing.push('police_certificate');
  if (!hasEducation) missing.push('degree');

  return Array.from(new Set(missing));
}

function docLabel(doc: MissingDocKey): string {
  switch (doc) {
    case 'cv':
      return '📄 CV / Resume';
    case 'passport':
      return '🛂 Passport';
    case 'cnic':
      return '🪪 CNIC / National ID';
    case 'driving_license':
      return '🚗 Driving License';
    case 'police_certificate':
      return '👮 Police Character Certificate';
    case 'degree':
      return '🎓 Educational Documents';
    default:
      return doc;
  }
}

function renderMissingDataEmail(args: {
  candidateId: string;
  candidateName?: string | null;
  missingFields: Array<{ field: string; label: string }>;
  missingDocs: MissingDocKey[];
  trackingToken?: string;
}): { subject: string; bodyText: string; bodyHtml: string; snapshotHash: string } {
  const name = (args.candidateName || '').trim() || 'Candidate';

  const fieldsLinesText = args.missingFields.map((f) => `${f.label}: `);
  const fieldsBlockText = fieldsLinesText.length ? fieldsLinesText.join('\n') : '';

  const docsLinesText = args.missingDocs.map((d) => `- ${docLabel(d)}`);
  const docsBlockText = docsLinesText.join('\n');

  const fieldsTableRowsHtml = args.missingFields
    .map(
      (f) =>
        `<tr>` +
        `<td style="padding:6px; vertical-align:top;"><strong>${escapeHtml(f.label)}</strong></td>` +
        `<td style="padding:6px; vertical-align:top;">&nbsp;</td>` +
        `</tr>`
    )
    .join('');

  const docsListHtml = args.missingDocs.length
    ? `<ul>${args.missingDocs.map((d) => `<li>${escapeHtml(docLabel(d))}</li>`).join('')}</ul>`
    : '';

  const referenceBlockText = [
    '--- Reference (please keep) ---',
    `RAP_CANDIDATE_ID: ${args.candidateId}`,
  ].join('\n');

  // Embed tracking token in subject for reliable reply matching
  const trackingToken = args.trackingToken || '';
  const subject = trackingToken 
    ? `Action required: please send missing documents [#${trackingToken}]`
    : 'Action required: please send missing documents';
  const bodyText = [
    `Assalam o Alaikum ${name},`,
    '',
    'Thanks for your application. To complete your profile, please share the missing details below and send clear photos/scans of the required documents.',
    '',
    fieldsBlockText ? 'Reply with:' : '',
    fieldsBlockText || '',
    '',
    args.missingDocs.length ? 'Documents needed:' : '',
    args.missingDocs.length ? docsBlockText : '',
    '',
    'Notes:',
    '- Please reply to this same email (keep the thread).',
    '- Do not send passwords/OTPs.',
    '',
    referenceBlockText,
    '',
    'JazakAllah.',
  ].join('\n');

  const bodyHtml = [
    `<p>Assalam o Alaikum ${escapeHtml(name)},</p>`,
    `<p>Thanks for your application. To complete your profile, please share the missing details below and send clear photos/scans of the required documents.</p>`,
    args.missingFields.length
      ? `<p><strong>Reply with:</strong></p>` +
        `<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%;">` +
        `<thead><tr><th align="left" style="padding:6px;">Field</th><th align="left" style="padding:6px;">Answer</th></tr></thead>` +
        `<tbody>${fieldsTableRowsHtml}</tbody>` +
        `</table>`
      : '',
    args.missingDocs.length
      ? `<p><strong>Please attach:</strong></p>${docsListHtml}`
      : '',
    `<p><strong>Notes:</strong></p>`,
    `<ul><li>Please reply to this same email (keep the thread).</li><li>Do not send passwords/OTPs.</li></ul>`,
    `<!-- ${escapeHtml(`RAP_CANDIDATE_ID: ${args.candidateId}`)} -->`,
    `<p>JazakAllah.</p>`,
  ].join('');

  const snapshotHash = sha256(
    JSON.stringify({
      candidate_id: args.candidateId,
      missing_fields: args.missingFields.map((f) => f.field),
      missing_docs: args.missingDocs,
    })
  );

  return { subject, bodyText, bodyHtml, snapshotHash };
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export async function maybeSendMissingDataEmail(args: {
  candidateId: string;
  trigger: string;
  force?: boolean;
}) {
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
    let threadId = safeString(candidate.gmail_thread_id).trim();
    const inReplyTo = safeString(candidate.gmail_last_message_id).trim();
    const lastSubject = safeString(candidate.gmail_last_subject).trim();

    if (!toEmail) {
      return { sent: false, reason: 'missing_email' } as const;
    }

    if (!threadId) {
      const backfill = await maybeBackfillGmailThreadIdentity(args.candidateId);
      if (backfill.ok) {
        threadId = backfill.threadId;
      }
    }

    if (!threadId) return { sent: false, reason: 'missing_thread' } as const;

    const { calculateMissingFields, EXCEL_BROWSER_FIELDS } = await import('./progressiveDataCompletionService');
    const missingFieldsRaw: string[] = Array.from(new Set(calculateMissingFields(candidate)));
    const importantMissingFieldsRaw = missingFieldsRaw.filter((field) =>
      ['country_of_interest', 'salary_expectation'].includes(field)
    );

    const missingFields = importantMissingFieldsRaw.map((field) => ({
      field,
      label: (EXCEL_BROWSER_FIELDS as any)[field] || field,
    }));

    const missingDocs = await computeMissingDocsForCandidate({
      candidateId: args.candidateId,
      candidate,
      missingFields: missingFieldsRaw,
    });

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

    if (!args.force) {
      if (nextSendAt && nextSendAt.getTime() > now.getTime()) {
        return { sent: false, reason: 'cooldown' } as const;
      }
    }

    // Generate or reuse tracking token for reliable email threading
    let trackingToken = safeString(candidate.email_tracking_token).trim();
    if (!trackingToken) {
      trackingToken = generateTrackingToken();
      await db
        .from('candidates')
        .update({ email_tracking_token: trackingToken })
        .eq('id', args.candidateId);
    }

    const rendered = renderMissingDataEmail({
      candidateId: args.candidateId,
      candidateName: candidate.name,
      missingFields,
      missingDocs,
      trackingToken,
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
        missing_fields: importantMissingFieldsRaw,
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
      bodyHtml: string;
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
  const missingFieldsRaw: string[] = Array.from(new Set(calculateMissingFields(candidate)));
  const importantMissingFieldsRaw = missingFieldsRaw.filter((field) =>
    ['country_of_interest', 'salary_expectation'].includes(field)
  );
  const missingFields = importantMissingFieldsRaw.map((field) => ({
    field,
    label: (EXCEL_BROWSER_FIELDS as any)[field] || field,
  }));
  const missingDocs = await computeMissingDocsForCandidate({
    candidateId: args.candidateId,
    candidate,
    missingFields: missingFieldsRaw,
  });

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
    bodyHtml: rendered.bodyHtml,
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
  force?: boolean;
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
    const missingFieldsRaw: string[] = Array.from(new Set(calculateMissingFields(candidate)));
    const importantMissingFieldsRaw = missingFieldsRaw.filter((field) =>
      ['country_of_interest', 'salary_expectation'].includes(field)
    );

    const missingFields = importantMissingFieldsRaw.map((field) => ({
      field,
      label: (EXCEL_BROWSER_FIELDS as any)[field] || field,
    }));
    const missingDocs = await computeMissingDocsForCandidate({
      candidateId: args.candidateId,
      candidate,
      missingFields: missingFieldsRaw,
    });

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

    if (!args.force) {
      if (nextSendAt && nextSendAt.getTime() > now.getTime()) {
        return { sent: false, reason: 'cooldown' };
      }
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
      html: rendered.bodyHtml,
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
        missing_fields: importantMissingFieldsRaw,
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
