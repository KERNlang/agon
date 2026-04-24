# Cesar Guard Scripts

## pre-commit-kern.mjs
Auto-runs `npm run kern:compile` when `.kern` files are staged. Aborts commit on failure.

Install:
```bash
# Already wired via .git/hooks/pre-commit
cat .git/hooks/pre-commit
```

## forge-retry.mjs
Wrapper for forge commands with exponential backoff on `.git/index.lock` races.

Usage:
```bash
node scripts/guard/forge-retry.mjs npm run forge --some-task
```

## confidence-tracker.mjs
Logs calibration data. Run report:
```bash
node .agon/confidence-tracker.mjs
# or after adding to PATH:
npx agon confidence-report
```

Note: `.agon/` is gitignored; copy `confidence-tracker.mjs` to your local `.agon/` manually.
