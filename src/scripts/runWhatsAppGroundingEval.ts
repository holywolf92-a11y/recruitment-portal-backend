import scenarios from './whatsappGroundingEvalScenarios.json';
import { evaluateGroundingScenarios, type EvalScenario } from './whatsappGroundingEvalLib';

function main() {
  const typedScenarios = scenarios as EvalScenario[];
  const summary = evaluateGroundingScenarios(typedScenarios);
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