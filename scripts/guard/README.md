# Cesar Guard Scripts

## reexport-surface.mjs
Catches `export { x } from './y.js'` re-exports of a symbol that is also CALLED
locally without a local binding (a runtime ReferenceError TypeScript can't see).

Usage:
```bash
npm run guard:reexports
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
