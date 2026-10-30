// Dedicated dist entry: the Chrome native-messaging host launcher.
//
// This is the "host launcher" the com.kernlang.agon manifest's `path` points at —
// a node entry in the CLI dist (dist/browser-host.js), reachable by absolute path.
// Chrome execs it directly (the tsup banner adds the `#!/usr/bin/env node`
// shebang; `browser-host install` chmods it +x). It ONLY runs the pairing broker
// loop — it has no CLI subcommands, and it spawns `agon serve` via its sibling
// dist/index.js (see resolveCliEntry), never itself.
import { runBrowserHostLauncher } from './commands/browser-host.js';
import { encodeFrame, PROTOCOL } from '@kernlang/agon-support-browser-bridge';

void runBrowserHostLauncher().catch(error => {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'MOD_HOST_BOOT_FAILED';
  process.stdout.write(encodeFrame({ ok: false, protocol: PROTOCOL, code,
    error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
