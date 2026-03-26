// src/services/linkedinFollowUpService.ts
//
// Sends a one-time follow-up email to a candidate after their first email reply
// is processed, thanking them and asking them to follow Falisha on LinkedIn.
// Fire-and-forget — failures are logged but never bubble up to the caller.

import { createLogger } from '../utils/errorHandling';

const logger = createLogger('LinkedInFollowUpService');

const LINKEDIN_PAGE_URL = 'https://www.linkedin.com/company/falishaenterprises';

function buildEmail(candidateName: string | null): { subject: string; html: string; text: string } {
  const greeting = candidateName ? `Dear ${candidateName}` : 'Dear Candidate';
  const subject = 'Thank you for your response — Stay connected with Falisha';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;">

        <!-- Header -->
        <tr>
          <td style="background:#0a66c2;padding:28px 40px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;letter-spacing:0.5px;">
              Falisha Manpower
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="color:#333333;font-size:16px;line-height:1.7;margin:0 0 16px;">${greeting},</p>
            <p style="color:#333333;font-size:16px;line-height:1.7;margin:0 0 16px;">
              Thank you for sending us your information — we have received your reply and your
              profile is being reviewed by our team.
            </p>
            <p style="color:#333333;font-size:16px;line-height:1.7;margin:0 0 24px;">
              To stay up to date with the latest <strong>job openings, placement news, and
              international opportunities</strong> from Falisha Manpower, we invite you to follow
              our official LinkedIn company page:
            </p>

            <!-- LinkedIn CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td style="text-align:center;">
                  <a href="${LINKEDIN_PAGE_URL}" target="_blank"
                     style="display:inline-block;background:#0a66c2;color:#ffffff;font-size:15px;
                            font-weight:600;text-decoration:none;padding:14px 36px;border-radius:6px;
                            letter-spacing:0.3px;">
                    &#128100;&nbsp; Follow Falisha on LinkedIn
                  </a>
                </td>
              </tr>
            </table>

            <p style="color:#666666;font-size:14px;line-height:1.6;margin:0 0 8px;">
              Or copy and paste this link in your browser:
            </p>
            <p style="margin:0;">
              <a href="${LINKEDIN_PAGE_URL}" style="color:#0a66c2;font-size:14px;word-break:break-all;">
                ${LINKEDIN_PAGE_URL}
              </a>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #e8e8e8;text-align:center;">
            <p style="color:#999999;font-size:12px;margin:0;">
              Falisha Manpower &bull; support@falishajobs.com
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    greeting + ',',
    '',
    'Thank you for sending us your information — we have received your reply and your profile is being reviewed by our team.',
    '',
    'To stay up to date with the latest job openings and opportunities from Falisha Manpower,',
    'please follow our official LinkedIn company page for further updates:',
    '',
    LINKEDIN_PAGE_URL,
    '',
    'Thank you.',
    'Falisha Manpower',
    'support@falishajobs.com',
  ].join('\n');

  return { subject, html, text };
}

/**
 * Send a one-time LinkedIn follow-up to the candidate.
 * Should only be called when this is the candidate's FIRST processed email reply
 * (i.e. missing_data_email_last_reply_processed_at was null before this run).
 * Fails silently — never throws.
 */
export async function sendLinkedInFollowUp(args: {
  candidateId: string;
  candidateEmail: string;
  candidateName: string | null;
}): Promise<void> {
  if (!args.candidateEmail) return;

  try {
    const { emailService } = await import('./emailService');
    const { subject, html, text } = buildEmail(args.candidateName);

    await emailService.sendEmailDetailed({
      to: args.candidateEmail,
      subject,
      html,
      text,
      auditPayload: {
        candidateId: args.candidateId,
        candidateName: args.candidateName || null,
        kind: 'linkedin_follow_up',
        linkedinUrl: LINKEDIN_PAGE_URL,
      },
    });

    logger.info('LinkedIn follow-up sent', {
      candidateId: args.candidateId,
      to: args.candidateEmail,
    });
  } catch (err) {
    logger.error('Failed to send LinkedIn follow-up (non-fatal)', err, {
      candidateId: args.candidateId,
    });
  }
}
