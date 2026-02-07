"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const nodemailer_1 = __importDefault(require("nodemailer"));
class EmailService {
    constructor() {
        this.transporter = null;
        this.initializeTransporter();
    }
    initializeTransporter() {
        // Brevo (formerly Sendinblue) SMTP configuration
        const { BREVO_SMTP_HOST, BREVO_SMTP_PORT, BREVO_SMTP_USER, BREVO_SMTP_PASSWORD, BREVO_FROM_EMAIL, BREVO_FROM_NAME } = process.env;
        if (process.env.BREVO_API_KEY) {
            console.log('[EmailService] BREVO_API_KEY detected. SMTP transporter will be skipped.');
            return;
        }
        if (!BREVO_SMTP_USER || !BREVO_SMTP_PASSWORD) {
            console.warn('[EmailService] Brevo SMTP credentials not configured. Email sending will be disabled.');
            return;
        }
        this.transporter = nodemailer_1.default.createTransport({
            host: BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
            port: parseInt(BREVO_SMTP_PORT || '587'),
            secure: false, // true for 465, false for other ports
            auth: {
                user: BREVO_SMTP_USER,
                pass: BREVO_SMTP_PASSWORD,
            },
        });
        console.log('[EmailService] Brevo SMTP transporter initialized');
    }
    async sendEmail(options) {
        const { BREVO_FROM_EMAIL, BREVO_FROM_NAME } = process.env;
        const fromAddress = BREVO_FROM_EMAIL || 'noreply@recruitment.com';
        const fromName = BREVO_FROM_NAME || 'Falisha Recruitment';
        if (process.env.BREVO_API_KEY) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            try {
                const response = await (0, node_fetch_1.default)('https://api.brevo.com/v3/smtp/email', {
                    method: 'POST',
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'api-key': process.env.BREVO_API_KEY,
                    },
                    body: JSON.stringify({
                        sender: {
                            name: fromName,
                            email: fromAddress,
                        },
                        to: [{ email: options.to }],
                        subject: options.subject,
                        htmlContent: options.html,
                        textContent: options.text,
                    }),
                    signal: controller.signal,
                });
                if (!response.ok) {
                    const errorText = await response.text().catch(() => '');
                    throw new Error(`Brevo API error: ${response.status} ${errorText}`);
                }
                console.log('[EmailService] Email sent successfully via Brevo API');
                return true;
            }
            catch (error) {
                const message = error?.name === 'AbortError'
                    ? 'Brevo API request timed out'
                    : error?.message || 'Unknown Brevo API error';
                console.error('[EmailService] Failed to send email via Brevo API:', message);
                throw new Error(`Failed to send email: ${message}`);
            }
            finally {
                clearTimeout(timeoutId);
            }
        }
        if (!this.transporter) {
            console.error('[EmailService] Cannot send email: transporter not initialized');
            throw new Error('Email service not configured. Please set Brevo SMTP credentials or BREVO_API_KEY.');
        }
        try {
            const info = await this.transporter.sendMail({
                from: `"${fromName}" <${fromAddress}>`,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
            });
            console.log('[EmailService] Email sent successfully:', info.messageId);
            return true;
        }
        catch (error) {
            console.error('[EmailService] Failed to send email:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }
    }
    /**
     * Send candidate profiles to employer
     */
    async sendCandidateProfilesToEmployer({ employerEmail, candidates, position, message, }) {
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
                <strong style="color: #111827;">Falisha Recruitment Agency</strong>
              </p>
              <p style="margin: 8px 0 0 0; font-size: 12px; color: #9ca3af;">
                This is an automated message. Please do not reply directly to this email.
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
Falisha Recruitment Agency
    `.trim();
        return this.sendEmail({
            to: employerEmail,
            subject,
            html,
            text,
        });
    }
}
exports.emailService = new EmailService();
