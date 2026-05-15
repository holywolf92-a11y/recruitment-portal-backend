/**
 * normalize-positions.ts
 *
 * One-time backfill: runs normalizePosition() over every candidate's `position`
 * field and writes the cleaned value back to the DB.
 *
 * Usage (dry-run, just prints what would change — default):
 *   npx ts-node -r dotenv/config src/scripts/normalize-positions.ts
 *
 * Usage (live — actually writes to DB):
 *   APPLY=true npx ts-node -r dotenv/config src/scripts/normalize-positions.ts
 */

import 'dotenv/config';
import { supabaseAdminClient } from '../config/database';
import { normalizePosition } from '../services/candidateService';

const APPLY = process.env.APPLY === 'true';
const PAGE_SIZE = 1000;

interface Row {
  id: string;
  candidate_code: string;
  name: string;
  position: string | null;
}

async function run() {
  const db = supabaseAdminClient();

  console.log(`\n🔧  Position Normalisation Backfill`);
  console.log(`   Mode: ${APPLY ? '🔴 LIVE (writing to DB)' : '🟡 DRY-RUN (no changes written)'}\n`);

  let page = 0;
  let totalRows = 0;
  let changedRows = 0;
  let nulledRows = 0; // garbage → null

  // Track frequency of each (before → after) mapping
  const changeMap = new Map<string, number>();

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await db
      .from('candidates')
      .select('id, candidate_code, name, position')
      .neq('status', 'Deleted')
      .range(from, to);

    if (error) {
      console.error('❌ Fetch error:', error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) break;

    const rows = data as Row[];
    totalRows += rows.length;

    for (const row of rows) {
      const before = row.position ?? null;
      const after = before === null ? null : (normalizePosition(before) ?? null);

      if (before === after) continue; // no change

      const label = `"${before ?? 'NULL'}" → "${after ?? 'NULL'}"`;
      changeMap.set(label, (changeMap.get(label) ?? 0) + 1);

      changedRows++;
      if (after === null && before !== null) nulledRows++;

      if (APPLY) {
        const { error: updateErr } = await db
          .from('candidates')
          .update({ position: after, updated_at: new Date().toISOString() })
          .eq('id', row.id);

        if (updateErr) {
          console.error(`  ❌ Failed to update ${row.candidate_code} (${row.name}): ${updateErr.message}`);
        }
      }
    }

    if (data.length < PAGE_SIZE) break;
    page++;
  }

  // Print the change map, sorted by frequency desc
  console.log(`📊  Scan complete — ${totalRows} candidates scanned, ${changedRows} need changes:\n`);

  const sorted = Array.from(changeMap.entries()).sort((a, b) => b[1] - a[1]);
  for (const [label, count] of sorted) {
    console.log(`  ${String(count).padStart(4)}×  ${label}`);
  }

  if (nulledRows > 0) {
    console.log(`\n⚠️   ${nulledRows} garbage position(s) would be set to NULL`);
  }

  if (!APPLY) {
    console.log(`\n✅  Dry-run finished. No data changed.`);
    console.log(`   To apply: APPLY=true npx ts-node -r dotenv/config src/scripts/normalize-positions.ts\n`);
  } else {
    console.log(`\n✅  ${changedRows} records updated successfully.\n`);
  }
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
