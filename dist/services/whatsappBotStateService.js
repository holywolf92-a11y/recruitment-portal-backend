"use strict";
/**
 * WhatsApp Bot State Service
 *
 * Persists conversation state in whatsapp_conversations.
 * Columns (added by migration 20260223000001_whatsapp_bot.sql):
 *   bot_flow  text   – active flow id or null (idle)
 *   bot_step  text   – step within that flow or null
 *   bot_data  jsonb  – accumulated field values gathered so far
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBotState = getBotState;
exports.setBotState = setBotState;
exports.patchBotData = patchBotData;
exports.resetBotState = resetBotState;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('WhatsAppBotState');
// ─── Read ─────────────────────────────────────────────────────────────────────
async function getBotState(phoneNumber) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_conversations')
        .select('id, phone_number, reply_mode, bot_flow, bot_step, bot_data')
        .eq('phone_number', phoneNumber)
        .maybeSingle();
    if (error) {
        logger.warn('getBotState DB error', { phoneNumber, error: error.message });
        return null;
    }
    if (!data)
        return null;
    return {
        conversationId: data.id,
        phoneNumber: data.phone_number,
        replyMode: data.reply_mode ?? 'ai',
        flow: data.bot_flow ?? null,
        step: data.bot_step ?? null,
        data: data.bot_data ?? {},
    };
}
// ─── Write ────────────────────────────────────────────────────────────────────
async function setBotState(phoneNumber, flow, step, data) {
    const db = (0, database_1.supabaseAdminClient)();
    const { error } = await db
        .from('whatsapp_conversations')
        .update({
        bot_flow: flow,
        bot_step: step,
        bot_data: data ?? {},
        updated_at: new Date().toISOString(),
    })
        .eq('phone_number', phoneNumber);
    if (error)
        logger.warn('setBotState DB error', { phoneNumber, error: error.message });
}
/** Merge additional key-value pairs into bot_data without replacing everything. */
async function patchBotData(phoneNumber, patch) {
    // Supabase jsonb concat operator via RPC or raw SQL; simplest reliable approach
    // is to fetch current data, merge, and write back.
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_conversations')
        .select('bot_data, bot_flow, bot_step')
        .eq('phone_number', phoneNumber)
        .maybeSingle();
    if (error || !data) {
        logger.warn('patchBotData: could not fetch current state', { phoneNumber });
        return;
    }
    const merged = { ...(data.bot_data ?? {}), ...patch };
    await db
        .from('whatsapp_conversations')
        .update({ bot_data: merged, updated_at: new Date().toISOString() })
        .eq('phone_number', phoneNumber);
}
async function resetBotState(phoneNumber) {
    // Preserve the `welcomed` flag so the welcome image is never sent twice
    // even after a flow completes and state is cleared.
    const db = (0, database_1.supabaseAdminClient)();
    const { data } = await db
        .from('whatsapp_conversations')
        .select('bot_data')
        .eq('phone_number', phoneNumber)
        .maybeSingle();
    const welcomed = data?.bot_data?.welcomed ?? false;
    const lastMainMenuAt = data?.bot_data?.last_main_menu_at ?? null;
    const preserved = {};
    if (welcomed)
        preserved.welcomed = true;
    if (lastMainMenuAt)
        preserved.last_main_menu_at = lastMainMenuAt;
    // Always clear expected interactive ids on reset to avoid stale-button mismatch
    preserved.expected_interactive_ids = [];
    return setBotState(phoneNumber, null, null, preserved);
}
