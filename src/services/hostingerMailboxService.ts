import { createLogger } from '../utils/errorHandling';
import { createImapClient, ImapConnectionConfig, MailboxAttachment, MailboxMessage } from './imapMailboxService';

const logger = createLogger('HostingerMailboxService');

// Message fetching/parsing now lives in the generic mailbox poller (workers/mailboxPollingEngine).
export type HostingerMailboxAttachment = MailboxAttachment;
export type HostingerMailboxMessage = MailboxMessage;

export function getHostingerImapConnection(): ImapConnectionConfig {
  return {
    host: process.env.HOSTINGER_IMAP_HOST || 'imap.hostinger.com',
    port: parseInt(process.env.HOSTINGER_IMAP_PORT || '993', 10),
    secure: String(process.env.HOSTINGER_IMAP_SECURE || 'true').toLowerCase() !== 'false',
    user: process.env.HOSTINGER_IMAP_USER || process.env.HOSTINGER_SMTP_USER || '',
    pass: process.env.HOSTINGER_IMAP_PASSWORD || process.env.HOSTINGER_SMTP_PASSWORD || '',
  };
}

export function isHostingerImapConfigured(): boolean {
  const cfg = getHostingerImapConnection();
  return !!(cfg.user && cfg.pass);
}

export async function countUnreadHostingerMessages(): Promise<number> {
  const client = createImapClient(getHostingerImapConnection());
  client.on('error', (err: Error) => {
    logger.warn('Hostinger IMAP connection error during unread count', { error: err?.message });
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX', { readOnly: true });

  try {
    const unseenUids = (await client.search({ seen: false })) || [];
    return unseenUids.length;
  } finally {
    lock.release();
    await client.logout().catch((err) => {
      logger.warn('Hostinger IMAP logout failed after unread count', { error: err });
    });
  }
}
