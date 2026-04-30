import crypto from 'crypto';
import { supabaseAdminClient } from '../config/database';
import { resolveFrontendUrl } from '../utils/publicUrl';
import { emailService } from './emailService';
import { upsertAppUserProfile } from './userService';
import { sendMessage } from './whatsappService';

const FRONTEND_URL = resolveFrontendUrl(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || undefined);

export type PortalAudience = 'candidate' | 'partner' | 'employer';

export type PortalAccessDeliveryResult = {
  autoLoginUrl: string | null;
  dashboardUrl: string;
  email: { attempted: boolean; sent: boolean; error?: string | null };
  whatsapp: { attempted: boolean; sent: boolean; to?: string | null; error?: string | null };
};

export type PortalAccountResult = {
  created: boolean;
  password: string | null;
  userId: string | null;
  dashboardUrl: string;
  autoLoginUrl: string | null;
};

function generateTemporaryPassword(): string {
  return `Falisha!${crypto.randomBytes(4).toString('hex')}`;
}

async function findExistingAuthUserByEmail(email?: string | null) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const supabase = supabaseAdminClient();
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    throw error;
  }

  return data.users.find((user) => String(user.email || '').trim().toLowerCase() === normalizedEmail) || null;
}

function toWhatsAppPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function toRoleLabel(role: PortalAudience): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function buildPortalDashboardUrl(role: PortalAudience): string {
  return `${FRONTEND_URL}/${role}/dashboard`;
}

export async function ensurePortalAccount(args: {
  email: string;
  role: 'partner' | 'employer';
  name?: string | null;
  phone?: string | null;
  companyName?: string | null;
  partnerApplicationId?: string | null;
  employerLeadId?: string | null;
}): Promise<PortalAccountResult> {
  const normalizedEmail = String(args.email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return {
      created: false,
      password: null,
      userId: null,
      dashboardUrl: buildPortalDashboardUrl(args.role),
      autoLoginUrl: null,
    };
  }

  const supabase = supabaseAdminClient();
  const existingAuthUser = await findExistingAuthUserByEmail(normalizedEmail);
  const password = existingAuthUser ? null : generateTemporaryPassword();

  const authUser = existingAuthUser || (await (async () => {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password: password!,
      email_confirm: true,
      user_metadata: {
        name: args.name || args.companyName || null,
        phone: args.phone || null,
        role: args.role,
        company_name: args.companyName || null,
      },
    });

    if (error) {
      throw error;
    }

    return created.user;
  })());

  await upsertAppUserProfile({
    id: authUser.id,
    email: authUser.email || normalizedEmail,
    role: args.role,
    name: args.name || args.companyName || null,
    phone: args.phone || null,
    status: 'Active',
  });

  if (args.partnerApplicationId) {
    await supabase
      .from('partner_applications')
      .update({ user_id: authUser.id, updated_at: new Date().toISOString() })
      .eq('id', args.partnerApplicationId);
  }

  if (args.employerLeadId) {
    await supabase
      .from('employer_leads')
      .update({ user_id: authUser.id, updated_at: new Date().toISOString() })
      .eq('id', args.employerLeadId);
  }

  return {
    created: !existingAuthUser,
    password,
    userId: authUser.id,
    dashboardUrl: buildPortalDashboardUrl(args.role),
    autoLoginUrl: await createPortalAutoLoginUrl(normalizedEmail, args.role),
  };
}

export async function createPortalAutoLoginUrl(email: string, role: PortalAudience): Promise<string | null> {
  const supabase = supabaseAdminClient();

  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: buildPortalDashboardUrl(role),
      },
    });

    if (error) {
      throw error;
    }

    return data?.properties?.action_link || null;
  } catch (error: any) {
    console.error('[PortalAccess] Failed to create auto-login link:', error?.message || error);
    return null;
  }
}

export async function dispatchPortalAccessLink(user: {
  name: string | null;
  email: string;
  phone?: string | null;
  role: PortalAudience;
  autoLoginUrl?: string | null;
}): Promise<PortalAccessDeliveryResult> {
  const displayName = user.name || user.email;
  const roleLabel = toRoleLabel(user.role);
  const dashboardUrl = buildPortalDashboardUrl(user.role);
  const autoLoginUrl = user.autoLoginUrl ?? await createPortalAutoLoginUrl(user.email, user.role);

  const delivery: PortalAccessDeliveryResult = {
    autoLoginUrl,
    dashboardUrl,
    email: { attempted: true, sent: false, error: null },
    whatsapp: { attempted: !!user.phone, sent: false, to: null, error: null },
  };

  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1d4ed8">Welcome to Falisha Jobs Portal</h2>
      <p>Hi <strong>${displayName}</strong>,</p>
      <p>Your <strong>${roleLabel}</strong> portal is ready.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:8px;background:#f3f4f6;font-weight:bold;width:160px">Dashboard</td><td style="padding:8px"><a href="${dashboardUrl}">${dashboardUrl}</a></td></tr>
        <tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">Login Email</td><td style="padding:8px">${user.email}</td></tr>
        ${autoLoginUrl ? `<tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">Direct Access Link</td><td style="padding:8px"><a href="${autoLoginUrl}">Open your portal instantly</a></td></tr>` : ''}
      </table>
      <p style="color:#6b7280;font-size:13px">This secure link signs you into the portal directly. If it expires, contact Falisha support for a fresh access link.</p>
      <p>Regards,<br/>Falisha Jobs Team</p>
    </div>
  `;

  const emailText = [
    'Welcome to Falisha Jobs Portal!',
    '',
    `Dashboard: ${dashboardUrl}`,
    `Login Email: ${user.email}`,
    autoLoginUrl ? `Direct Access Link: ${autoLoginUrl}` : 'Direct access link is temporarily unavailable. Open the dashboard URL and request a fresh access link if needed.',
  ].join('\n');

  try {
    const emailResult = await emailService.sendEmailDetailed({
      to: user.email,
      subject: 'Your Falisha Jobs Portal Access Link',
      html: emailHtml,
      text: emailText,
    });

    delivery.email.sent = emailResult.sent;
    if (!emailResult.sent) {
      delivery.email.error = `Email provider ${emailResult.provider} did not confirm delivery`;
    }
  } catch (error: any) {
    delivery.email.error = error?.message || 'Unknown email delivery error';
    console.error('[PortalAccess] Failed to send access email:', delivery.email.error);
  }

  if (user.phone) {
    const waPhone = toWhatsAppPhone(user.phone);
    delivery.whatsapp.to = waPhone;

    const waText = [
      `Welcome to Falisha Jobs Portal! 🎉`,
      '',
      `Hi ${displayName}, your ${roleLabel} account is ready.`,
      '',
      `Dashboard: ${dashboardUrl}`,
      `Login Email: ${user.email}`,
      autoLoginUrl ? `Direct Access Link: ${autoLoginUrl}` : 'Direct access link is temporarily unavailable. Open the dashboard URL and request a fresh access link if needed.',
    ].join('\n');

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (phoneNumberId && accessToken && waPhone) {
      try {
        await sendMessage(phoneNumberId, accessToken, waPhone, waText);
        delivery.whatsapp.sent = true;
      } catch (error: any) {
        delivery.whatsapp.error = error?.message || 'Unknown WhatsApp delivery error';
        console.error('[PortalAccess] Failed to send access WhatsApp:', delivery.whatsapp.error);
      }
    } else {
      delivery.whatsapp.error = 'WhatsApp credentials are not configured';
    }
  }

  return delivery;
}