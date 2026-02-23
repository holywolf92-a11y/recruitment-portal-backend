"use strict";
/**
 * WhatsApp Interactive Message Service
 *
 * Wraps Meta's Cloud API for:
 *  - Button messages  (≤ 3 buttons — type: "button")
 *  - List messages    (> 3 options  — type: "list")
 *  - Image messages   (welcome banner, job cards)
 *  - Plain text       (reuse existing sendMessage)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendText = sendText;
exports.sendImage = sendImage;
exports.sendButtons = sendButtons;
exports.sendList = sendList;
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('WhatsAppInteractive');
const GRAPH_BASE = 'https://graph.facebook.com/v20.0';
// ─── Helpers ─────────────────────────────────────────────────────────────────
async function postToMeta(phoneNumberId, accessToken, body) {
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
async function sendText(phoneNumberId, accessToken, to, body) {
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
async function sendImage(phoneNumberId, accessToken, to, imageUrl, caption) {
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
async function sendButtons(phoneNumberId, accessToken, to, bodyText, buttons, headerText, footerText) {
    if (buttons.length > 3)
        throw new Error('Button messages support max 3 buttons');
    if (buttons.length === 0)
        throw new Error('At least 1 button required');
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
async function sendList(phoneNumberId, accessToken, to, bodyText, buttonLabel, sections, headerText, footerText) {
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
