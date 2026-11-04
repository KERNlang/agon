# Slice 6 production authority and compatibility boundary

The CLI and MCP process now await physical first-party package activation before
exposing a command or tool. Bootstrap reads only the user-global modular host
root (`AGON_MODULAR_HOST_ROOT`, otherwise `$AGON_HOME/modular-host`), validates
the canonical pointer and selected immutable generation, compares the selected
and host desired-state snapshots, resolves the effective package closure, and
imports only effective physical first-party mod packages. A missing active
package, malformed pointer, corrupt generation, or divergent snapshot fails
closed. With no modular host state, the frozen full-compatible 36-mod selection
preserves existing behavior without writing any state.

Durable boot also recomputes the full desired-state and graph hashes, requires
the lock source locators to equal the resolver exact 49-package closure, and
binds every loaded user mod by manifest ID while its npm package name remains
the source locator. Negative controls reject duplicate locators, missing or
extra closure members, manifest/version/dependency drift, and forged graph
identity.

Every CLI, TUI, MCP, and Cesar dispatch checks the process-pinned generation.
If the canonical pointer appears, disappears, changes, or becomes unreadable,
the process returns `MOD_GENERATION_MISMATCH` with restart-required semantics
before compatibility execution. MCP listing and calling use the same selected
set. Generated availability therefore cannot be bypassed by cached legacy
dispatch tables.

The physical packages register through the public Mod API in deterministic
dependency order. Only kernel and hidden-support records may be synthesized.
Successful deactivation disposes committed records in reverse order. Production
tests cover the default physical 36-package boot, durable desired-state boot,
disabled reachability across all five surfaces, missing packages, stale pointer
detection, and MCP metadata preservation.

S6 deliberately retains five narrow behavior executors while the generated
registry owns exposure. They are enumerated in
`evidence/modular-agon-slice6-compatibility-adapters.json`; each has an owner,
kill-list IDs, a removal condition, and an executable unreachability proof.
They are not catalogs and cannot make a disabled contribution callable. They
must be physically eliminated before final S9 acceptance; their presence is
reported as temporary rather than mislabeled as completed kill-list removal.
