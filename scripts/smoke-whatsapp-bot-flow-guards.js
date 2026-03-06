/*
  Smoke check for critical WhatsApp bot flow guards.
  This script is intentionally lightweight (no test framework dependency).
*/

const fs = require('fs');
const path = require('path');

function assertContains(source, snippet, label) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing ${label}`);
  }
}

function run() {
  const botFile = path.join(__dirname, '..', 'src', 'services', 'whatsappBotService.ts');
  const stateFile = path.join(__dirname, '..', 'src', 'services', 'whatsappBotStateService.ts');

  const botSrc = fs.readFileSync(botFile, 'utf8');
  const stateSrc = fs.readFileSync(stateFile, 'utf8');

  assertContains(botSrc, 'candidate_upload_more', 'candidate upload-more action id');
  assertContains(botSrc, 'MAIN_MENU_DEBOUNCE_MS', 'main menu debounce constant');
  assertContains(botSrc, 'expected_interactive_ids', 'interactive guard state usage');
  assertContains(botSrc, 'That button is from an older menu', 'stale interactive warning');
  assertContains(botSrc, "step === 'post_actions'", 'candidate post-actions step');

  assertContains(stateSrc, 'last_main_menu_at', 'preserved main menu timestamp on reset');
  assertContains(stateSrc, 'expected_interactive_ids = []', 'stale expected ids reset');

  console.log('OK: WhatsApp bot flow guard smoke checks passed');
}

try {
  run();
} catch (err) {
  console.error('FAILED:', err.message || err);
  process.exit(1);
}
