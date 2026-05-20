#!/usr/bin/env node
// Root postinstall — chains patch-package then attempts the optional Python
// sidecar install. Failures here never block `npm install`; the regex fallback
// keeps agon working without fastembed.
import { spawnSync } from 'node:child_process';

const log = (msg) => console.log(`[agon postinstall] ${msg}`);

// 1. patch-package (preserve existing behavior)
const pp = spawnSync('npx', ['--yes', 'patch-package'], { stdio: 'inherit' });
if (pp.status !== 0) {
  log('patch-package failed (continuing anyway)');
}

// 2. Optional Python sidecar — skip cleanly in any of these cases
if (process.env.AGON_SKIP_PY_INSTALL === '1' || process.env.CI === 'true') {
  log('skipping Python sidecar (AGON_SKIP_PY_INSTALL=1 or CI=true)');
  process.exit(0);
}

const py = spawnSync('python3', ['--version'], { stdio: 'ignore' });
if (py.status !== 0) {
  log('python3 not found — fastembed sidecar skipped (regex fallback active)');
  process.exit(0);
}

// Already installed? Skip the pip install to avoid noise + bandwidth.
const probe = spawnSync('python3', ['-c', 'import fastembed, numpy, tree_sitter'], { stdio: 'ignore' });
if (probe.status === 0) {
  log('Python sidecar already present — skipping reinstall');
  process.exit(0);
}

log('installing optional Python sidecar (fastembed + tree-sitter)…');
const install = spawnSync('npm', ['run', 'install:python', '-w', 'packages/dedup'], {
  stdio: 'inherit',
});
if (install.status !== 0) {
  log('Python sidecar install failed (optional) — regex fallback active');
  process.exit(0); // never fail the parent npm install
}
log('Python sidecar installed ✓');
