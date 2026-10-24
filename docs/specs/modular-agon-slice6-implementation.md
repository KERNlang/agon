# Modular Agon Slice 6 implementation

Slice 6 makes one immutable, owner-tagged registry generation the availability
authority for CLI, TUI, MCP, Cesar, and generated documentation. The selected
generation is atomic: clients pin its ID, stale clients receive a typed
`MOD_GENERATION_MISMATCH` with `restartRequired: true`, failed candidate
verification cannot move the pointer, and rollback selects a retained
generation as one operation.

## Physical activation

The generated catalog contains 440 surface records owned by 40 package owners.
All 36 user-toggleable owners must be supplied as physical packages and activate
through the public Mod API. Missing active packages fail closed; the host never
synthesizes a user mod to make a projection appear complete. Only minimal kernel
and hidden shared-support records are synthesized by the host. Reverse-order
disposal removes committed records, and tests prove disabled owners are absent
from every real adapter.

The existing command/tool implementations remain narrow compatibility
executors during cutover. They no longer decide exposure: generated availability
is checked before lazy CLI loading, TUI parsing, MCP listing/calling, Cesar tool
registration, or docs generation. Their eventual removal stays governed by the
migration kill-list; this document does not relabel them as physical mod code.

## Surface contracts

- CLI: the generated catalog filters the compatibility implementation loader;
  execution rechecks availability before importing a command.
- TUI: slash help, hidden intent variants, aliases, and parser dispatch are
  generation-gated. Alias ownership is unique.
- MCP: listing and call dispatch reject absent or disabled tool IDs before any
  legacy branch can execute.
- Cesar: only generated tool IDs enter the executable `ToolRegistry`.
- Docs: `docs/modes.md` can be generated only when its catalog contribution is
  selected; the negative control removes it and proves generation fails.

## Verification

The parity suite compares each real adapter with the same generated catalog,
activates and unloads all 36 physical packages, tests disabled reachability on
all five surfaces, checks aliases and collisions, verifies accessibility
fallbacks, and exercises atomic selection, stale clients, rollback, and failed
candidate selection. Performance qualification measures physical import plus
activation across 15 isolated processes and records the p95 and RSS budgets in
`docs/specs/evidence/modular-agon-slice6-performance.json`.

Production bootstrap and the temporary-executor boundary are specified in
[`modular-agon-slice6-production-authority.md`](./modular-agon-slice6-production-authority.md).
