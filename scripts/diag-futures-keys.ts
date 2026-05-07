/**
 * Comprehensive diagnostic for the user's stored Binance Futures testnet
 * credentials. Decrypts the key+secret currently in apiKeys (exchangeId=6),
 * then runs a battery of checks to pinpoint exactly why the probe fails.
 *
 * No values are logged in plaintext; only metadata (length, charset shape,
 * leading/trailing chars masked).
 *
 * Probes, in order:
 *   1. Decrypt round-trip sanity (rules out crypto corruption)
 *   2. Tokyo's outgoing public IP (so the user can compare to their key's
 *      IP whitelist on testnet.binancefuture.com)
 *   3. Public unsigned endpoint (rules out network/firewall/wrong host)
 *   4. Signed endpoint at testnet.binancefuture.com with full error body
 *   5. Same signed endpoint with a wider recvWindow (rules out clock drift)
 *   6. Sanity comparison: same call against fapi.binance.com (LIVE) — if it
 *      WORKS there, the user generated a LIVE key and we should switch off
 *      testnet mode, not bug-hunt the testnet path.
 */

import 'dotenv/config';
import { getDb } from '../server/db';
import * as schema from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt, encrypt } from '../server/crypto';
import { USDMClient } from 'binance';

const EXCHANGE_ID = 6;

function maskShape(s: string): string {
  if (!s) return '(empty)';
  const head = s.slice(0, 4);
  const tail = s.slice(-4);
  const mid = '*'.repeat(Math.max(0, s.length - 8));
  // Detect charset hints — Binance keys are ASCII alphanumeric.
  const hasNonAscii = /[^\x20-\x7E]/.test(s);
  const hasWhitespace = /\s/.test(s);
  const allHex = /^[0-9a-fA-F]+$/.test(s);
  const allAlphaNum = /^[a-zA-Z0-9]+$/.test(s);
  const charsetTag = hasNonAscii
    ? '⚠ NON-ASCII'
    : hasWhitespace
      ? '⚠ contains whitespace'
      : allHex
        ? 'hex-only'
        : allAlphaNum
          ? 'alphanumeric'
          : 'mixed';
  return `${head}${mid}${tail} (len=${s.length}, ${charsetTag})`;
}

async function publicIpProbe(): Promise<string> {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return j.ip;
  } catch (e: any) {
    return `(ipify failed: ${e?.message})`;
  }
}

async function publicEndpointProbe(testnet: boolean): Promise<{ ok: boolean; error?: string; serverTime?: string; localTime?: string; drift?: number }> {
  const host = testnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
  try {
    const start = Date.now();
    const r = await fetch(`${host}/fapi/v1/time`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (!j.serverTime) return { ok: false, error: `unexpected response: ${JSON.stringify(j)}` };
    const drift = Date.now() - j.serverTime;
    return { ok: true, serverTime: new Date(j.serverTime).toISOString(), localTime: new Date(start).toISOString(), drift };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function signedProbe(apiKey: string, apiSecret: string, opts: { testnet: boolean; recvWindow?: number; label: string }): Promise<{ ok: boolean; code?: number; msg?: string; canTrade?: boolean; usdt?: string }> {
  const c: any = new USDMClient({ api_key: apiKey, api_secret: apiSecret, testnet: opts.testnet, recvWindow: opts.recvWindow });
  try {
    const r = await c.getAccountInformation();
    const usdtRow = (r.assets || []).find((a: any) => a.asset === 'USDT');
    return {
      ok: true,
      canTrade: r.canTrade,
      usdt: usdtRow ? `${parseFloat(usdtRow.walletBalance).toFixed(2)} (avail ${parseFloat(usdtRow.availableBalance).toFixed(2)})` : '(no USDT row)',
    };
  } catch (e: any) {
    return {
      ok: false,
      code: e?.code,
      msg: e?.message || String(e),
    };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Binance Futures Key Diagnostic — exchangeId =', EXCHANGE_ID);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const db = await getDb();
  if (!db) { console.error('DB unavailable'); process.exit(1); }

  const ex = (await db.select().from(schema.exchanges).where(eq(schema.exchanges.id, EXCHANGE_ID)).limit(1))[0];
  if (!ex) { console.error(`exchange row ${EXCHANGE_ID} not found`); process.exit(1); }
  console.log(`Exchange row: id=${ex.id} userId=${ex.userId} name=${ex.exchangeName} status=${ex.connectionStatus} lastConnected=${ex.lastConnected}\n`);

  const k = (await db.select().from(schema.apiKeys).where(and(eq(schema.apiKeys.exchangeId, EXCHANGE_ID), eq(schema.apiKeys.userId, ex.userId))).limit(1))[0];
  if (!k) { console.error('apiKeys row not found'); process.exit(1); }

  // 1. Decrypt + round-trip check
  console.log('── [1/6] decrypt + crypto round-trip ──');
  let apiKey: string; let apiSecret: string;
  try {
    apiKey = decrypt(k.encryptedApiKey, k.apiKeyIv);
    apiSecret = decrypt(k.encryptedApiSecret, k.apiSecretIv);
  } catch (e: any) {
    console.error(`✗ decrypt failed: ${e?.message}`);
    process.exit(1);
  }
  console.log(`  apiKey shape:    ${maskShape(apiKey)}`);
  console.log(`  apiSecret shape: ${maskShape(apiSecret)}`);
  // Round-trip: encrypt the decrypted key and compare lengths.
  try {
    const { encrypted: e1, iv: iv1 } = encrypt(apiKey);
    const back = decrypt(e1, iv1);
    if (back !== apiKey) console.error('  ✗ round-trip MISMATCH — encryption is corrupting data');
    else console.log('  ✓ encrypt→decrypt round-trip preserves bytes exactly');
  } catch (e: any) {
    console.error(`  ✗ round-trip threw: ${e?.message}`);
  }
  console.log('');

  // 2. Outgoing IP
  console.log('── [2/6] outgoing public IP (compare to your key whitelist) ──');
  const myIp = await publicIpProbe();
  console.log(`  this server's egress IP: ${myIp}`);
  console.log(`  → if your key has IP whitelist, ${myIp} must be in it (or set whitelist to "Unrestricted")`);
  console.log('');

  // 3. Public testnet endpoint
  console.log('── [3/6] unauthenticated reachability (testnet.binancefuture.com) ──');
  const pubT = await publicEndpointProbe(true);
  if (pubT.ok) {
    console.log(`  ✓ reachable. server=${pubT.serverTime}, local=${pubT.localTime}, drift=${pubT.drift}ms`);
    if (Math.abs(pubT.drift!) > 2000) console.warn(`  ⚠ clock drift ${pubT.drift}ms is large (>2s) — could fail signed requests`);
  } else {
    console.error(`  ✗ unreachable: ${pubT.error}`);
    console.error('  → network/firewall issue, NOT a key issue. Stop and fix this first.');
    process.exit(1);
  }
  console.log('');

  // 4. Signed against testnet (default recvWindow)
  console.log('── [4/6] signed call against testnet.binancefuture.com ──');
  const sigT = await signedProbe(apiKey, apiSecret, { testnet: true, label: 'testnet-default' });
  if (sigT.ok) {
    console.log(`  ✓ AUTHENTICATED. canTrade=${sigT.canTrade}, USDT wallet=${sigT.usdt}`);
    console.log('  → keys are valid for testnet. The Settings UI probe should now work.');
  } else {
    console.error(`  ✗ FAILED. code=${sigT.code} msg="${sigT.msg}"`);
  }
  console.log('');

  // 5. Same call but with wider recvWindow (clock drift mitigation)
  if (!sigT.ok) {
    console.log('── [5/6] retry with recvWindow=60000 (rules out clock drift) ──');
    const sigT2 = await signedProbe(apiKey, apiSecret, { testnet: true, recvWindow: 60000, label: 'testnet-wide-recvwindow' });
    if (sigT2.ok) {
      console.log(`  ✓ AUTHENTICATED with wide recvWindow. canTrade=${sigT2.canTrade}`);
      console.log('  → root cause is server clock drift; bump recvWindow in adapter config.');
    } else {
      console.error(`  ✗ STILL FAILED. code=${sigT2.code} msg="${sigT2.msg}"`);
    }
    console.log('');
  } else {
    console.log('── [5/6] skipped (signed call already worked) ──\n');
  }

  // 6. Sanity check: try LIVE production with the same keys
  if (!sigT.ok) {
    console.log('── [6/6] cross-check: same key against LIVE fapi.binance.com ──');
    const sigL = await signedProbe(apiKey, apiSecret, { testnet: false, label: 'live-default' });
    if (sigL.ok) {
      console.error(`  ⚠ THIS IS A LIVE KEY, NOT A TESTNET KEY. canTrade=${sigL.canTrade}, USDT=${sigL.usdt}`);
      console.error('  → You generated the key at https://www.binance.com/en/my/settings/api-management instead of');
      console.error('    https://testnet.binancefuture.com/. Either:');
      console.error('      (a) regenerate at testnet.binancefuture.com and replace the row, OR');
      console.error('      (b) set BINANCE_FUTURES_USE_TESTNET=0 in .env to point the engine at LIVE');
      console.error('          (be very careful — real money).');
    } else {
      console.error(`  ✗ also rejected on LIVE. code=${sigL.code} msg="${sigL.msg}"`);
      console.error('  → key is invalid on BOTH testnet and live. Most likely:');
      console.error('    - permissions: "Enable Futures" not checked on the key');
      console.error('    - IP whitelist mismatch (see step 2 for our IP)');
      console.error('    - typo in key/secret at copy-paste time');
      console.error('    - key was deleted or regenerated since save');
    }
    console.log('');
  } else {
    console.log('── [6/6] skipped (signed call worked) ──\n');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Diagnostic complete.');
  console.log('═══════════════════════════════════════════════════════════════');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e?.message || e); process.exit(1); });
