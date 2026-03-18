import { createTransport } from 'nodemailer';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('.env', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const user = env.HOSTINGER_SMTP_USER;
const pass = env.HOSTINGER_SMTP_PASSWORD;

console.log('User:', user);
console.log('Pass length:', pass?.length);

const t = createTransport({ host: 'smtp.hostinger.com', port: 587, secure: false, auth: { user, pass } });

await t.verify();
console.log('✅ Connection OK');

const info = await t.sendMail({
  from: `"Falisha Jobs" <${user}>`,
  to: user,
  subject: 'Hostinger SMTP Test ✅',
  text: 'Hostinger SMTP is working on port 587!',
  html: '<b>Hostinger SMTP is working on port 587!</b>',
});
console.log('✅ Email sent:', info.messageId);
