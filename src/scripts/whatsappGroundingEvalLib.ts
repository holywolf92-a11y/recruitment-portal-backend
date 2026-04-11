import { assessFalishaKnowledgeSupport, type KnowledgeSupportLevel } from '../services/falishaKnowledgeBaseService';
import { decideWhatsAppReply, type PersonContext, type WhatsAppConversationContext } from '../services/whatsappAIService';
import type { WhatsAppIntentId } from '../services/whatsappIntentService';

export type EvalScenario = {
  id: string;
  text: string;
  personCtx?: Partial<PersonContext>;
  expectedIntent: WhatsAppIntentId;
  expectedAction: 'deterministic' | 'ai' | 'escalate';
  expectedSupportLevel?: KnowledgeSupportLevel;
  expectedHumanSwitch?: boolean;
  mustInclude?: string[];
  mustNotInclude?: string[];
};

export type EvalFailure = {
  scenarioId: string;
  checks: string[];
};

export type EvalSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  failures: EvalFailure[];
};

export function normalizePersonContext(personCtx?: Partial<PersonContext>): PersonContext {
  return {
    role: personCtx?.role ?? null,
    name: personCtx?.name ?? null,
    status: personCtx?.status ?? null,
    position: personCtx?.position ?? null,
    nationality: personCtx?.nationality ?? null,
    countryOfInterest: personCtx?.countryOfInterest ?? null,
    experienceYears: personCtx?.experienceYears ?? null,
    cvReceived: personCtx?.cvReceived ?? null,
    passportReceived: personCtx?.passportReceived ?? null,
    skills: personCtx?.skills ?? null,
    education: personCtx?.education ?? null,
    previousEmployment: personCtx?.previousEmployment ?? null,
    candidateCode: personCtx?.candidateCode ?? null,
    companyName: personCtx?.companyName ?? null,
    professions: personCtx?.professions ?? null,
    quantity: personCtx?.quantity ?? null,
    country: personCtx?.country ?? null,
    city: personCtx?.city ?? null,
    leadStatus: personCtx?.leadStatus ?? null,
    partnerType: personCtx?.partnerType ?? null,
    partnerStatus: personCtx?.partnerStatus ?? null,
    cityCountry: personCtx?.cityCountry ?? null,
    district: personCtx?.district ?? null,
  };
}

function includesAll(reply: string, values: string[]): string[] {
  const normalizedReply = reply.toLowerCase();
  return values.filter((value) => !normalizedReply.includes(value.toLowerCase()));
}

function includesAny(reply: string, values: string[]): string[] {
  const normalizedReply = reply.toLowerCase();
  return values.filter((value) => normalizedReply.includes(value.toLowerCase()));
}

export function runGroundingEvalScenario(rawScenario: EvalScenario): EvalFailure | null {
  const personCtx = normalizePersonContext(rawScenario.personCtx);
  const context: WhatsAppConversationContext = {
    from: 'eval-runner',
    text: rawScenario.text,
    personCtx,
    messageHistory: [],
    conversationId: null,
  };

  const decision = decideWhatsAppReply(context);
  const support = assessFalishaKnowledgeSupport({
    query: rawScenario.text,
    role: personCtx.role || 'all',
    intentId: decision.intentId,
    limit: 3,
  });

  const failures: string[] = [];
  if (decision.intentId !== rawScenario.expectedIntent) {
    failures.push(`intent expected ${rawScenario.expectedIntent} but got ${decision.intentId}`);
  }

  if (decision.action !== rawScenario.expectedAction) {
    failures.push(`action expected ${rawScenario.expectedAction} but got ${decision.action}`);
  }

  if (rawScenario.expectedSupportLevel && support.supportLevel !== rawScenario.expectedSupportLevel) {
    failures.push(`support expected ${rawScenario.expectedSupportLevel} but got ${support.supportLevel}`);
  }

  if (typeof rawScenario.expectedHumanSwitch === 'boolean' && decision.shouldSwitchToHuman !== rawScenario.expectedHumanSwitch) {
    failures.push(`human switch expected ${rawScenario.expectedHumanSwitch} but got ${decision.shouldSwitchToHuman}`);
  }

  const reply = decision.reply || '';
  if (rawScenario.mustInclude?.length) {
    const missing = includesAll(reply, rawScenario.mustInclude);
    if (missing.length > 0) {
      failures.push(`reply missing required text: ${missing.join(', ')}`);
    }
  }

  if (rawScenario.mustNotInclude?.length) {
    const forbidden = includesAny(reply, rawScenario.mustNotInclude);
    if (forbidden.length > 0) {
      failures.push(`reply contained forbidden text: ${forbidden.join(', ')}`);
    }
  }

  return failures.length > 0 ? { scenarioId: rawScenario.id, checks: failures } : null;
}

export function evaluateGroundingScenarios(scenarios: EvalScenario[]): EvalSummary {
  const failures = scenarios
    .map((scenario) => runGroundingEvalScenario(scenario))
    .filter((result): result is EvalFailure => Boolean(result));

  const total = scenarios.length;
  const passed = total - failures.length;
  const failed = failures.length;

  return {
    total,
    passed,
    failed,
    passRate: total === 0 ? 0 : (passed / total) * 100,
    failures,
  };
}