/**
 * Admin tool to set Binance Futures testnet API keys in /home/seer/app/.env.
 *
 * Reads BINANCE_FUTURES_API_KEY and BINANCE_FUTURES_SECRET_KEY from stdin
 * with no echo (like a password prompt) so the values never appear in shell
 * history, terminal scrollback, or process argv. Atomically rewrites .env
 * preserving all other lines, only updating the four BINANCE_FUTURES_* keys.
 *
 * Usage on Tokyo:
 *   ssh -t -i ~/.ssh/seerticks-prod-key.pem ubuntu@seerticks.com \
 *     "sudo -u seer bash -c 'cd /home/seer/app && npx tsx scripts/set-futures-keys.ts'"
 *
 * After it finishes:
 *   pm2 restart seerticks --update-env
 *
 * The -t flag forces a TTY so the no-echo prompt works.
 */

import * as fs from 'fs';
import * as readline from 'readline';

const ENV_PATH = '/home/seer/app/.env';

function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdinAny = process.stdin as any;
    if (typeof stdinAny.setRawMode === 'function') stdinAny.setRawMode(true);
    let buf = '';
    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') {
          if (typeof stdinAny.setRawMode === 'function') stdinAny.setRawMode(false);
          process.stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          return resolve(buf);
        }
        if (ch === '') process.exit(1);   // Ctrl-C
        if (ch === '') { buf = buf.slice(0, -1); continue; } // Backspace
        buf += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

function upsertEnvLine(content: string, key: string, value: string): string {
  const lines = content.split('\n');
  const re = new RegExp(`^\\s*${key}\\s*=`);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`${key}=${value}`);
  }
  return lines.join('\n');
}

async function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`No .env at ${ENV_PATH}`);
    process.exit(1);
  }

  console.log(`Updating ${ENV_PATH}`);
  console.log('Source: https://testnet.binancefuture.com/ → API Management');
  console.log('(Inputs are hidden — no echo to terminal.)\n');

  const apiKey = (await promptHidden('BINANCE_FUTURES_API_KEY:    ')).trim();
  if (apiKey.length < 20) {
    console.error('API key looks too short — aborting');
    process.exit(1);
  }
  const apiSecret = (await promptHidden('BINANCE_FUTURES_SECRET_KEY: ')).trim();
  if (apiSecret.length < 20) {
    console.error('Secret looks too short — aborting');
    process.exit(1);
  }

  let content = fs.readFileSync(ENV_PATH, 'utf8');
  content = upsertEnvLine(content, 'BINANCE_FUTURES_API_KEY', apiKey);
  content = upsertEnvLine(content, 'BINANCE_FUTURES_SECRET_KEY', apiSecret);
  content = upsertEnvLine(content, 'BINANCE_FUTURES_USE_TESTNET', '1');
  content = upsertEnvLine(content, 'BINANCE_FUTURES_LEVERAGE', '1');

  // Atomic write: tmp → rename. Preserves the original on a write error.
  const tmp = `${ENV_PATH}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, ENV_PATH);

  console.log('\n✓ .env updated:');
  console.log(`  BINANCE_FUTURES_API_KEY    = ${apiKey.slice(0, 6)}…${apiKey.slice(-4)} (length ${apiKey.length})`);
  console.log(`  BINANCE_FUTURES_SECRET_KEY = ${apiSecret.slice(0, 6)}…${apiSecret.slice(-4)} (length ${apiSecret.length})`);
  console.log('  BINANCE_FUTURES_USE_TESTNET = 1');
  console.log('  BINANCE_FUTURES_LEVERAGE    = 1');
  console.log('\nNow run:  pm2 restart seerticks --update-env');
}

main().catch((e) => { console.error(e); process.exit(1); });
