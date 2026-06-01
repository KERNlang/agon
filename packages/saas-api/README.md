# @kernlang/agon-saas-api

KERN→FastAPI proof-of-concept. **Internal-only, no auth, not the SaaS launch.** This package exists to validate `@kernlang/python` against Agon's KERN dialect and to give the SaaS roadmap a real testbed.

## Status: Phase 0

- Single `GET /health` endpoint
- Compiles `.kern` source to Python (FastAPI + uvicorn) via `npm run kern:compile`
- No orchestration endpoints, no Job queue, no persistence

## Build

```bash
npm run kern:compile -w packages/saas-api
```

Generated Python lands in `src/generated/`. Run the server with:

```bash
pip install -r packages/saas-api/requirements.txt
uvicorn agon.saas_api.health:app --host 0.0.0.0 --port 3030
```

(Exact module path depends on transpiler output structure.)

## Gap Check

The FastAPI output has a KERN-authored checker that turns the documented Python gaps into executable checks:

```bash
npm run check:gaps -w packages/saas-api
```

As of kern v3.5.1 this passes — all five Phase 0 gaps below are closed upstream (the package was renamed `@kernlang/fastapi` → `@kernlang/python` in v3.5.3). The check stays in CI as a regression guard.

## Roadmap

Synthesized from the 6-engine brainstorm + recheck (Codex / Claude / Gemini / Kimi / Minimax / Z.AI).

### Phase 1 — `Job` DU in `@kernlang/agon-core`

Subprocess-spawning CLI engines do not survive a stateless HTTP request model. Forge runs are minutes long; brainstorms with the full 6-engine roster take 8-12 min. Before any real handler is wired, introduce a `Job` discriminated union in `packages/core/src/kern/models/job.kern`:

```
queued | running | streaming | done | error
```

Expose `submit / status / result / stream` rather than direct `forge / brainstorm / tribunal` endpoints. The CLI must round-trip through this DU first — if it feels awkward in the CLI, the API contract is wrong, fix it before HTTP exists.

### Phase 2 — One real endpoint, sync-only

`POST /brainstorm` capped at 3 engines, returning a completed `JobResult`. Shells out through the existing `adapter-cli` boundary; does not re-implement engine dispatch. Snapshot-test the generated Python output; integration-test the live FastAPI server with a mocked `CliAdapter`.

### Phase 3 — Streaming + remaining modes

SSE for forge using KERN's `stream=true` primitive (already proven in `packages/forge`). `GET /jobs/{id}/stream` returns SSE chunks. `POST /tribunal` and `POST /forge` ship async-only — return job ID immediately, poll via `GET /jobs/{id}`. Auto-generate the OpenAPI spec.

### Phase 4 — Defer (explicit non-goals)

- Auth, billing, rate limiting, multi-tenant state, persistence
- Public domain hosting

## What stays out

- **No business logic in Python.** Handlers stay in KERN; drift between targets = bug.
- **No `target=fastapi` on existing forge/brainstorm/tribunal `.kern` files.** Those stay TS-only. `saas-api/` *imports* from them and adds the HTTP boundary.

## KERN-GAP reporting

Agon is a primary testbed for `@kernlang/python`. Any limitation hit during transpile is filed as a `// KERN-GAP:` comment in the offending `.kern` file. See top-level `KERN-GAPS.md` for accumulated reports.

### Phase 0 gaps — closed in kern v3.5.1

All five originally-filed Phase 0 gaps are fixed upstream as of kern v3.5.1 (then `@kernlang/fastapi`, renamed `@kernlang/python` in v3.5.3):

1. **TS-style file header in Python output** — fixed: `.py` files now emit a Python `#` comment header natively. The local `scripts/fix-python-header.mjs` workaround was deleted.
2. **Multi-file route emission missing** — fixed: `routes/get_health.py` is now emitted alongside the entrypoint, plus `__init__.py` and a `kern-python-modules.json` manifest.
3. **Uvicorn binds to 0.0.0.0 by default** — fixed: entrypoint now binds to `127.0.0.1` and reads `HOST` from env.
4. **CORS template emits unsafe combination** — fixed: explicit methods/headers (`["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]` / `["Authorization", "Content-Type", "X-Request-ID"]`) and a `http://localhost:3000` default for `CORS_ORIGINS`.
5. **Exception handler imports `JSONResponse` lazily** — fixed: import hoisted to module top.

The executable check (`npm run check:gaps -w packages/saas-api`) passes 2 files (entrypoint + route module) with zero gap findings.
