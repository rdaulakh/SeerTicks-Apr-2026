#!/usr/bin/env bash
# Tokyo deploy — three-step incantation to keep dist/index.js in sync with main.
#
# Why this exists: pm2 on the Tokyo box runs the bundled output at
# /home/seer/app/dist/index.js, NOT the .ts source. A bare `git pull` looks
# successful (HEAD moves forward, pm2 restart returns OK) but the running
# process keeps executing the stale bundle — new agents/handlers silently
# don't load. This script enforces the rebuild step so that mistake is
# impossible.
#
# Run from /home/seer/app on the Tokyo box (as the seer user):
#   ./scripts/deploy-tokyo.sh
# Or from your laptop:
#   ssh ubuntu@seerticks.com "sudo -u seer bash -c 'cd /home/seer/app && ./scripts/deploy-tokyo.sh'"

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Fetching latest from origin/main..."
git fetch origin
git reset --hard origin/main
echo "    HEAD: $(git log -1 --oneline)"

echo "==> Rebuilding CLIENT (vite build → dist/public.new, atomic swap)..."
# Phase 74 — previously this script only rebuilt the server bundle, so any
# frontend changes (Navigation.tsx, page components, etc) never reached prod
# until someone manually ran 'npm run build'. dist/public was stale from
# May 7 even after multiple successful deploys. This step makes the
# client+server build atomic.
#
# Phase 93.5 — build to dist/public.new, then RENAME atomically. The previous
# in-place build deleted dist/public/assets/* before re-creating them, opening
# a multi-second window during which lazy-loaded chunks 404'd for any user
# clicking a route mid-deploy. With atomic swap, the live dist/public stays
# intact until the new build is complete and verified. Old build kept as
# dist/public.old until the next deploy (rollback safety).
PROJECT_ROOT="$(pwd)"
ABS_OUTDIR="$PROJECT_ROOT/dist/public.new"
# vite.config sets `root: client/`. Both relative and absolute --outDir args
# get resolved against client/ in this setup (verified empirically on the
# Tokyo box). Easiest robust approach: build to a TEMP scratch dir, then
# unconditionally move the resulting tree to the canonical staging path.
SCRATCH_DIR="$PROJECT_ROOT/dist/_vite_scratch_$$"
rm -rf "$SCRATCH_DIR" "$ABS_OUTDIR"
mkdir -p "$SCRATCH_DIR"
npx vite build --outDir "$SCRATCH_DIR" --emptyOutDir
# vite may have written either to $SCRATCH_DIR (good) or to
# client/$SCRATCH_DIR (root-rooted resolution). Find the actual location
# of index.html and move it to the canonical staging path.
ACTUAL_OUT=""
if [ -f "$SCRATCH_DIR/index.html" ]; then
  ACTUAL_OUT="$SCRATCH_DIR"
elif [ -f "client$SCRATCH_DIR/index.html" ]; then
  ACTUAL_OUT="client$SCRATCH_DIR"
else
  # Last resort: scan for any newly-written index.html
  FOUND=$(find "$PROJECT_ROOT" -maxdepth 6 -name index.html -newer "$SCRATCH_DIR" 2>/dev/null | grep -E "(dist|scratch)" | head -1)
  if [ -n "$FOUND" ]; then ACTUAL_OUT="$(dirname "$FOUND")"; fi
fi
if [ -z "$ACTUAL_OUT" ] || [ ! -f "$ACTUAL_OUT/index.html" ]; then
  echo "    ERROR: could not locate vite output (no index.html anywhere) — keeping current dist/public live."
  exit 1
fi
mv "$ACTUAL_OUT" "$ABS_OUTDIR"
# Clean up any empty parent dirs vite may have created.
rmdir client/dist 2>/dev/null || true
rmdir "$(dirname "$SCRATCH_DIR")" 2>/dev/null || true
# Sanity-check: index.html must exist before we swap.
if [ ! -f dist/public.new/index.html ]; then
  echo "    ERROR: dist/public.new/index.html missing after build — aborting swap, keeping current dist/public live."
  exit 1
fi
NEW_INDEX_SIZE=$(stat -c %s dist/public.new/index.html 2>/dev/null || stat -f %z dist/public.new/index.html)
echo "    Built dist/public.new: $NEW_INDEX_SIZE bytes index.html"
# Atomic swap: rename current to .old, new to current. Both are on the same
# filesystem so rename(2) is atomic at the kernel level — no 404 window.
if [ -d dist/public ]; then
  rm -rf dist/public.old
  mv dist/public dist/public.old
fi
mv dist/public.new dist/public
echo "    ✓ Atomic swap complete (previous build retained as dist/public.old)"

echo "==> Rebuilding server bundle (esbuild)..."
npx esbuild server/_core/index.ts \
  --platform=node \
  --packages=external \
  --bundle \
  --format=esm \
  --outfile=dist/index.js
echo "    Built dist/index.js ($(stat -c %s dist/index.js 2>/dev/null || stat -f %z dist/index.js) bytes)"

echo "==> Restarting pm2 process..."
pm2 restart seerticks --update-env
sleep 6

echo "==> Status:"
pm2 status seerticks

echo "==> Recent agent registration log:"
tail -8000 /home/seer/.pm2/logs/seerticks-out.log \
  | grep -E "Initialized [0-9]+ agents for|Registered agent" \
  | tail -25

echo "==> Done."
