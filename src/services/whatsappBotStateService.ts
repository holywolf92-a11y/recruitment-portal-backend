/**
 * WhatsApp Bot State Service
 *
 * Persists conversation state in whatsapp_conversations.
 * Columns (added by migration 20260223000001_whatsapp_bot.sql):
 *   bot_flow  text   – active flow id or null (idle)
 *   bot_step  text   – step within that flow or null
 *   bot_data  jsonb  – accumulated field values gathered so far
 */

import { supabaseAdminClient } from '../config/database';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('WhatsAppBotState');

export type BotFlow =
  | 'menu'
  | 'candidate_intake'
  | 'employer_intake'
  | 'partner_onboarding'
  | 'jobs'
  | 'social'
  | null;

export interface BotState {
  conversationId: string;
  phoneNumber: string;
  replyMode: 'ai' | 'human';
  flow: BotFlow;
  step: string | null;
  data: Record<string, any>;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getBotState(phoneNumber: string): Promise<BotState | null> {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('whatsapp_conversations')
    .select('id, phone_number, reply_mode, bot_flow, bot_step, bot_data')
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  if (error) {
    logger.warn('getBotState DB error', { phoneNumber, error: error.message });
    return null;
  }
  if (!data) return null;

  return {
    conversationId: (data as any).id,
    phoneNumber: (data as any).phone_number,
    replyMode: (data as any).reply_mode ?? 'ai',
    flow: ((data as any).bot_flow as BotFlow) ?? null,
    step: (data as any).bot_step ?? null,
    data: (data as any).bot_data ?? {},
  };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function setBotState(
  phoneNumber: string,
  flow: BotFlow,
  step: string | null,
  data?: Record<string, any>,
): Promise<void> {
  const db = supabaseAdminClient();
  const { error } = await db
    .from('whatsapp_conversations')
    .update({
      bot_flow: flow,
      bot_step: step,
      bot_data: data ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('phone_number', phoneNumber);

  if (error) logger.warn('setBotState DB error', { phoneNumber, error: error.message });
}

/** Merge additional key-value pairs into bot_data without replacing everything. */
export async function patchBotData(
  phoneNumber: string,
  patch: Record<string, any>,
): Promise<void> {
  // Supabase jsonb concat operator via RPC or raw SQL; simplest reliable approach
  // is to fetch current data, merge, and write back.
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('whatsapp_conversations')
    .select('bot_data, bot_flow, bot_step')
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  if (error || !data) {
    logger.warn('patchBotData: could not fetch current state', { phoneNumber });
    return;
  }

  const merged = { ...((data as any).bot_data ?? {}), ...patch };
  await db
    .from('whatsapp_conversations')
    .update({ bot_data: merged, updated_at: new Date().toISOString() })
    .eq('phone_number', phoneNumber);
}

export async function resetBotState(phoneNumber: string): Promise<void> {
  // Preserve the `welcomed` flag so the welcome image is never sent twice
  // even after a flow completes and state is cleared.
  const db = supabaseAdminClient();
  const { data } = await db
    .from('whatsapp_conversations')
    .select('bot_data')
    .eq('phone_number', phoneNumber)
    .maybeSingle();
  const welcomed = (data as any)?.bot_data?.welcomed ?? false;
  const lastMainMenuAt = (data as any)?.bot_data?.last_main_menu_at ?? null;
  const preserved: Record<string, any> = {};
  if (welcomed) preserved.welcomed = true;
  if (lastMainMenuAt) preserved.last_main_menu_at = lastMainMenuAt;
  // Always clear expected interactive ids on reset to avoid stale-button mismatch
  preserved.expected_interactive_ids = [];
  return setBotState(phoneNumber, null, null, preserved);
}
