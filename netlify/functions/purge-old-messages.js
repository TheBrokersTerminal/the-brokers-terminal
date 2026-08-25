/* ── SCHEDULED: purge messages older than 30 days ──────────────────
   Runs on the 1st of every month via netlify.toml [schedule].
   Uses SUPABASE_SERVICE_KEY (bypasses RLS) to hard-delete old rows.
   ─────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';

exports.handler = async () => {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) {
    console.error('SUPABASE_SERVICE_KEY not set');
    return { statusCode: 500, body: 'missing env' };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffIso = cutoff.toISOString();

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?created_at=lt.${encodeURIComponent(cutoffIso)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error('Purge failed:', res.status, body);
    return { statusCode: 500, body: 'purge failed' };
  }

  const deleted = await res.json().catch(() => []);
  console.log(`Purged ${deleted.length} messages older than ${cutoffIso}`);
  return { statusCode: 200, body: `Purged ${deleted.length} messages` };
};
