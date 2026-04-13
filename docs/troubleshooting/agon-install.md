# Agon Install Troubleshooting

## Symptom: composer input lag, missing Ink primitives, schema spam

If you see any of these on a fresh clone or after pulling:

- Composer feels jittery; keystrokes drop or arrive out of order while Cesar streams
- `[agon] Invalid engine config claude.json: companion.protocol: Invalid option: expected one of "jsonrpc"|"acp"|"structured-cli"` repeated several times on startup
- `npm run kern:compile` produces output without `__inkSafe` wrappers, throttle setters, or `setInterval` timer ticks
- `node_modules/@kernlang/terminal/package.json` reports a version below 3.2.3

…your install is wedged on a stale @kernlang/* family.

## Root cause

`@kernlang/cli@3.2.3` on npm declares its sibling packages (`@kernlang/core`,
`@kernlang/terminal`, `@kernlang/native`, etc.) as `workspace:*`. When installed
outside the kern-lang monorepo, that fails to resolve and npm/pnpm falls back
to whatever cached copies are already on disk — typically 3.1.7, which has no
Ink target, no throttle primitive, no animation primitive.

The `@kernlang/cli` binary you invoke is 3.2.3, but it `import`s
`transpileInk` from `@kernlang/terminal@3.1.7`, which doesn't emit any of the
features Agon needs. Result: silent regression on every recompile.

## Fix (30 minutes, zero code risk)

```bash
cd ~/path/to/agon
rm -rf node_modules package-lock.json pnpm-lock.yaml
npm install
```

Then verify the family resolved correctly:

```bash
for p in cli core terminal react native vue evolve; do
  v=$(cat node_modules/@kernlang/$p/package.json 2>/dev/null | grep '"version"' | head -1)
  echo "$p: $v"
done
```

You should see **3.2.3 on every line**. If any of them is still 3.1.7, the
root `package.json` `optionalDependencies` block is missing that package — add
`"@kernlang/<name>": "~3.2.3"` and reinstall.

After a clean install:

```bash
npm run kern:compile
npm run typecheck
npm run test
```

Verify the compile produced Ink primitives:

```bash
grep -c "__inkSafe" packages/cli/src/generated/surfaces/app.tsx
# should report 50+; if it's 0, the wrong terminal package was loaded
```

## Why not just `npm install`?

Without the lockfile delete, npm trusts the existing resolution graph and
won't upgrade the sibling `@kernlang/*` packages even if you bump the pins.
Lockfile + node_modules removal forces a clean resolve from the registry.

## Related

- `chore(deps): pin full @kernlang/* family to ~3.2.3` (commit `42ea3c3`) —
  added every required `@kernlang/*` package to root `optionalDependencies` so
  fresh clones resolve correctly.
- `perf(cli): memoize loadConfig + streamSnippet to fix composer input lag`
  (commit `20470ff`) — orthogonal to this; depends on the Ink-aware compiler
  having emitted `__inkSafe` and `throttle=90` on `streamingText`.
