import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { createInboxMessage } from './inboxService';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  auditPayload?: Record<string, unknown>;
}

export interface EmailSendResult {
  sent: boolean;
  provider: 'resend' | 'hostinger-smtp';
  from: string;
  to: string;
  subject: string;
  providerMessageId?: string;
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  private static readonly PRIMARY_FROM_EMAIL = 'support@falishajobs.com';

  private getFromEmail(): string {
    // Enforce a single canonical From address system-wide.
    // Resend domain verification must be completed for this to appear correctly.
    const configured = (process.env.EMAIL_FROM || '').trim();
    const fromEmail = configured || EmailService.PRIMARY_FROM_EMAIL;

    // Hard guarantee: never send from any other address.
    if (fromEmail.toLowerCase() !== EmailService.PRIMARY_FROM_EMAIL) {
      throw new Error(
        `Invalid EMAIL_FROM. This system is locked to ${EmailService.PRIMARY_FROM_EMAIL}. ` +
          `Got: ${fromEmail}`
      );
    }

    return EmailService.PRIMARY_FROM_EMAIL;
  }

  /**
   * Send via Resend HTTP API (HTTPS port 443 — works on Railway).
   * Railway blocks all outbound SMTP ports (25, 465, 587), so SMTP is not
   * usable in production. Resend's REST API is the workaround.
   * Requires RESEND_API_KEY env var and domain falishajobs.com verified on Resend.
   */
  private async auditOutboundEmail(options: EmailOptions, result: EmailSendResult): Promise<void> {
    const externalId = `email_outbound_${result.provider}_${result.providerMessageId || crypto.randomUUID()}`;

    try {
      await createInboxMessage({
        source: 'email_outbound',
        externalMessageId: externalId,
        payload: {
          direction: 'outbound',
          provider: result.provider,
          providerMessageId: result.providerMessageId || null,
          from: result.from,
          to: result.to,
          subject: result.subject,
          text: options.text || null,
          hasHtml: !!options.html,
          sentAt: new Date().toISOString(),
          ...(options.auditPayload || {}),
        },
        status: 'processed',
        receivedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[EmailService] Failed to audit outbound email (non-fatal):', err);
    }
  }

  private async sendViaResend(options: EmailOptions): Promise<EmailSendResult> {
    const apiKey = process.env.RESEND_API_KEY!;
    const fromEmail = this.getFromEmail();
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Falisha Jobs <${fromEmail}>`,
        reply_to: fromEmail,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        ...(options.text ? { text: options.text } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { id?: string };
    console.log('[EmailService] Email sent via Resend', {
      id: data.id,
      to: options.to,
      subject: options.subject,
      from: fromEmail,
    });

    return {
      sent: true,
      provider: 'resend',
      from: fromEmail,
      to: options.to,
      subject: options.subject,
      providerMessageId: data.id,
    };
  }

  private getTransporter(): nodemailer.Transporter {
    // Lazy-initialize so env vars are available (dotenv loads after imports)
    if (!this.transporter) {
      const { HOSTINGER_SMTP_USER, HOSTINGER_SMTP_PASSWORD } = process.env;

      if (!HOSTINGER_SMTP_USER || !HOSTINGER_SMTP_PASSWORD) {
        throw new Error('Email service not configured. Please set HOSTINGER_SMTP_USER and HOSTINGER_SMTP_PASSWORD.');
      }

      this.transporter = nodemailer.createTransport({
        host: 'smtp.hostinger.com',
        port: 465,
        secure: true,  // SSL on port 465
        auth: {
          user: HOSTINGER_SMTP_USER,
          pass: HOSTINGER_SMTP_PASSWORD,
        },
        connectionTimeout: 15000,  // 15s to establish TCP connection
        greetingTimeout: 10000,    // 10s for SMTP greeting
        socketTimeout: 30000,      // 30s of inactivity before abort
      });

      console.log('[EmailService] Hostinger SMTP transporter initialized (local dev)');
    }
    return this.transporter;
  }

  async sendEmailDetailed(options: EmailOptions): Promise<EmailSendResult> {
    // Production: use Resend HTTP API (Railway blocks SMTP ports 25/465/587)
    if (process.env.RESEND_API_KEY) {
      const result = await this.sendViaResend(options);
      await this.auditOutboundEmail(options, result);
      return result;
    }

    // Local dev fallback: Hostinger SMTP (only works outside Railway)
    const fromAddress = this.getFromEmail();
    const transporter = this.getTransporter();

    try {
      const info = await transporter.sendMail({
        from: `"Falisha Jobs" <${fromAddress}>`,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      console.log('[EmailService] Email sent via SMTP:', info.messageId);
      const result: EmailSendResult = {
        sent: true,
        provider: 'hostinger-smtp',
        from: fromAddress,
        to: options.to,
        subject: options.subject,
        providerMessageId: info.messageId || undefined,
      };
      await this.auditOutboundEmail(options, result);
      return result;
    } catch (error: any) {
      console.error('[EmailService] Failed to send email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    const result = await this.sendEmailDetailed(options);
    return result.sent;
  }

  /**
   * Send candidate profiles to employer
   */
  async sendCandidateProfilesToEmployer({
    employerEmail,
    candidates,
    position,
    message,
  }: {
    employerEmail: string;
    candidates: Array<{
      id: string;
      name: string;
      age?: number;
      nationality?: string;
      position?: string;
      profileLink: string;
      cvDownloadLink: string;
    }>;
    position?: string;
    message?: string;
  }): Promise<boolean> {
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const subject = position 
      ? `Candidate Profiles for ${position} - ${date}`
      : `Selected Candidates - ${date}`;

    // Build HTML email
    const candidateRows = candidates
      .map((candidate, index) => {
        const ageInfo = candidate.age ? `, Age: ${candidate.age}` : '';
        const nationalityInfo = candidate.nationality ? `, Nationality: ${candidate.nationality}` : '';
        
        return `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 16px 12px; font-weight: 500; color: #1f2937;">${index + 1}.</td>
            <td style="padding: 16px 12px;">
              <div style="font-weight: 600; color: #111827; margin-bottom: 4px;">${candidate.name}</div>
              <div style="font-size: 14px; color: #6b7280;">${candidate.position || 'N/A'}${ageInfo}${nationalityInfo}</div>
            </td>
            <td style="padding: 16px 12px; text-align: center;">
              <a href="${candidate.profileLink}" 
                 style="display: inline-block; padding: 8px 16px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500;"
                 target="_blank">
                View Profile
              </a>
            </td>
            <td style="padding: 16px 12px; text-align: center;">
              <a href="${candidate.cvDownloadLink}" 
                 style="display: inline-block; padding: 8px 16px; background-color: #8b5cf6; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500;"
                 target="_blank">
                Download CV
              </a>
            </td>
          </tr>
        `;
      })
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
        <div style="max-width: 800px; margin: 0 auto; padding: 40px 20px;">
          <div style="background-color: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px; text-align: center;">
              <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Candidate Profiles</h1>
              <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">${position || 'Selected Candidates'}</p>
            </div>

            <!-- Content -->
            <div style="padding: 32px;">
              <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151; line-height: 1.6;">
                Dear Employer,
              </p>

              ${message ? `
                <div style="padding: 16px; background-color: #f3f4f6; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 24px;">
                  <p style="margin: 0; font-size: 14px; color: #4b5563; line-height: 1.6;">${message.replace(/\n/g, '<br>')}</p>
                </div>
              ` : ''}

              <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151; line-height: 1.6;">
                We have selected <strong>${candidates.length}</strong> candidate${candidates.length > 1 ? 's' : ''} that match your requirements:
              </p>

              <!-- Candidates Table -->
              <table style="width: 100%; border-collapse: collapse; margin: 24px 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f9fafb; border-bottom: 2px solid #e5e7eb;">
                    <th style="padding: 12px; text-align: left; font-size: 14px; font-weight: 600; color: #6b7280; width: 50px;">#</th>
                    <th style="padding: 12px; text-align: left; font-size: 14px; font-weight: 600; color: #6b7280;">Candidate</th>
                    <th style="padding: 12px; text-align: center; font-size: 14px; font-weight: 600; color: #6b7280; width: 140px;">Profile</th>
                    <th style="padding: 12px; text-align: center; font-size: 14px; font-weight: 600; color: #6b7280; width: 140px;">CV</th>
                  </tr>
                </thead>
                <tbody>
                  ${candidateRows}
                </tbody>
              </table>

              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0 0 16px 0; font-size: 14px; color: #6b7280;">
                  <strong>Next Steps:</strong>
                </p>
                <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #6b7280; line-height: 1.8;">
                  <li>Click <strong>View Profile</strong> to see detailed candidate information</li>
                  <li>Click <strong>Download CV</strong> to get the formatted CV document</li>
                  <li>Reply to this email if you need additional information or want to schedule interviews</li>
                </ul>
              </div>
            </div>

            <!-- Footer -->
            <div style="background-color: #f9fafb; padding: 24px 32px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">
                Best regards,<br>
                <strong style="color: #111827;">Falisha Jobs</strong>
              </p>
              <p style="margin: 8px 0 0 0; font-size: 12px; color: #9ca3af;">
                For enquiries, contact us at support@falishajobs.com
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    // Plain text version
    const text = `
Candidate Profiles for ${position || 'Selected Candidates'} - ${date}

Dear Employer,

${message ? message + '\n\n' : ''}We have selected ${candidates.length} candidate${candidates.length > 1 ? 's' : ''} that match your requirements:

${candidates.map((c, i) => {
  const ageInfo = c.age ? `, Age: ${c.age}` : '';
  const nationalityInfo = c.nationality ? `, Nationality: ${c.nationality}` : '';
  return `${i + 1}. ${c.name} (${c.position || 'N/A'}${ageInfo}${nationalityInfo})
   - View Profile: ${c.profileLink}
   - Download CV: ${c.cvDownloadLink}`;
}).join('\n\n')}

Best regards,
Falisha Jobs
support@falishajobs.com
    `.trim();

    return this.sendEmail({
      to: employerEmail,
      subject,
      html,
      text,
    });
  }
}

export const emailService = new EmailService();
