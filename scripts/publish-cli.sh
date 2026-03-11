#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DRY_RUN=false
SKIP_INSTALL=false

for arg in "$@"; do
  case "${arg}" in
    --dry-run)
      DRY_RUN=true
      ;;
    --skip-install)
      SKIP_INSTALL=true
      ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      echo "Usage: ./scripts/publish-cli.sh [--dry-run] [--skip-install]" >&2
      exit 1
      ;;
  esac
done

PACKAGES=(
  "packages/shared"
  "packages/mcp-sec-server"
  "packages/mcp-financials-server"
  "packages/bootup"
  "packages/agent"
)

if [[ "${SKIP_INSTALL}" == "true" ]]; then
  echo "[1/4] Skipping install (--skip-install)."
else
  echo "[1/4] Installing dependencies..."
  corepack enable >/dev/null 2>&1 || true
  CI=1 pnpm install --frozen-lockfile --link-workspace-packages true
fi

echo "[2/4] Building workspace..."
pnpm --filter @shawyan/shared \
  --filter @shawyan/mcp-sec-server \
  --filter @shawyan/mcp-financials-server \
  --filter @shawyan/bootup \
  --filter @shawyan/agent \
  build

echo "[3/4] Verifying publish payloads..."
for pkg in "${PACKAGES[@]}"; do
  echo "  - ${pkg}"
  (
    cd "${pkg}"
    NPM_CONFIG_CACHE=/tmp/dolph_npm_cache npm pack --dry-run >/dev/null
  )
done

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "[4/4] Dry run complete. No packages were published."
  echo "Install command users should run: npm i -g @shawyan/agent"
  exit 0
fi

echo "[4/4] Publishing packages to npm..."
for pkg in "${PACKAGES[@]}"; do
  echo "  - Publishing ${pkg}"
  (
    cd "${pkg}"
    npm publish --access public
  )
done

echo "Publish complete."
echo "Install command users should run: npm i -g @shawyan/agent"
