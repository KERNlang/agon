#!/bin/bash
# End-to-end install proof: pack every publishable workspace package,
# install ONLY @agon/cli in a fresh consumer project, and assert that
# transitive dependencies (incl. @agon/dedup with the Python sidecars)
# land via npm's normal resolution. If @agon/core stops depending on
# @agon/dedup, this test should fail.
set -euo pipefail

# Derive repo root from this script's location so the script is portable
# regardless of where it's cloned.
REPO="$( cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd )"
WORK=$(mktemp -d -t agon-install-test-XXXXXX)
echo "=== Repo: $REPO"
echo "=== Working in $WORK"
cd "$REPO"

# Pack every publishable workspace package into the work dir so npm can
# resolve transitive deps locally without a registry.
for pkg in dedup core adapter-cli forge mcp cli; do
  echo "Packing @agon/$pkg..."
  npm pack --workspace "packages/$pkg" --pack-destination "$WORK" 2>&1 | tail -1
done

cd "$WORK"
echo ""
echo "=== Tarballs ==="
ls -1 *.tgz

# Consumer depends ONLY on @agon/cli. npm overrides force the transitive
# resolution to use the local tarballs (no registry needed). If
# @agon/core stops pulling @agon/dedup, the assertion below will fail.
cat > package.json <<EOF
{
  "name": "agon-install-test-consumer",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "@agon/cli": "file:$WORK/agon-cli-0.1.0.tgz"
  },
  "overrides": {
    "@agon/dedup": "file:$WORK/agon-dedup-0.1.0.tgz",
    "@agon/core": "file:$WORK/agon-core-0.1.0.tgz",
    "@agon/adapter-cli": "file:$WORK/agon-adapter-cli-0.1.0.tgz",
    "@agon/forge": "file:$WORK/agon-forge-0.1.0.tgz",
    "@agon/mcp": "file:$WORK/agon-mcp-0.1.0.tgz"
  }
}
EOF

echo ""
echo "=== npm install (single root dep; transitive via overrides) ==="
npm install --no-audit --no-fund 2>&1 | tail -5

echo ""
echo "=== Confirm @agon/dedup landed transitively (NOT via direct dep) ==="
ls node_modules/@agon/dedup/*.py 2>&1
[ -f node_modules/@agon/dedup/history-search.py ] || { echo "FAIL: dedup sidecars missing"; exit 1; }

echo ""
echo "=== agon doctor ==="
./node_modules/.bin/agon doctor 2>&1 | tail -10

echo ""
echo "=== agon history --query (production resolver path) ==="
./node_modules/.bin/agon history --query "anything" 2>&1 | tail -6 || true

echo ""
echo "OK — Python sidecars survive npm install via the @agon/core -> @agon/dedup transitive dep."
echo "Work dir: $WORK"
