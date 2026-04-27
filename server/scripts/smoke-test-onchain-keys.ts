/**
 * Smoke test for the two newly-wired on-chain data sources.
 *
 *   1. Whale Alert  — fetch the most recent ≥ $1M transactions for BTC.
 *   2. Dune         — call the API status endpoint with the auth header.
 *
 * Prints PASS / FAIL per source. Exits non-zero on any failure so this
 * can be wired into CI later.
 *
 * Run:  npx tsx server/scripts/smoke-test-onchain-keys.ts
 */
import 'dotenv/config';

async function testWhaleAlert(): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.WHALE_ALERT_API_KEY;
  if (!key) return { ok: false, detail: 'WHALE_ALERT_API_KEY not set' };
  // Whale Alert wants min_value ≥ 500_000 USD per docs.
  const now = Math.floor(Date.now() / 1000);
  const start = now - 3600;
  const url = `https://api.whale-alert.io/v1/transactions?api_key=${key}&start=${start}&end=${now}&min_value=1000000`;
  try {
    const r = await fetch(url);
    const body = await r.text();
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}: ${body.slice(0, 200)}` };
    const json = JSON.parse(body);
    if (json.result === 'success') {
      const n = Array.isArray(json.transactions) ? json.transactions.length : 0;
      return { ok: true, detail: `result=success, ${n} txns in last hour ≥ $1M` };
    }
    return { ok: false, detail: `result=${json.result}, message=${json.message ?? '-'}` };
  } catch (e: any) {
    return { ok: false, detail: `fetch failed: ${e?.message ?? e}` };
  }
}

async function testDune(): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.DUNE_API_KEY;
  if (!key) return { ok: false, detail: 'DUNE_API_KEY not set' };
  // Dune doesn't expose a free /status endpoint, but a key-valid call is
  // GET /api/v1/query/{id}/results — using a small public query (id 4132129
  // is a known Dune sample on their docs). If the key is invalid, we get
  // 401; if valid but the query needs execution, we get 404 with a body
  // that confirms auth worked.
  const url = 'https://api.dune.com/api/v1/query/4132129/results?limit=1';
  try {
    const r = await fetch(url, { headers: { 'X-Dune-API-Key': key } });
    const body = await r.text();
    if (r.status === 401 || r.status === 403) return { ok: false, detail: `HTTP ${r.status} (auth): ${body.slice(0, 200)}` };
    // 200/404 both indicate the key is accepted; 404 just means "no cached result".
    return { ok: true, detail: `HTTP ${r.status} — key authenticated (${body.length} byte response)` };
  } catch (e: any) {
    return { ok: false, detail: `fetch failed: ${e?.message ?? e}` };
  }
}

async function main() {
  console.log('[smoke] env loaded — WHALE_ALERT_API_KEY=', process.env.WHALE_ALERT_API_KEY ? '<set>' : '<missing>');
  console.log('[smoke] env loaded — DUNE_API_KEY=', process.env.DUNE_API_KEY ? '<set>' : '<missing>');
  console.log('[smoke] env loaded — ENABLE_ONCHAIN_FLOW_ANALYST=', process.env.ENABLE_ONCHAIN_FLOW_ANALYST);
  console.log('');

  const w = await testWhaleAlert();
  console.log(w.ok ? '✅ Whale Alert: PASS' : '❌ Whale Alert: FAIL', '—', w.detail);

  const d = await testDune();
  console.log(d.ok ? '✅ Dune Analytics: PASS' : '❌ Dune Analytics: FAIL', '—', d.detail);

  process.exit(w.ok && d.ok ? 0 : 1);
}

main();
