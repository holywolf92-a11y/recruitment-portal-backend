"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPortalDashboardUrl = buildPortalDashboardUrl;
exports.ensurePortalAccount = ensurePortalAccount;
exports.createPortalAutoLoginUrl = createPortalAutoLoginUrl;
exports.dispatchPortalAccessLink = dispatchPortalAccessLink;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const publicUrl_1 = require("../utils/publicUrl");
const emailService_1 = require("./emailService");
const userService_1 = require("./userService");
const whatsappService_1 = require("./whatsappService");
const FRONTEND_URL = (0, publicUrl_1.resolveFrontendUrl)(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || undefined);
function generateTemporaryPassword() {
    return `Falisha!${crypto_1.default.randomBytes(4).toString('hex')}`;
}
async function findExistingAuthUserByEmail(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
        return null;
    }
    const supabase = (0, database_1.supabaseAdminClient)();
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) {
        throw error;
    }
    return data.users.find((user) => String(user.email || '').trim().toLowerCase() === normalizedEmail) || null;
}
function toWhatsAppPhone(phone) {
    return phone.replace(/\D/g, '');
}
function toRoleLabel(role) {
    return role.charAt(0).toUpperCase() + role.slice(1);
}
function buildPortalDashboardUrl(role) {
    return `${FRONTEND_URL}/${role}/dashboard`;
}
async function ensurePortalAccount(args) {
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
    const supabase = (0, database_1.supabaseAdminClient)();
    const existingAuthUser = await findExistingAuthUserByEmail(normalizedEmail);
    const password = existingAuthUser ? null : generateTemporaryPassword();
    const authUser = existingAuthUser || (await (async () => {
        const { data: created, error } = await supabase.auth.admin.createUser({
            email: normalizedEmail,
            password: password,
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
    await (0, userService_1.upsertAppUserProfile)({
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
async function createPortalAutoLoginUrl(email, role) {
    const supabase = (0, database_1.supabaseAdminClient)();
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
    }
    catch (error) {
        console.error('[PortalAccess] Failed to create auto-login link:', error?.message || error);
        return null;
    }
}
async function dispatchPortalAccessLink(user) {
    const displayName = user.name || user.email;
    const roleLabel = toRoleLabel(user.role);
    const dashboardUrl = buildPortalDashboardUrl(user.role);
    const autoLoginUrl = user.autoLoginUrl ?? await createPortalAutoLoginUrl(user.email, user.role);
    const delivery = {
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
        const emailResult = await emailService_1.emailService.sendEmailDetailed({
            to: user.email,
            subject: 'Your Falisha Jobs Portal Access Link',
            html: emailHtml,
            text: emailText,
        });
        delivery.email.sent = emailResult.sent;
        if (!emailResult.sent) {
            delivery.email.error = `Email provider ${emailResult.provider} did not confirm delivery`;
        }
    }
    catch (error) {
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
                await (0, whatsappService_1.sendMessage)(phoneNumberId, accessToken, waPhone, waText);
                delivery.whatsapp.sent = true;
            }
            catch (error) {
                delivery.whatsapp.error = error?.message || 'Unknown WhatsApp delivery error';
                console.error('[PortalAccess] Failed to send access WhatsApp:', delivery.whatsapp.error);
            }
        }
        else {
            delivery.whatsapp.error = 'WhatsApp credentials are not configured';
        }
    }
    return delivery;
}
