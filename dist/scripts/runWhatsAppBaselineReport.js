"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const whatsappGroundingEvalScenarios_json_1 = __importDefault(require("./whatsappGroundingEvalScenarios.json"));
const database_1 = require("../config/database");
const falishaKnowledgeBaseService_1 = require("../services/falishaKnowledgeBaseService");
const whatsappAIService_1 = require("../services/whatsappAIService");
const whatsappGroundingEvalLib_1 = require("./whatsappGroundingEvalLib");
function redactText(input) {
    return input
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')
        .replace(/\b\d{4,}\b/g, '[number]')
        .trim();
}
function makeClusterKey(input) {
    return redactText(input)
        .toLowerCase()
        .replace(/[^a-z\s\[\]]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .slice(0, 10)
        .join(' ');
}
function shouldIncludeMessage(body) {
    const normalized = body.trim().toLowerCase();
    if (normalized.length < 3)
        return false;
    if (normalized.startsWith('[buttons]') || normalized.startsWith('[list]'))
        return false;
    return true;
}
async function loadRecentInboundMessages(limit) {
    const db = (0, database_1.supabaseAdminClient)();
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
    return (data ?? []).filter((row) => row.body && shouldIncludeMessage(row.body));
}
async function loadConversations(conversationIds) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('whatsapp_conversations')
        .select('id, phone_number')
        .in('id', conversationIds);
    if (error) {
        throw error;
    }
    return new Map((data ?? []).map((row) => [row.id, row]));
}
async function buildPersonContextCache(phoneNumbers) {
    const cache = new Map();
    for (const phoneNumber of phoneNumbers) {
        cache.set(phoneNumber, await (0, whatsappAIService_1.resolvePersonContext)(phoneNumber));
    }
    return cache;
}
function printCounts(title, counts) {
    console.log(`\n${title}`);
    for (const [key, count] of Array.from(counts.entries()).sort((left, right) => right[1] - left[1])) {
        console.log(`- ${key}: ${count}`);
    }
}
async function main() {
    const syntheticSummary = (0, whatsappGroundingEvalLib_1.evaluateGroundingScenarios)(whatsappGroundingEvalScenarios_json_1.default);
    const sampleLimit = Number(process.env.WHATSAPP_BASELINE_SAMPLE_LIMIT || 120);
    const messages = await loadRecentInboundMessages(sampleLimit);
    const conversations = await loadConversations(Array.from(new Set(messages.map((message) => message.conversation_id))));
    const phoneNumbers = Array.from(new Set(Array.from(conversations.values()).map((row) => row.phone_number).filter(Boolean)));
    const personContextCache = await buildPersonContextCache(phoneNumbers);
    const evaluated = [];
    for (const message of messages) {
        const conversation = conversations.get(message.conversation_id);
        if (!conversation?.phone_number || !message.body) {
            continue;
        }
        const personCtx = personContextCache.get(conversation.phone_number) ?? { role: null, name: null };
        const decision = (0, whatsappAIService_1.decideWhatsAppReply)({
            from: conversation.phone_number,
            text: message.body,
            personCtx,
            messageHistory: [],
            conversationId: message.conversation_id,
        });
        const support = (0, falishaKnowledgeBaseService_1.assessFalishaKnowledgeSupport)({
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
    const intentCounts = new Map();
    const actionCounts = new Map();
    const supportCounts = new Map();
    const unansweredClusters = new Map();
    for (const item of evaluated) {
        intentCounts.set(item.intentId, (intentCounts.get(item.intentId) ?? 0) + 1);
        actionCounts.set(item.action, (actionCounts.get(item.action) ?? 0) + 1);
        supportCounts.set(item.supportLevel, (supportCounts.get(item.supportLevel) ?? 0) + 1);
        if (item.supportLevel !== 'grounded') {
            const current = unansweredClusters.get(item.clusterKey) ?? {
                count: 0,
                example: item.redactedText,
                intents: new Set(),
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
