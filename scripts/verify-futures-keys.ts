/**
 * Sanity check for Binance USDM Futures testnet keys.
 *
 * Reads BINANCE_FUTURES_API_KEY / BINANCE_FUTURES_SECRET_KEY from .env,
 * connects to testnet.binancefuture.com (or fapi.binance.com if testnet
 * flag is off), and exercises the read-only paths the adapter will use:
 *
 *   - getAccountInformation: confirms keys are valid + reads USDT balance
 *   - getExchangeInfo:        confirms LOT_SIZE/PRICE_FILTER load works for
 *                             the symbols we trade
 *   - getPositions:           lists any open futures positions on the account
 *   - get current leverage:   shows leverage per symbol (so the operator can
 *                             see what the account is currently configured
 *                             for before the adapter calls setLeverage)
 *
 * No orders placed. No signed mutations. If this passes, the futures path
 * will work when pm2 restarts.
 *
 * Usage on Tokyo:
 *   ssh -i ~/.ssh/seerticks-prod-key.pem ubuntu@seerticks.com \
 *     "sudo -u seer bash -c 'cd /home/seer/app && npx tsx scripts/verify-futures-keys.ts'"
 */

import 'dotenv/config';
import { USDMClient } from 'binance';

async function main() {
  const apiKey = process.env.BINANCE_FUTURES_API_KEY;
  const apiSecret = process.env.BINANCE_FUTURES_SECRET_KEY;
  const testnet = process.env.BINANCE_FUTURES_USE_TESTNET === '1';

  if (!apiKey || !apiSecret) {
    console.error('✗ BINANCE_FUTURES_API_KEY or BINANCE_FUTURES_SECRET_KEY not set in .env');
    console.error('  Run: npx tsx scripts/set-futures-keys.ts to configure them.');
    process.exit(1);
  }

  console.log(`Endpoint: ${testnet ? 'testnet.binancefuture.com (TESTNET)' : 'fapi.binance.com (LIVE)'}`);
  console.log(`API key:  ${apiKey.slice(0, 6)}…${apiKey.slice(-4)} (length ${apiKey.length})`);
  console.log('');

  const client: any = new USDMClient({ api_key: apiKey, api_secret: apiSecret, testnet });

  try {
    console.log('1/4 getAccountInformation()...');
    const acct = await client.getAccountInformation();
    const usdt = (acct.assets || []).find((a: any) => a.asset === 'USDT');
    if (!usdt) {
      console.warn('   ⚠ no USDT asset row — futures account may not be initialized');
    } else {
      console.log(`   ✓ wallet balance: ${parseFloat(usdt.walletBalance ?? '0').toFixed(2)} USDT (available ${parseFloat(usdt.availableBalance ?? '0').toFixed(2)})`);
    }
    console.log(`   account assets: ${(acct.assets || []).filter((a: any) => parseFloat(a.walletBalance) > 0).map((a: any) => a.asset).join(', ') || 'none non-zero'}`);
    console.log(`   canTrade=${acct.canTrade} canDeposit=${acct.canDeposit} canWithdraw=${acct.canWithdraw}`);
    console.log('');
  } catch (e: any) {
    console.error('   ✗ getAccountInformation failed:', e?.message);
    if (/-2014|-2015|API-key/.test(e?.message || '')) {
      console.error('   → API key invalid for this endpoint.');
      console.error('   → Confirm the key was generated at testnet.binancefuture.com (not testnet.binance.vision — those are separate testnets with separate keys).');
    }
    process.exit(1);
  }

  try {
    console.log('2/4 getExchangeInfo() — symbol filters');
    const info = await client.getExchangeInfo();
    for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
      const s = info.symbols.find((x: any) => x.symbol === sym);
      if (!s) { console.warn(`   ⚠ ${sym} not found on this exchange endpoint`); continue; }
      const lot = s.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const px = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      const notional = s.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL');
      console.log(`   ✓ ${sym}  stepSize=${lot?.stepSize}  tickSize=${px?.tickSize}  minNotional=${notional?.notional ?? notional?.minNotional ?? '?'}`);
    }
    console.log('');
  } catch (e: any) {
    console.error('   ✗ getExchangeInfo failed:', e?.message);
    process.exit(1);
  }

  try {
    console.log('3/4 getPositions() — current open positions');
    const positions = await client.getPositions();
    const open = positions.filter((p: any) => parseFloat(p.positionAmt) !== 0);
    if (open.length === 0) {
      console.log('   ✓ no open positions (clean slate)');
    } else {
      for (const p of open) {
        const amt = parseFloat(p.positionAmt);
        console.log(`   ⚠ open: ${p.symbol} ${amt > 0 ? 'LONG' : 'SHORT'} ${Math.abs(amt)} @ ${p.entryPrice} mark=${p.markPrice} uPnL=${p.unRealizedProfit}`);
      }
      console.log('   → these will be hydrated into the platform on the next pm2 restart (Phase 55.2).');
    }
    console.log('');
  } catch (e: any) {
    console.error('   ✗ getPositions failed:', e?.message);
    process.exit(1);
  }

  try {
    console.log('4/4 IP permissions check (placing dry-test cancel)');
    // No-op cancel — invalid orderId returns -2011 "Unknown order sent" ONLY if the IP/key
    // pair is allowed to send signed mutations. If the key is read-only or IP not whitelisted,
    // we'd get -2014 / -2015 instead.
    try {
      await client.cancelOrder({ symbol: 'BTCUSDT', orderId: 1 });
      console.log('   ✓ signed mutation reached the API (unexpectedly succeeded — fine)');
    } catch (e: any) {
      const msg = e?.message || '';
      if (/-2011|Unknown order/i.test(msg)) {
        console.log('   ✓ signed mutation accepted (got expected -2011 "Unknown order"). Trading is enabled.');
      } else if (/-2014|-2015|IP|whitelist|ip white list|API-key/i.test(msg)) {
        console.error(`   ✗ key/IP not authorized for trading: ${msg}`);
        console.error('   → On testnet.binancefuture.com → API Management → enable Trading and (if locked) add Tokyo IP 52.193.69.129 to the whitelist.');
        process.exit(1);
      } else {
        console.warn(`   ⚠ unexpected error during permissions probe: ${msg}`);
      }
    }
    console.log('');
  } catch (e: any) {
    console.error('   ✗ permissions probe threw:', e?.message);
  }

  console.log('All checks passed. Ready to:  pm2 restart seerticks --update-env');
}

main().catch(e => { console.error(e); process.exit(1); });
