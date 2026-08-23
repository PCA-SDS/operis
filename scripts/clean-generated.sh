#!/bin/bash
# Clean all generated files and directories
# - .mercato folder in Next.js apps
# - generated/ folders in packages
# - .turbo cache folders
# - .next build folders
# - migrations folders in dist directories

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "Cleaning generated files..."

# Clean .mercato folders (Next.js app generated files)
find . -type d -name '.mercato' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

# Clean generated/ folders in packages and root
find . -type d -name 'generated' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

# Clean .turbo cache folders
find . -type d -name '.turbo' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

# Clean .next build folders
find . -type d -name '.next' -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true

# NOTE: this script deliberately does NOT remove `dist/`.
#
# It previously carried `find . -type d -path 'dist' ...`, which was a silent no-op:
# `-path` matches the whole path, and every path `find` produces here is rooted at
# `./`, so the literal pattern `dist` could never match. The script nevertheless
# claimed to have cleaned `dist/`. Build output under `dist/` is removed by
# `scripts/clean-packages.sh` (which `yarn clean` runs straight after this), so the
# dead line was redundant as well as misleading — removed rather than "fixed" into
# newly destructive behavior.

echo "Done! Cleaned: .mercato, generated/, .turbo, .next"
