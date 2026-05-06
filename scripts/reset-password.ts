/**
 * Admin password reset utility.
 *
 * Reads new password from stdin (so it never lands in shell history or argv),
 * bcrypt-hashes it, and updates users.passwordHash for the given email.
 *
 * Usage on the Tokyo box (as the seer user):
 *   cd /home/seer/app
 *   echo -n 'YourNewPassword' | npx tsx scripts/reset-password.ts <email>
 *
 * Or interactive (no echo):
 *   npx tsx scripts/reset-password.ts <email>   # then type pw + Enter
 *
 * Sets loginMethod to 'email' so the user can log in with email/password
 * even if their account was originally federated.
 */

import { getDb } from '../server/db';
import { users } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import * as readline from 'readline';

async function readPassword(): Promise<string> {
  // If stdin is a pipe (echo '...' | tsx ...), read it directly.
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  // Interactive — prompt without echo.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    process.stdout.write('New password: ');
    const stdinAny = process.stdin as any;
    if (typeof stdinAny.setRawMode === 'function') stdinAny.setRawMode(true);
    let buf = '';
    process.stdin.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') {
          if (typeof stdinAny.setRawMode === 'function') stdinAny.setRawMode(false);
          rl.close();
          process.stdout.write('\n');
          return resolve(buf);
        }
        if (ch === '') process.exit(1); // ctrl-c
        if (ch === '') { buf = buf.slice(0, -1); continue; } // backspace
        buf += ch;
      }
    });
  });
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: tsx scripts/reset-password.ts <email>');
    process.exit(1);
  }

  const password = (await readPassword()).trim();
  if (password.length < 8) {
    console.error('Password too short (need ≥8 chars)');
    process.exit(1);
  }

  const db = await getDb();
  if (!db) { console.error('DB unavailable'); process.exit(1); }

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length === 0) {
    console.error(`No user found for ${email}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.update(users)
    .set({ passwordHash, loginMethod: 'email' })
    .where(eq(users.email, email));

  console.log(`✓ Password reset for ${email} (loginMethod=email)`);
}

main().catch(e => { console.error(e); process.exit(1); });
