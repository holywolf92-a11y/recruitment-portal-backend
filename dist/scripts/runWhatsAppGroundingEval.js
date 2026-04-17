"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const whatsappGroundingEvalScenarios_json_1 = __importDefault(require("./whatsappGroundingEvalScenarios.json"));
const whatsappGroundingEvalLib_1 = require("./whatsappGroundingEvalLib");
function main() {
    const typedScenarios = whatsappGroundingEvalScenarios_json_1.default;
    const summary = (0, whatsappGroundingEvalLib_1.evaluateGroundingScenarios)(typedScenarios);
    console.log('WhatsApp Grounding Eval');
    console.log(`Scenarios: ${summary.total}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Pass rate: ${summary.passRate.toFixed(1)}%`);
    if (summary.failures.length > 0) {
        console.log('\nFailures:');
        for (const failure of summary.failures) {
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
