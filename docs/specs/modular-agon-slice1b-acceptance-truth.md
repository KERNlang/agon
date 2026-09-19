# Modular Agon Slice 1B — acceptance truth

## Corrected subject

Slice 1B qualifies Git objects, not the ambient worktree. The pre-extraction
legacy inventory therefore contains **849 assignments** from the exact staged
subject, not the prior ambient count of 852. The prior generator observed three
surfaces from unrelated unstaged operator work (`ext status`,
`chromeExtensionOrigin`, and the provider `engines` path). Those changes remain
untouched in their original worktree and are not silently absorbed into this
release candidate.

This correction is intentional acceptance evidence, not reduced coverage:
every surface present in the qualified subject has one destination, and every
assignment points to a source path in that subject. When those independent
operator changes are committed and deliberately rebased, inventory drift must
add their owners through the generated ledger before qualification can pass.

## Repaired invariants

- `@types/semver` is a declared root development dependency. Clean package
  compilation no longer depends on ignored declaration shims.
- The current physical package graph contains 151 declared and 151 unique directed edges.
- Index and commit subjects have distinct Git-object hashes and distinct labels.
- Ignored, untracked, and unstaged source-bearing files fail qualification.
- Commit qualification additionally requires the index to equal the commit.
- Review artifacts must be normalized repository-relative paths, be present in
  the qualified Git subject, have matching object-content hashes, use distinct
  engines, and bind to the exact subject kind and hash.
- The 160-test legacy workflow corpus is frozen as raw Vitest output. Seven raw
  persisted chat/result/room/tool envelopes are captured before redaction or
  presentation, including an explicit pre-redaction witness.
- Normalization, redaction, formatting, and rendering retain separate named test
  owners; oracle verification checks their content hashes independently.
- Negative controls mutate every acceptance class so plausible-but-wrong output
  turns the corresponding gate red.

## Stability finding fixed during capture

The first two workflow captures stalled at 159/160 because Forge's optional
quality probes invoked `npx` inside a candidate worktree. When Prettier was not
installed, `npx` attempted network resolution and consumed the test timeout.
Forge now invokes only an already-present local binary and degrades immediately
when an optional checker is absent. The canonical third capture is 160/160.

## Qualification sequence

1. Stage the exact candidate and run
   `npm run spec:modular-slice1b:qualify:index`.
2. Complete independent review against that recorded index hash.
3. Commit only after all local findings are fixed or evidence-refuted.
4. From the clean commit, run
   `npm run spec:modular-slice1b:qualify:commit` in this checkout and a second
   independently materialized checkout.
5. Record both receipts and their content hashes. Only then may S2 begin.
