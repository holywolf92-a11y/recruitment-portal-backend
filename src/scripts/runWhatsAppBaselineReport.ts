import 'dotenv/config';

import scenarios from './whatsappGroundingEvalScenarios.json';
import { supabaseAdminClient } from '../config/database';
import { assessFalishaKnowledgeSupport } from '../services/falishaKnowledgeBaseService';
import { decideWhatsAppReply, resolvePersonContext, type PersonContext } from '../services/whatsappAIService';
import { evaluateGroundingScenarios, type EvalScenario } from './whatsappGroundingEvalLib';

type MessageRow = {
  id: string;
  conversation_id: string;
  body: string | null;
  created_at: string;
};

type ConversationRow = {
  id: string;
  phone_number: string;
};

type EvaluatedMessage = {
  messageId: string;
  createdAt: string;
  intentId: string;
  action: 'deterministic' | 'ai' | 'escalate';
  supportLevel: 'grounded' | 'partial' | 'unsupported';
  clusterKey: string;
  redactedText: string;
};

function redactText(input: string): string {
  return input
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')
    .replace(/\b\d{4,}\b/g, '[number]')
    .trim();
}

function makeClusterKey(input: string): string {
  return redactText(input)
    .toLowerCase()
    .replace(/[^a-z\s\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 10)
    .join(' ');
}

function shouldIncludeMessage(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  if (normalized.length < 3) return false;
  if (normalized.startsWith('[buttons]') || normalized.startsWith('[list]')) return false;
  return true;
}

async function loadRecentInboundMessages(limit: number): Promise<MessageRow[]> {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('whatsapp_messages')
    .select('id, conversation_id, body, created_at')
    .eq('direction', 'inbound')
    .eq('message_type', 'text')
    .not('body', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return ((data ?? []) as MessageRow[]).filter((row) => row.body && shouldIncludeMessage(row.body));
}

async function loadConversations(conversationIds: string[]): Promise<Map<string, ConversationRow>> {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('whatsapp_conversations')
    .select('id, phone_number')
    .in('id', conversationIds);

  if (error) {
    throw error;
  }

  return new Map(((data ?? []) as ConversationRow[]).map((row) => [row.id, row]));
}

async function buildPersonContextCache(phoneNumbers: string[]): Promise<Map<string, PersonContext>> {
  const cache = new Map<string, PersonContext>();
  for (const phoneNumber of phoneNumbers) {
    cache.set(phoneNumber, await resolvePersonContext(phoneNumber));
  }
  return cache;
}

function printCounts(title: string, counts: Map<string, number>) {
  console.log(`\n${title}`);
  for (const [key, count] of Array.from(counts.entries()).sort((left, right) => right[1] - left[1])) {
    console.log(`- ${key}: ${count}`);
  }
}

async function main() {
  const syntheticSummary = evaluateGroundingScenarios(scenarios as EvalScenario[]);
  const sampleLimit = Number(process.env.WHATSAPP_BASELINE_SAMPLE_LIMIT || 120);
  const messages = await loadRecentInboundMessages(sampleLimit);
  const conversations = await loadConversations(Array.from(new Set(messages.map((message) => message.conversation_id))));
  const phoneNumbers = Array.from(new Set(Array.from(conversations.values()).map((row) => row.phone_number).filter(Boolean)));
  const personContextCache = await buildPersonContextCache(phoneNumbers);

  const evaluated: EvaluatedMessage[] = [];
  for (const message of messages) {
    const conversation = conversations.get(message.conversation_id);
    if (!conversation?.phone_number || !message.body) {
      continue;
    }

    const personCtx = personContextCache.get(conversation.phone_number) ?? { role: null, name: null };
    const decision = decideWhatsAppReply({
      from: conversation.phone_number,
      text: message.body,
      personCtx,
      messageHistory: [],
      conversationId: message.conversation_id,
    });
    const support = assessFalishaKnowledgeSupport({
      query: message.body,
      role: personCtx.role || 'all',
      intentId: decision.intentId,
      limit: 3,
    });

    evaluated.push({
      messageId: message.id,
      createdAt: message.created_at,
      intentId: decision.intentId,
      action: decision.action,
      supportLevel: support.supportLevel,
      clusterKey: makeClusterKey(message.body),
      redactedText: redactText(message.body).slice(0, 140),
    });
  }

  const intentCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();
  const supportCounts = new Map<string, number>();
  const unansweredClusters = new Map<string, { count: number; example: string; intents: Set<string> }>();

  for (const item of evaluated) {
    intentCounts.set(item.intentId, (intentCounts.get(item.intentId) ?? 0) + 1);
    actionCounts.set(item.action, (actionCounts.get(item.action) ?? 0) + 1);
    supportCounts.set(item.supportLevel, (supportCounts.get(item.supportLevel) ?? 0) + 1);

    if (item.supportLevel !== 'grounded') {
      const current = unansweredClusters.get(item.clusterKey) ?? {
        count: 0,
        example: item.redactedText,
        intents: new Set<string>(),
      };
      current.count += 1;
      current.intents.add(item.intentId);
      unansweredClusters.set(item.clusterKey, current);
    }
  }

  const unansweredTop = Array.from(unansweredClusters.entries())
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 10);

  console.log('WhatsApp Baseline Quality Report');
  console.log(`Real sample size: ${evaluated.length}`);
  console.log(`Synthetic harness: ${syntheticSummary.passed}/${syntheticSummary.total} passed (${syntheticSummary.passRate.toFixed(1)}%)`);
  console.log(`Real grounded coverage: ${(((supportCounts.get('grounded') ?? 0) / Math.max(evaluated.length, 1)) * 100).toFixed(1)}%`);
  console.log(`Real partial coverage: ${(((supportCounts.get('partial') ?? 0) / Math.max(evaluated.length, 1)) * 100).toFixed(1)}%`);
  console.log(`Real unsupported coverage: ${(((supportCounts.get('unsupported') ?? 0) / Math.max(evaluated.length, 1)) * 100).toFixed(1)}%`);

  printCounts('Intent Distribution', intentCounts);
  printCounts('Action Distribution', actionCounts);
  printCounts('Support Distribution', supportCounts);

  console.log('\nTop unanswered or weakly grounded clusters');
  for (const [clusterKey, entry] of unansweredTop) {
    console.log(`- ${clusterKey || '[empty]'} | count=${entry.count} | intents=${Array.from(entry.intents).join(', ')} | example=${entry.example}`);
  }
}

main().catch((error) => {
  console.error('Failed to run WhatsApp baseline report:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});