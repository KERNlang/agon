#!/bin/bash
# Post-compile fixup for KERN compiler bugs.
# KERN generator=true emits "async function" instead of "async function*".
# This patches the generated output until the compiler is fixed.

GENERATED="$(dirname "$0")/../src/generated"

# Fix: spawnStream needs to be an async generator function
sed -i '' 's/export async function spawnStream/export async function* spawnStream/' "$GENERATED/blocks/process.ts"

# Fix: api-dispatch generator functions
sed -i '' 's/export async function apiStreamDispatch/export async function* apiStreamDispatch/' "$GENERATED/api/dispatch.ts"
sed -i '' 's/export async function apiStreamDispatchWithHistory/export async function* apiStreamDispatchWithHistory/' "$GENERATED/api/dispatch.ts"

echo "  kern-postcompile: patched generator functions"
