#!/bin/bash
set -e
REPO=/Users/nicolascukas/KERN/Agon-AI
WORK=$(mktemp -d -t agon-install-test-XXXXXX)
echo "=== Working in $WORK ==="
cd "$REPO"

# Pack every publishable workspace package into the work dir.
for pkg in dedup core adapter-cli forge mcp cli; do
  echo "Packing @agon/$pkg..."
  npm pack --workspace packages/$pkg --pack-destination "$WORK" 2>&1 | tail -2
done

cd "$WORK"
echo ""
echo "=== Tarballs ==="
ls -la *.tgz

# Initialize a fresh consumer project.
cat > package.json <<EOF
{
  "name": "agon-install-test-consumer",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "@agon/dedup": "file:$WORK/agon-dedup-0.1.0.tgz",
    "@agon/core": "file:$WORK/agon-core-0.1.0.tgz",
    "@agon/adapter-cli": "file:$WORK/agon-adapter-cli-0.1.0.tgz",
    "@agon/forge": "file:$WORK/agon-forge-0.1.0.tgz",
    "@agon/mcp": "file:$WORK/agon-mcp-0.1.0.tgz",
    "@agon/cli": "file:$WORK/agon-cli-0.1.0.tgz"
  }
}
EOF

echo ""
echo "=== npm install from tarballs ==="
npm install 2>&1 | tail -8

echo ""
echo "=== Confirm dedup .py files landed ==="
ls node_modules/@agon/dedup/*.py 2>&1 | head -10

echo ""
echo "=== Run agon doctor (subset) ==="
./node_modules/.bin/agon doctor 2>&1 | tail -10

echo ""
echo "=== Run agon history --query (sidecar via production resolver) ==="
./node_modules/.bin/agon history --query "anything" 2>&1 | tail -8 || true

echo ""
echo "Work dir: $WORK (left in place for inspection)"
