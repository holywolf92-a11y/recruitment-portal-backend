/**
 * Google OAuth Token Generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Run this ONCE on your local machine to generate a refresh_token for any
 * Google account (Gmail + Drive).
 *
 * Usage:
 *   1.  Fill in CLIENT_ID and CLIENT_SECRET below (from Google Cloud Console)
 *   2.  node scripts/get-google-token.js
 *   3.  Open the printed URL in a browser while signed in as cv.falishaoep@gmail.com
 *   4.  Approve the permissions — Google redirects to localhost:3333/?code=...
 *       (the page will show "cannot connect" — that's fine, just copy the ?code= value)
 *   5.  Paste the code here when prompted
 *   6.  Copy the printed refresh_token and add it to Railway env vars
 *
 * Required scopes:
 *   https://www.googleapis.com/auth/gmail.readonly
 *   https://www.googleapis.com/auth/drive.readonly
 */

const readline = require('readline');
const { google } = require('googleapis');

// ── Fill these in ──────────────────────────────────────────────────────────────
const CLIENT_ID     = process.env.GMAIL_CLIENT_ID     || 'PASTE_YOUR_CLIENT_ID_HERE';
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || 'PASTE_YOUR_CLIENT_SECRET_HERE';
// ──────────────────────────────────────────────────────────────────────────────

const REDIRECT_URI = 'http://localhost';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',   // needed to mark as read (optional)
  'https://www.googleapis.com/auth/drive.readonly',
];

async function main() {
  if (CLIENT_ID === 'PASTE_YOUR_CLIENT_ID_HERE') {
    console.error('\n❌  Edit this script first — set CLIENT_ID and CLIENT_SECRET at the top.\n');
    console.error('   Or run: GMAIL_CLIENT_ID=xxx GMAIL_CLIENT_SECRET=yyy node scripts/get-google-token.js\n');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',          // forces refresh_token to be returned
    scope: SCOPES,
  });

  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('STEP 1: Open this URL in your browser while logged in as cv.falishaoep@gmail.com:');
  console.log('\n' + authUrl + '\n');
  console.log('STEP 2: After approving, the browser redirects to localhost:3333 (will show error).');
  console.log('        Copy the "code" value from the URL bar.\n');
  console.log('─────────────────────────────────────────────────────────────────\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.question('Paste the authorization code here: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await oauth2Client.getToken(code.trim());
      oauth2Client.setCredentials(tokens);

      console.log('\n─────────────────────────────────────────────────────────────────');
      console.log('✅  SUCCESS! Add these to Railway / .env:\n');
      console.log(`GMAIL_CLIENT_ID=${CLIENT_ID}`);
      console.log(`GMAIL_CLIENT_SECRET=${CLIENT_SECRET}`);
      if (tokens.refresh_token) {
        console.log(`GMAIL3_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}  # same token works for Drive`);
      } else {
        console.log('\n⚠️   No refresh_token returned. This usually means the account already');
        console.log('    has a token. Go to https://myaccount.google.com/permissions, revoke');
        console.log('    this app, then run this script again.');
      }
      console.log('\nAlso set:');
      console.log('RUN_GMAIL_POLLING=true');
      console.log('RUN_GOOGLE_DRIVE_POLLING=true');
      console.log('GMAIL3_LABELS=   (optional: comma-separated label names, e.g. CVs,Inbox)');
      console.log('GOOGLE_DRIVE_FOLDER_IDS=   (paste folder IDs from Drive URL, comma-separated)');
      console.log('─────────────────────────────────────────────────────────────────\n');
    } catch (err) {
      console.error('\n❌  Failed to exchange code for tokens:', err.message);
      process.exit(1);
    }
  });
}

main();
