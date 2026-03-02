#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/veracitylife/OpenClaw-Better-Visual-Gateway-Unforked}"
OPENCLAW_USER="${OPENCLAW_USER:-brewuser}"
WORKDIR="${WORKDIR:-/home/${OPENCLAW_USER}/openclaw-better-gateway}"

echo "[Install] Creating workdir: ${WORKDIR}"
mkdir -p "${WORKDIR}"
cd "${WORKDIR}"

if [ -d .git ]; then
  echo "[Install] Updating existing clone"
  git pull --rebase || true
else
  echo "[Install] Cloning repository"
  git clone "${REPO_URL}" .
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[Install] Installing pnpm globally"
  if command -v npm >/dev/null 2>&1; then
    sudo npm install -g pnpm || npm install -g pnpm
  fi
fi

# Show funding info (informational, not an error)
if command -v npm >/dev/null 2>&1; then
  echo "[Install] Package funding info (optional):"
  npm fund --no-update-notifier || true
fi

echo "[Install] Installing dependencies"
pnpm install

echo "[Install] Building plugin"
npm run build

if command -v openclaw >/dev/null 2>&1; then
  echo "[Install] Installing plugin into OpenClaw"
  openclaw plugins install -l .
  echo "[Install] Restarting OpenClaw gateway"
  sudo systemctl daemon-reload || true
  sudo systemctl restart openclaw-gateway || true
fi

# Link hints
BASE_PATH="${BASE_PATH:-/better-gateway}"
PORT="$(openclaw config get gateway.port 2>/dev/null || echo 18789)"
LOCAL_HOST="127.0.0.1"
TAIL_IP="$(command -v tailscale >/dev/null 2>&1 && tailscale ip -4 | head -n1 || echo "")"

echo "[Install] Done."
echo "[Install] Local:    http://${LOCAL_HOST}:${PORT}${BASE_PATH}/"
if [ -n "${TAIL_IP}" ]; then
  echo "[Install] Tailnet:  http://${TAIL_IP}:${PORT}${BASE_PATH}/"
fi
