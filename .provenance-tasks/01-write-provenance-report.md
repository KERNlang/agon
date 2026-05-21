# Task: add `writeProvenanceReport` helper to @agon/core

Add a new exported function to `@agon/core`:

```ts
writeProvenanceReport(
  manifest: ForgeManifest,
  manifestPath: string,
  outDir: string,
  format?: 'md' | 'json' | 'both', // default 'md'
): string
```

## Behavior
- Build the provenance ledger by calling the EXISTING `buildForgeProvenance(manifest, manifestPath)`.
- Render with the EXISTING `renderProvenanceMarkdown(ledger)` and `renderProvenanceJson(ledger)`.
- Write into `outDir`:
  - `'md'`   → write `provenance.md`; return its path.
  - `'json'` → write `provenance.json`; return its path.
  - `'both'` → write both; return the `provenance.md` path.
- Create `outDir` if missing (`mkdirSync(outDir, { recursive: true })`).
- Return the absolute path of the primary file written (the `.md` unless format is `'json'`).

## Where (ALL IN KERN — do NOT hand-write logic in TypeScript)
- Implement in `packages/core/src/kern/blocks/provenance.kern` (the helpers it reuses already live there). Add a new `fn name=writeProvenanceReport ... export=true`.
- Re-export it from the facade `packages/core/src/provenance.ts` and the barrel `packages/core/src/index.ts` (next to `buildForgeProvenance`).
- Run `kern:compile` (the build does this) so `generated/blocks/provenance.ts` is regenerated. NEVER edit `generated/` by hand.

## Done when (frozen gate)
`npm run build && npm run test:ts -- tests/unit/forge-provenance.test.ts` passes.
The test in `tests/unit/forge-provenance.test.ts` is the authoritative contract — do not modify it.
