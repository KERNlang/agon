#!/bin/bash
# Post-compile fixup for KERN compiler bugs.
# KERN generator=true emits "async function" instead of "async function*".
# This patches the generated output until the compiler is fixed.

GENERATED="$(dirname "$0")/../src/generated"

# Fix: spawnStream needs to be an async generator function
perl -i -pe 's/export async function spawnStream/export async function* spawnStream/' "$GENERATED/blocks/process.ts"

# Fix: api-dispatch generator functions
perl -i -pe 's/export async function apiStreamDispatch/export async function* apiStreamDispatch/' "$GENERATED/api/dispatch.ts"
perl -i -pe 's/export async function apiStreamDispatchWithHistory/export async function* apiStreamDispatchWithHistory/' "$GENERATED/api/dispatch.ts"

# Fix: KERN compiler emits { type: 'variant' } stubs for union types instead of resolving members
perl -i -pe "s/export type MessagePart =.*$/export type MessagePart =/" "$GENERATED/models/context-parts.ts"
perl -i -pe "s/^\s*\| \{ type: 'variant' \}//g" "$GENERATED/models/context-parts.ts"
# Write correct union — matches kern source context-parts.kern:44
perl -i -pe 's/^export type MessagePart =$/export type MessagePart = TextPart | ToolCallPart | ToolResultPart | ReasoningPart | CompactionSummaryPart;/' "$GENERATED/models/context-parts.ts"

echo "  kern-postcompile: patched generator functions + MessagePart union"
