import scenarios from './whatsappGroundingEvalScenarios.json';
import { assessFalishaKnowledgeSupport, type KnowledgeSupportLevel } from '../services/falishaKnowledgeBaseService';
import { decideWhatsAppReply, type PersonContext, type WhatsAppConversationContext } from '../services/whatsappAIService';
import type { WhatsAppIntentId } from '../services/whatsappIntentService';

type EvalScenario = {
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

type EvalFailure = {
  scenarioId: string;
  checks: string[];
};

function normalizePersonContext(personCtx?: Partial<PersonContext>): PersonContext {
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

function runScenario(rawScenario: EvalScenario): EvalFailure | null {
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

function main() {
  const typedScenarios = scenarios as EvalScenario[];
  const failures = typedScenarios
    .map((scenario) => runScenario(scenario))
    .filter((result): result is EvalFailure => Boolean(result));

  const passed = typedScenarios.length - failures.length;
  console.log('WhatsApp Grounding Eval');
  console.log(`Scenarios: ${typedScenarios.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failures.length}`);
  console.log(`Pass rate: ${((passed / typedScenarios.length) * 100).toFixed(1)}%`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) {
      console.log(`- ${failure.scenarioId}`);
      for (const check of failure.checks) {
        console.log(`  * ${check}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nAll grounding checks passed.');
}

main();