# @kernlang/agon-saas-api

FastAPI proof-of-concept. **Internal-only, no auth, not the SaaS launch.** This
package exists to give the SaaS roadmap a real testbed for an HTTP boundary over
Agon's orchestration modes.

## Status: Phase 0

- Single `GET /health` endpoint
- Hand-maintained Python (FastAPI + uvicorn) in `src/generated/` — the directory
  name is legacy (this output was originally transpiled from `.kern`); it is now
  edited directly and nothing regenerates it
- No orchestration endpoints, no Job queue, no persistence

## Run

```bash
pip install -r packages/saas-api/requirements.txt
uvicorn agon.saas_api.health:app --host 0.0.0.0 --port 3030
```

(Exact module path depends on the package layout.)

## Output check

The FastAPI output has an executable checker that turns the documented Python
gaps into regression checks:

```bash
npm run check:gaps -w packages/saas-api
```

It passes 2 files (entrypoint + route module) with zero findings, and stays in
CI as a regression guard against hand-edits reintroducing any of the Phase 0
problems below.

## Roadmap

Synthesized from the 6-engine brainstorm + recheck (Codex / Claude / Gemini / Kimi / Minimax / Z.AI).

### Phase 1 — `Job` DU in `@kernlang/agon-core`

Subprocess-spawning CLI engines do not survive a stateless HTTP request model.
Forge runs are minutes long; brainstorms with the full 6-engine roster take
8-12 min. Before any real handler is wired, introduce a `Job` discriminated
union in `packages/core/src/generated/models/`:

```
queued | running | streaming | done | error
```

Expose `submit / status / result / stream` rather than direct
`forge / brainstorm / tribunal` endpoints. The CLI must round-trip through this
DU first — if it feels awkward in the CLI, the API contract is wrong, fix it
before HTTP exists.

### Phase 2 — One real endpoint, sync-only

`POST /brainstorm` capped at 3 engines, returning a completed `JobResult`. Shells
out through the existing `adapter-cli` boundary; does not re-implement engine
dispatch. Snapshot-test the Python output; integration-test the live FastAPI
server with a mocked `CliAdapter`.

### Phase 3 — Streaming + remaining modes

SSE for forge (async generators are already proven in `packages/forge`).
`GET /jobs/{id}/stream` returns SSE chunks. `POST /tribunal` and `POST /forge`
ship async-only — return job ID immediately, poll via `GET /jobs/{id}`.
Auto-generate the OpenAPI spec.

### Phase 4 — Defer (explicit non-goals)

- Auth, billing, rate limiting, multi-tenant state, persistence
- Public domain hosting

## What stays out

- **No business logic in Python.** The orchestration logic stays in the
  TypeScript packages; `saas-api/` adds only the HTTP boundary and imports from
  them. Drift between the two = bug.

## Phase 0 output invariants

The checker enforces these properties of the emitted service:

1. **Python-native file headers** in every `.py` file (no TS-style header).
2. **Multi-file route emission** — `routes/get_health.py` alongside the
   entrypoint, plus `__init__.py` and the module manifest.
3. **Uvicorn binds to `127.0.0.1`** by default and reads `HOST` from env (never
   a hardcoded `0.0.0.0`).
4. **CORS is explicit** — methods
   `["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]`, headers
   `["Authorization", "Content-Type", "X-Request-ID"]`, and a
   `http://localhost:3000` default for `CORS_ORIGINS`.
5. **`JSONResponse` imported at module top**, not lazily inside the exception
   handler.
