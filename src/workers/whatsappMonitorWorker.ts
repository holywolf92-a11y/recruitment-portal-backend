/**
 * WhatsApp Bridge Monitor Worker
 *
 * Polls the WhatsApp bridge /status endpoint every 5 minutes.
 * If any account transitions from "connected" → any other state,
 * or stays in a non-connected state, sends an email alert to the admin.
 *
 * Throttle: one alert per accountId per 60 minutes max.
 */

import { emailService } from '../services/emailService';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('WhatsAppMonitorWorker');

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const ALERT_THROTTLE_MS = 60 * 60 * 1000; // 1 hour between alerts per account

const BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL || 'http://recruitment-whatsapp-bridge.railway.internal:4310';
const ALERT_EMAIL = process.env.WHATSAPP_ALERT_EMAIL || process.env.DUPLICATE_ALERT_EMAIL || 'falishaoep4035@gmail.com';

// In-memory state tracking
const lastKnownStatus = new Map<string, string>(); // accountId → status
const lastAlertSentAt = new Map<string, number>();  // accountId → timestamp

let monitorTimer: NodeJS.Timeout | null = null;

interface BridgeSession {
  accountId: string;
  displayName: string;
  status: string;
  lastError: string | null;
  lastEventAt: string | null;
}

async function fetchBridgeStatus(): Promise<BridgeSession[]> {
  const res = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Bridge /status returned ${res.status}`);
  const data = (await res.json()) as { sessions?: BridgeSession[] };
  return data.sessions ?? [];
}

function canSendAlert(accountId: string): boolean {
  const last = lastAlertSentAt.get(accountId);
  if (!last) return true;
  return Date.now() - last > ALERT_THROTTLE_MS;
}

async function sendDisconnectAlert(session: BridgeSession, previousStatus: string): Promise<void> {
  if (!canSendAlert(session.accountId)) {
    logger.info('Disconnect alert throttled (sent within last hour)', { accountId: session.accountId });
    return;
  }

  const subject = `⚠️ WhatsApp Alert: ${session.displayName} disconnected`;
  const errorLine = session.lastError ? `<p><strong>Error:</strong> ${session.lastError}</p>` : '';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #dc2626; padding: 16px; border-radius: 8px 8px 0 0;">
        <h2 style="color: white; margin: 0;">⚠️ WhatsApp Account Disconnected</h2>
      </div>
      <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
        <p><strong>Account:</strong> ${session.displayName} (${session.accountId})</p>
        <p><strong>Previous status:</strong> ${previousStatus}</p>
        <p><strong>Current status:</strong> ${session.status}</p>
        ${errorLine}
        <p><strong>Detected at:</strong> ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} (PKT)</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <p style="color: #6b7280; font-size: 14px;">
          To reconnect, open the WhatsApp Bridge admin panel and click 
          <strong>Connect</strong> on <strong>${session.displayName}</strong>, 
          then scan the QR code on the phone.
        </p>
        <p style="color: #6b7280; font-size: 14px;">
          Bridge admin: <a href="https://app.falishajobs.com/admin/whatsapp">app.falishajobs.com/admin/whatsapp</a>
        </p>
      </div>
    </div>
  `;

  const text = `WhatsApp Alert: ${session.displayName} (${session.accountId}) is now ${session.status} (was ${previousStatus}).${session.lastError ? ` Error: ${session.lastError}` : ''} Please reconnect via the admin panel.`;

  try {
    await emailService.sendEmail({ to: ALERT_EMAIL, subject, html, text });
    lastAlertSentAt.set(session.accountId, Date.now());
    logger.info('Disconnect alert email sent', { accountId: session.accountId, status: session.status });
  } catch (err) {
    logger.error('Failed to send disconnect alert email', err, { accountId: session.accountId });
  }
}

async function runMonitorCheck(): Promise<void> {
  let sessions: BridgeSession[];
  try {
    sessions = await fetchBridgeStatus();
  } catch (err) {
    logger.warn('Failed to reach WhatsApp bridge /status — skipping check', { err });
    return;
  }

  for (const session of sessions) {
    const prev = lastKnownStatus.get(session.accountId);

    // First poll — just record current state, no alert
    if (prev === undefined) {
      lastKnownStatus.set(session.accountId, session.status);
      continue;
    }

    const wasConnected = prev === 'connected';
    const isNowDisconnected = session.status !== 'connected' && session.status !== 'connecting' && session.status !== 'needs_qr';

    // Alert if: was connected and is now degraded/idle (unexpected drop)
    // OR was degraded/idle and still is after an hour (stuck, hasn't recovered)
    const isUnexpectedDrop = wasConnected && isNowDisconnected;
    const isStuckDisconnected = !wasConnected && isNowDisconnected && canSendAlert(session.accountId);

    if (isUnexpectedDrop || isStuckDisconnected) {
      await sendDisconnectAlert(session, prev);
    }

    lastKnownStatus.set(session.accountId, session.status);
  }
}

export function startWhatsAppMonitor(): void {
  logger.info('Starting WhatsApp bridge monitor', { bridgeUrl: BRIDGE_URL, alertEmail: ALERT_EMAIL, intervalMinutes: POLL_INTERVAL_MS / 60000 });

  // Run first check after 2 minutes (let sessions stabilise on startup)
  setTimeout(() => {
    void runMonitorCheck();
    monitorTimer = setInterval(() => void runMonitorCheck(), POLL_INTERVAL_MS);
  }, 2 * 60 * 1000);
}

export function stopWhatsAppMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}
