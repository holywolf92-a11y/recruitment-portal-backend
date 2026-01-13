const { createClient } = require('@supabase/supabase-js');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const url = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const start = Date.now();
  const { error } = await supabase
    .from('candidates')
    .select('id', { head: true })
    .limit(1);

  const ms = Date.now() - start;

  if (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          where: 'supabase',
          message: error.message,
          code: error.code ?? null,
          details: error.details ?? null,
          hint: error.hint ?? null,
          ms,
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, ms }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, where: 'node', message: err?.message ?? String(err) }, null, 2));
  process.exit(1);
});
