#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
npm run build:cli
node scripts/spec/verify-modular-release-set.mjs
npm run release:pack
npm run release:gate
