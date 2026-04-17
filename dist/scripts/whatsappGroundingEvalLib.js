"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePersonContext = normalizePersonContext;
exports.runGroundingEvalScenario = runGroundingEvalScenario;
exports.evaluateGroundingScenarios = evaluateGroundingScenarios;
const falishaKnowledgeBaseService_1 = require("../services/falishaKnowledgeBaseService");
const whatsappAIService_1 = require("../services/whatsappAIService");
function normalizePersonContext(personCtx) {
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
function includesAll(reply, values) {
    const normalizedReply = reply.toLowerCase();
    return values.filter((value) => !normalizedReply.includes(value.toLowerCase()));
}
function includesAny(reply, values) {
    const normalizedReply = reply.toLowerCase();
    return values.filter((value) => normalizedReply.includes(value.toLowerCase()));
}
function runGroundingEvalScenario(rawScenario) {
    const personCtx = normalizePersonContext(rawScenario.personCtx);
    const context = {
        from: 'eval-runner',
        text: rawScenario.text,
        personCtx,
        messageHistory: [],
        conversationId: null,
    };
    const decision = (0, whatsappAIService_1.decideWhatsAppReply)(context);
    const support = (0, falishaKnowledgeBaseService_1.assessFalishaKnowledgeSupport)({
        query: rawScenario.text,
        role: personCtx.role || 'all',
        intentId: decision.intentId,
        limit: 3,
    });
    const failures = [];
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
function evaluateGroundingScenarios(scenarios) {
    const failures = scenarios
        .map((scenario) => runGroundingEvalScenario(scenario))
        .filter((result) => Boolean(result));
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
