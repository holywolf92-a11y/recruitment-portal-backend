/**
 * Quick Hostinger SMTP test — run with:
 *   node test-hostinger-email.mjs your@email.com
 */
import { createTransport } from 'nodemailer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env manually
const envPath = join(dirname(fileURLToPath(import.meta.url)), '.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const SMTP_USER = env.HOSTINGER_SMTP_USER;
const SMTP_PASS = env.HOSTINGER_SMTP_PASSWORD;
const TO = process.argv[2] || SMTP_USER; // send to self if no arg

if (!SMTP_USER || !SMTP_PASS) {
  console.error('❌  HOSTINGER_SMTP_USER or HOSTINGER_SMTP_PASSWORD not set in .env');
  process.exit(1);
}

console.log(`\n🔧  Connecting to smtp.hostinger.com:465 as ${SMTP_USER} ...`);

const transporter = createTransport({
  host: 'smtp.hostinger.com',
  port: 587,
  secure: false, // STARTTLS
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

try {
  await transporter.verify();
  console.log('✅  SMTP connection verified successfully!\n');

  console.log(`📧  Sending test email to ${TO} ...`);
  const info = await transporter.sendMail({
    from: `"Falisha Jobs" <${SMTP_USER}>`,
    to: TO,
    subject: 'Hostinger SMTP Test — Falisha Jobs',
    text: 'This is a test email from Falisha Jobs (support@falishajobs.com). If you received this, Hostinger SMTP is working correctly.',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;">
        <h2 style="color:#4f46e5;">✅ Hostinger SMTP is working!</h2>
        <p>This test email was sent from <strong>support@falishajobs.com</strong> via Hostinger SMTP.</p>
        <p style="color:#6b7280;font-size:13px;">You can now push the configuration to Railway.</p>
      </div>
    `,
  });

  console.log(`✅  Email sent! Message ID: ${info.messageId}`);
  console.log(`\n🎉  All good — Hostinger SMTP is working. You can now push to Railway.\n`);
} catch (err) {
  console.error('\n❌  SMTP test failed:', err.message);
  if (err.code === 'EAUTH') {
    console.error('   → Authentication failed. Double-check your Hostinger email password.');
  } else if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    console.error('   → Cannot reach smtp.hostinger.com:465. Check your firewall/internet.');
  }
  process.exit(1);
}
