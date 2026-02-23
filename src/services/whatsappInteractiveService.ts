/**
 * WhatsApp Interactive Message Service
 *
 * Wraps Meta's Cloud API for:
 *  - Button messages  (≤ 3 buttons — type: "button")
 *  - List messages    (> 3 options  — type: "list")
 *  - Image messages   (welcome banner, job cards)
 *  - Plain text       (reuse existing sendMessage)
 */

import { createLogger } from '../utils/errorHandling';

const logger = createLogger('WhatsAppInteractive');
const GRAPH_BASE = 'https://graph.facebook.com/v20.0';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WaButton {
  id: string;    // max 256 chars, used to route replies
  title: string; // max 20 chars displayed on button
}

export interface WaListRow {
  id: string;          // max 200 chars
  title: string;       // max 24 chars
  description?: string; // max 72 chars (optional)
}

export interface WaListSection {
  title?: string;  // max 24 chars (optional for single-section lists)
  rows: WaListRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function postToMeta(phoneNumberId: string, accessToken: string, body: object): Promise<any> {
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error('Meta API error', { status: res.status, body: text.slice(0, 400) });
    throw new Error(`WhatsApp API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ─── Exported send functions ──────────────────────────────────────────────────

/**
 * Send a plain text message.
 */
export async function sendText(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  body: string,
): Promise<any> {
  return postToMeta(phoneNumberId, accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { preview_url: false, body },
  });
}

/**
 * Send an image with optional caption.
 * imageUrl must be a publicly accessible HTTPS URL.
 */
export async function sendImage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  imageUrl: string,
  caption?: string,
): Promise<any> {
  return postToMeta(phoneNumberId, accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: {
      link: imageUrl,
      ...(caption ? { caption } : {}),
    },
  });
}

/**
 * Send an interactive BUTTON message (max 3 buttons).
 * Use this for Yes/No, Confirm/Back, or ≤3 quick choices.
 */
export async function sendButtons(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  bodyText: string,
  buttons: WaButton[],
  headerText?: string,
  footerText?: string,
): Promise<any> {
  if (buttons.length > 3) throw new Error('Button messages support max 3 buttons');
  if (buttons.length === 0) throw new Error('At least 1 button required');

  return postToMeta(phoneNumberId, accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(headerText ? { header: { type: 'text', text: headerText } } : {}),
      body: { text: bodyText },
      ...(footerText ? { footer: { text: footerText } } : {}),
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

/**
 * Send an interactive LIST message (supports up to 10 rows per section).
 * Use this for menus with > 3 options.
 * buttonLabel = the label on the "tap to open" button (max 20 chars).
 */
export async function sendList(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  bodyText: string,
  buttonLabel: string,
  sections: WaListSection[],
  headerText?: string,
  footerText?: string,
): Promise<any> {
  return postToMeta(phoneNumberId, accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(headerText ? { header: { type: 'text', text: headerText } } : {}),
      body: { text: bodyText },
      ...(footerText ? { footer: { text: footerText } } : {}),
      action: {
        button: buttonLabel.slice(0, 20),
        sections: sections.map((s) => ({
          ...(s.title ? { title: s.title.slice(0, 24) } : {}),
          rows: s.rows.map((r) => ({
            id: r.id,
            title: r.title.slice(0, 24),
            ...(r.description ? { description: r.description.slice(0, 72) } : {}),
          })),
        })),
      },
    },
  });
}
