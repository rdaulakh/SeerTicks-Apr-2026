/**
 * CLI entry for TradingQualityAuditor (Phase 59).
 *
 * Runs all checks against the live DB, writes a markdown report to
 * /home/seer/app/data/audits/{ISO}.md, and prints a one-line summary
 * + the report path to stdout (so cron output stays grep-friendly).
 *
 * Usage on Tokyo:
 *   npx tsx scripts/run-audit.ts                 # default 24h window
 *   npx tsx scripts/run-audit.ts --hours=6       # last 6h only
 *   npx tsx scripts/run-audit.ts --print         # also dump the report to stdout
 *
 * Schedule (Tokyo crontab):
 *   0 *\/6 * * * cd /home/seer/app && /usr/bin/env npx tsx scripts/run-audit.ts >> /home/seer/app/data/audits/cron.log 2>&1
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../server/db';
import * as schema from '../drizzle/schema';
import { TradingQualityAuditor, renderAuditMarkdown } from '../server/audit/TradingQualityAuditor';

interface CliArgs {
  hours: number;
  print: boolean;
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    hours: 24,
    print: false,
    outDir: '/home/seer/app/data/audits',
  };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--hours=(\d+)$/);
    if (m) { args.hours = parseInt(m[1], 10); continue; }
    if (a === '--print') { args.print = true; continue; }
    const od = a.match(/^--out-dir=(.+)$/);
    if (od) { args.outDir = od[1]; continue; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const db = await getDb();
  if (!db) {
    console.error('audit: DB unavailable');
    process.exit(1);
  }

  const auditor = new TradingQualityAuditor(db, schema, args.hours);
  const report = await auditor.runFullAudit();
  const markdown = renderAuditMarkdown(report);

  fs.mkdirSync(args.outDir, { recursive: true });
  const safeIso = report.summary.generatedAt.replace(/:/g, '-');
  const reportPath = path.join(args.outDir, `${safeIso}.md`);
  fs.writeFileSync(reportPath, markdown, 'utf8');
  // Also keep a stable "latest.md" pointer so callers don't have to scan the dir.
  fs.writeFileSync(path.join(args.outDir, 'latest.md'), markdown, 'utf8');

  const s = report.summary;
  const summaryLine =
    `audit ${s.generatedAt} (${s.windowHours}h): ` +
    `decisions=${s.decisionsTotal} (exec=${s.decisionsExecuted}/skip=${s.decisionsSkipped}/veto=${s.decisionsVetoed}), ` +
    `closed=${s.tradesClosed}, open=${s.openPositions}, ` +
    `findings: misses=${s.highCostMisses} earlyExits=${s.suboptimalExits} stuck=${s.stuckPositions} drift=${s.engineDriftEvents} deadAgents=${s.agentDeadWeight} ` +
    `→ ${reportPath}`;
  console.log(summaryLine);

  if (args.print) {
    console.log('');
    console.log(markdown);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('audit FATAL:', e?.message ?? e);
  process.exit(1);
});
