# WhatsApp QA Workflow

This document defines the operational QA flow for Falisha WhatsApp AI changes.

## Purpose

Use two different checks for two different questions:

- `npm run eval:whatsapp-grounding`
  - Answers: "Did we break known supported behavior?"
  - Source: synthetic scenario harness in `src/scripts/whatsappGroundingEvalScenarios.json`
  - Scope: deterministic routing, KB grounding, escalation, and reply guardrails

- `npm run report:whatsapp-baseline`
  - Answers: "How much of real inbox traffic is currently grounded or unsupported?"
  - Source: recent real records from `whatsapp_messages` and `whatsapp_conversations`
  - Scope: live traffic coverage, unsupported clusters, and next routing/KB priorities

## When To Run Each Command

### Grounding eval

Run `npm run eval:whatsapp-grounding`:

- before pushing any change to WhatsApp intent routing
- before pushing any KB change
- before pushing any prompt or escalation-policy change
- before production deploys

Note:

- production Railway builds already run the grounding eval through `npm run build`
- if grounding eval fails, production build must fail

### Baseline report

Run `npm run report:whatsapp-baseline`:

- after meaningful routing or KB updates
- before planning the next WhatsApp coverage sprint
- weekly while coverage is still low
- after adding new intent families or language support

Use a larger sample when checking live trends:

```powershell
$env:WHATSAPP_BASELINE_SAMPLE_LIMIT = "300"
npm run report:whatsapp-baseline
```

If fewer than 300 eligible inbound text messages exist, the report will use the available sample.

## Hard Release Gate

These are non-negotiable.

- `npm run build` must pass
- synthetic grounding eval must remain `100.0%`
- synthetic failures must be `0`

If any of these fail:

- do not release
- inspect the failed scenarios first
- fix routing, KB, or reply logic before re-running the build

## Live Baseline Thresholds

These do not block deployment yet, but they determine urgency.

### Healthy enough for current phase

- grounded coverage: `>= 30%`
- unsupported coverage: `<= 70%`
- top unsupported cluster count: no single cluster dominating because of an obvious missing route

### Warning

- grounded coverage: `25% - 29.9%`
- unsupported coverage: `70.1% - 75%`
- unknown intent share is still the largest bucket

Action:

- review top 10 unsupported clusters
- add low-context routes before expanding the KB

### Critical

- grounded coverage: `< 25%`
- unsupported coverage: `> 75%`
- one unsupported cluster repeats `>= 5` times in the top 10

Action:

- stop adding generic KB entries
- fix the dominant unsupported cluster with routing or a verified KB article
- rerun baseline before taking on lower-frequency issues

## Failure Triage

### If grounding eval fails

1. Read the failing scenario IDs.
2. Identify which layer broke:
   - intent classification
   - deterministic reply selection
   - KB support assessment
   - escalation or human handoff
   - forbidden content in the reply
3. Fix the smallest layer that caused the failure.
4. Re-run `npm run eval:whatsapp-grounding`.
5. Do not move to baseline analysis until synthetic is back at `100%`.

### If baseline report is weak but synthetic is green

This means the known supported flows are stable, but live traffic coverage is still poor.

Use this order:

1. Review the top 10 unsupported clusters.
2. Group them into one of these buckets:
   - low-context routing gap
   - missing verified KB fact
   - multilingual pattern gap
   - human-only issue
3. Only expand the KB when a recurring cluster can be answered from verified repo-backed facts.
4. If the cluster is low-context, add routing first.
5. Re-run baseline after each focused batch.

## Rules For New Coverage Work

- Do not add KB entries because a question "sounds common".
- Do not add facts without a verified source in the repo or configured environment.
- Do not use baseline output to invent unsupported business answers.
- Use the top 10 unsupported clusters as the only source for the next expansion pass.

## Recommended Working Cycle

1. Make routing or KB change.
2. Run `npm run eval:whatsapp-grounding`.
3. If green, run `npm run report:whatsapp-baseline` with a larger sample.
4. Pick the top repeated unsupported clusters.
5. Add the next focused routing or KB changes.
6. Re-run both checks.

## Current Interpretation Standard

- synthetic harness protects release safety
- baseline report drives coverage prioritization
- routing fixes come before KB growth for low-context traffic
- KB growth must stay source-backed