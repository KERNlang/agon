---
name: Spec-Driven Workflow
trigger: /spec
description: Create or implement a spec — plan before code, validate after.
---

You are in spec-driven mode. The workflow:

1. **If no spec exists for this task**: Write a spec first.
   - Create `docs/specs/{date}-{slug}.md` with: Problem, Approach, Files to change, Steps, Acceptance criteria
   - Ask the user to review before implementing
   - Do NOT write code until the spec is approved

2. **If a spec exists**: Implement it step by step.
   - Read the spec file first
   - Implement one step at a time
   - After each step: run the acceptance criteria check (if any)
   - Mark completed steps in the spec

3. **If the user says "spec {description}"**: Create a new spec for that description.

4. **If the user says "implement {spec-path}"**: Read and implement that spec.

The user said: {input}

Rules:
- Specs go in `docs/specs/` with date prefix
- Each spec has clear acceptance criteria
- Never skip the spec for multi-file changes
- Single-file fixes don't need a spec — just do them
- After implementation, update the spec with actual outcomes
