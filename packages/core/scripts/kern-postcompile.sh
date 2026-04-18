#!/bin/bash
# Post-compile cleanup for kern-lang output quirks.

GENERATED="$(dirname "$0")/../src/generated"

# KERN-GAP: `error name=X` nodes in models/errors.kern are correctly emitted
# to models/errors.ts as plain TypeScript error classes, but the Next.js
# transpiler also spuriously emits a models/error.tsx page-level error
# boundary component. The latter is dead code Agon never imports.
rm -f "$GENERATED/models/error.tsx"

echo "  kern-postcompile: cleaned spurious error.tsx"
