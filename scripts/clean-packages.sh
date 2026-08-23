#!/bin/bash
# Clean all node_modules, dist, and build artifacts from the entire monorepo

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "Cleaning node_modules, dist, and build artifacts..."

# Remove all node_modules directories
find . -type d -name 'node_modules' -prune -exec rm -rf {} + 2>/dev/null || true

# Remove all dist directories (build outputs).
#
# `__fixtures__` is excluded deliberately: test fixtures that simulate an installed
# package ship a source-controlled `dist/` (e.g.
# packages/cli/src/lib/__fixtures__/official-module-package/dist/modules/test_package/index.js).
# That is committed input, not build output — deleting it makes the CLI suite fail
# with `Package "@open-mercato/test-package" is missing dist/modules/test_package.`
# and the only recovery is `git checkout`. Keep this prune in sync with any new
# fixture that vendors a dist tree.
find . -type d -name 'dist' \
  -not -path '*/node_modules/*' \
  -not -path '*/__fixtures__/*' \
  -exec rm -rf {} + 2>/dev/null || true

# Remove TypeScript incremental build info files
find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -exec rm -f {} + 2>/dev/null || true

# Also clean yarn/npm lock caches if needed
rm -rf .yarn/cache 2>/dev/null || true
rm -f .yarn/install-state.gz 2>/dev/null || true

echo "Done! All node_modules, dist, and .tsbuildinfo files removed."
echo "Run 'yarn install' to reinstall dependencies."
