#!/bin/bash
# Post-compile cleanup for kern-lang output quirks.

GENERATED="$(dirname "$0")/../src/generated"

# KERN-GAP: `error name=X` nodes in models/errors.kern are correctly emitted
# to models/errors.ts as plain TypeScript error classes, but the Next.js
# transpiler also spuriously emits a models/error.tsx page-level error
# boundary component. The latter is dead code Agon never imports.
rm -f "$GENERATED/models/error.tsx"

# KERN-GAP (3.5.0): when an `error` declaration's handler contains a `let`
# statement BEFORE a `do value="super(...)"` call, codegen inserts a
# redundant empty `super();` above the user's super call. The empty call
# fails strict TS (TS2554: Expected 1 argument, got 0). Strip the empty
# super() when it's immediately followed by const/let lines then a real
# super(...). Drop this hack once kern-lang ships a fix.
ERRORS_TS="$GENERATED/models/errors.ts"
if [ -f "$ERRORS_TS" ]; then
  python3 - "$ERRORS_TS" <<'PY'
import re, sys
path = sys.argv[1]
with open(path) as f:
    src = f.read()
fixed = re.sub(
    r'^(\s*)super\(\);\n((?:\s*(?:const|let|var)[^\n]*\n)*)(\s*super\([^)\n]+\))',
    r'\2\3',
    src,
    flags=re.MULTILINE,
)
if fixed != src:
    with open(path, 'w') as f:
        f.write(fixed)
    print("  kern-postcompile: stripped redundant empty super() in errors.ts")
PY
fi

echo "  kern-postcompile: cleaned spurious error.tsx"
