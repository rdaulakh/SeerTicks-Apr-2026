#!/usr/bin/env bash
# Weekly Bayesian threshold recalibration — installed in /etc/cron.d on Tokyo.
#
# Runs the calibration analyzer on the last 7 days of A/B data, writes a
# JSON report into /home/seer/app/data/calibration/, and (if --apply-flag
# is set in /home/seer/app/.calibration-auto-apply) updates .env with
# the suggested thresholds and triggers a pm2 restart.
#
# The auto-apply gate exists because thresholds drive real money decisions.
# Default: report-only. Operator flips the gate by touching .calibration-auto-apply.
#
# Install: /etc/cron.d/seerticks-bayesian
#   17 3 * * 0 seer /home/seer/app/scripts/cron_calibrate_bayesian.sh >> /var/log/seerticks-calibration.log 2>&1
#   ^ Sunday 03:17 local (off-minute, off-hour — avoids the "everyone runs at midnight" cron herd)

set -euo pipefail

APP_DIR="/home/seer/app"
REPORT_DIR="$APP_DIR/data/calibration"
mkdir -p "$REPORT_DIR"
cd "$APP_DIR"

echo "=================================================="
echo "Bayesian calibration — $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "=================================================="

# Run the analyzer (dry-run by default — writes report, no .env changes)
if [ -f "$APP_DIR/.calibration-auto-apply" ]; then
  echo "Auto-apply enabled — thresholds will be written to .env + pm2 restart"
  npx tsx scripts/calibrate_bayesian.ts --days 7 --apply
  echo "Restarting pm2 to pick up new thresholds..."
  pm2 restart seerticks --update-env || true
else
  echo "Dry-run only (touch .calibration-auto-apply to enable auto-apply)"
  npx tsx scripts/calibrate_bayesian.ts --days 7
fi

# Move generated calibration-report-*.json into the dated dir
for f in calibration-report-*.json; do
  if [ -f "$f" ]; then
    mv "$f" "$REPORT_DIR/$(date -u +%Y-%m-%d)-$(basename "$f")"
  fi
done

echo "Done."
