#!/usr/bin/env bash
# Safe global install of @metrocli/metro.
#
# Do NOT use `npm install -g git+https://github.com/metrocli/metro.git`.
# On current npm, that leaves a symlink into ~/.npm/_cacache/tmp/git-clone…
# (often an empty/incomplete checkout). Result: "added 1 package" then
# `metro: command not found`, and later ENOTDIR on retry.
#
# This script uses a persistent checkout at ~/.metro/src (or METRO_INSTALL_DIR),
# updates it when already present, and `npm link`s so bin/metro.js exists.
# It does not rm -rf the checkout on every run.
#
# Usage (only command you need):
#   bash ~/.metro/src/scripts/install-global.sh
#
# First time (no checkout yet), run from any directory, not inside ~/.metro/src:
#   git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src 2>/dev/null || true
#   bash ~/.metro/src/scripts/install-global.sh
#
set -euo pipefail

REPO_URL="${METRO_REPO_URL:-https://github.com/metrocli/metro.git}"
INSTALL_DIR="${METRO_INSTALL_DIR:-$HOME/.metro/src}"

# Never run git from inside INSTALL_DIR, a repair must not delete our cwd.
if [[ -n "${PWD:-}" ]] && [[ "${PWD}" == "${INSTALL_DIR}"* ]]; then
  echo "NOTE: leaving ${PWD} before install (do not run this script from inside ~/.metro/src)." >&2
  cd "${HOME}"
else
  cd "${HOME}"
fi

is_valid_checkout() {
  [[ -f "${INSTALL_DIR}/bin/metro.js" && -d "${INSTALL_DIR}/.git" ]]
}

has_git_checkout() {
  [[ -d "${INSTALL_DIR}/.git" ]]
}

echo "1/4  Clearing any broken global @metrocli/metro / metro symlink..."
npm rm -g @metrocli/metro 2>/dev/null || true
rm -f "$(npm root -g)/@metrocli/metro"
rm -f "$(npm prefix -g)/bin/metro"

echo "2/4  Ensuring source checkout at ${INSTALL_DIR}..."
if is_valid_checkout; then
  echo "       Existing checkout found, pulling latest..."
  git -C "${INSTALL_DIR}" pull --ff-only
elif has_git_checkout; then
  echo "       Incomplete checkout, pulling and repairing..."
  git -C "${INSTALL_DIR}" pull --ff-only
elif [[ -d "${INSTALL_DIR}" ]]; then
  echo "ERROR: ${INSTALL_DIR} exists but is not a git checkout." >&2
  echo "       Open a new terminal (cd ~), then remove it manually if you want a fresh clone:" >&2
  echo "         rm -rf \"${INSTALL_DIR}\"" >&2
  echo "         bash -c 'git clone --depth 1 \"${REPO_URL}\" \"${INSTALL_DIR}\" && bash \"${INSTALL_DIR}/scripts/install-global.sh\"'" >&2
  exit 1
else
  echo "       No checkout yet, cloning..."
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
fi

if ! is_valid_checkout; then
  echo "ERROR: ${INSTALL_DIR} is still missing bin/metro.js after checkout." >&2
  echo "       From a new terminal (cd ~): rm -rf \"${INSTALL_DIR}\" && git clone --depth 1 \"${REPO_URL}\" \"${INSTALL_DIR}\"" >&2
  exit 1
fi

echo "3/4  npm install + npm link..."
cd "${INSTALL_DIR}"
npm install --no-fund --no-audit
npm link

echo "4/4  Proving metro is on PATH..."
if ! command -v metro >/dev/null 2>&1; then
  global_bin="$(npm prefix -g)/bin"
  echo "ERROR: metro is still not on PATH after install." >&2
  echo "Try: export PATH=\"${global_bin}:\$PATH\"" >&2
  echo "Check: ls -la \"\$(npm root -g)/@metrocli/metro\"" >&2
  exit 1
fi

# Fail closed if npm linked into the broken temp-cache pattern again.
metro_pkg="$(npm root -g)/@metrocli/metro"
if [[ -L "${metro_pkg}" ]]; then
  target="$(readlink "${metro_pkg}")"
  case "${target}" in
    *_cacache/tmp/git-clone*)
      echo "ERROR: global package still points at npm temp cache: ${target}" >&2
      echo "That install path is broken; refuse to continue." >&2
      exit 1
      ;;
  esac
fi
if [[ ! -f "${metro_pkg}/bin/metro.js" ]]; then
  echo "ERROR: ${metro_pkg}/bin/metro.js is missing." >&2
  exit 1
fi

metro --help >/dev/null

cat <<EOF
OK: metro is installed from ${INSTALL_DIR}.

Next (local-only, no API key):
  metro doctor
  metro setup quickstart --shell | zsh
EOF
