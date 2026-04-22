#!/usr/bin/env bash
# JoyCreate one-click installer for macOS.
#
# Ships inside JoyCreate-Installer-macOS.zip alongside the .zip artifact
# produced by `npm run make` (Electron Forge MakerZIP for darwin).
#
# What it does:
#   1. Unzips the JoyCreate.app and moves it to /Applications.
#   2. Offers to install optional companions via Homebrew:
#        - Ollama         (local LLMs)
#        - LibreOffice    (document export)
#        - Docker Desktop (n8n / Celestia)
#   3. Pulls a starter Ollama model if asked.
#   4. Launches JoyCreate.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SILENT=0
FULL=0
NO_COMPANIONS=0
SKIP_MODEL=0

for arg in "$@"; do
  case "$arg" in
    --silent)         SILENT=1; NO_COMPANIONS=1 ;;
    --full)           FULL=1 ;;
    --no-companions)  NO_COMPANIONS=1 ;;
    --skip-model)     SKIP_MODEL=1 ;;
    -h|--help)
      cat <<EOF
Usage: ./Install-JoyCreate.command [--full|--no-companions|--silent] [--skip-model]
EOF
      exit 0
      ;;
  esac
done

c_cyan="\033[36m"; c_green="\033[32m"; c_yellow="\033[33m"; c_red="\033[31m"; c_reset="\033[0m"
step() { printf "\n${c_cyan}==> %s${c_reset}\n" "$1"; }
ok()   { printf "    ${c_green}OK${c_reset}  %s\n" "$1"; }
warn() { printf "    ${c_yellow}!!${c_reset}  %s\n" "$1"; }
fail() { printf "    ${c_red}XX${c_reset}  %s\n" "$1"; }

ask_yn() {
  local q="$1" default="${2:-y}"
  [ "$SILENT" = 1 ] || [ "$NO_COMPANIONS" = 1 ] && return 1
  [ "$FULL" = 1 ] && return 0
  local prompt="[Y/n]"; [ "$default" = "n" ] && prompt="[y/N]"
  printf "%s %s " "$q" "$prompt"
  read -r ans
  if [ -z "$ans" ]; then [ "$default" = "y" ]; return $?; fi
  case "$ans" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

clear
cat <<'BANNER'

  =====================================================
        JoyCreate - One Click Installer (macOS)
  =====================================================

  This will install:
    - JoyCreate.app  (required)
    - Ollama         (optional, local AI models)
    - LibreOffice    (optional, document export)
    - Docker Desktop (optional, for n8n / Celestia)

BANNER

# ---------------------------------------------------------------------------
# 1. Install JoyCreate.app
# ---------------------------------------------------------------------------
step "Installing JoyCreate.app..."

APP_ZIP=$(ls "$SCRIPT_DIR"/JoyCreate-*.zip 2>/dev/null | head -n1 || true)
if [ -z "$APP_ZIP" ]; then
  APP_ZIP=$(ls "$SCRIPT_DIR"/*.zip 2>/dev/null | grep -iv installer | head -n1 || true)
fi
if [ -z "$APP_ZIP" ]; then
  fail "Could not find JoyCreate-*.zip next to this script."
  exit 1
fi
echo "    Using: $APP_ZIP"

TMP=$(mktemp -d)
ditto -x -k "$APP_ZIP" "$TMP"
APP_PATH=$(find "$TMP" -maxdepth 3 -name "JoyCreate.app" -print -quit)
if [ -z "$APP_PATH" ]; then
  fail "JoyCreate.app not found inside $APP_ZIP"
  exit 1
fi

DEST="/Applications/JoyCreate.app"
if [ -d "$DEST" ]; then
  warn "Replacing existing $DEST"
  rm -rf "$DEST"
fi

if ! cp -R "$APP_PATH" /Applications/ 2>/dev/null; then
  warn "Need admin rights to write to /Applications. Re-running copy with sudo..."
  sudo cp -R "$APP_PATH" /Applications/
fi

# Strip Gatekeeper quarantine so the app opens without "unidentified developer" warning.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
ok "JoyCreate.app installed at $DEST"
rm -rf "$TMP"

# ---------------------------------------------------------------------------
# 2. Optional companions (via Homebrew)
# ---------------------------------------------------------------------------
brew_install() {
  local kind="$1" pkg="$2" friendly="$3"
  if ! command -v brew >/dev/null 2>&1; then
    warn "Homebrew not installed. Skipping $friendly. Install brew from https://brew.sh and re-run."
    return 1
  fi
  step "Installing $friendly via Homebrew ($kind $pkg)..."
  if [ "$kind" = "cask" ]; then
    brew install --cask "$pkg" || warn "$friendly install returned non-zero (may already be installed)."
  else
    brew install "$pkg" || warn "$friendly install returned non-zero (may already be installed)."
  fi
  ok "$friendly step done."
}

if ask_yn "Install Ollama (local AI models, ~500MB)?" y; then
  brew_install cask ollama "Ollama"
  if [ "$SKIP_MODEL" != 1 ] && ask_yn "Pull starter model 'llama3.2:3b' (~2GB)?" y; then
    step "Pulling llama3.2:3b..."
    if command -v ollama >/dev/null 2>&1; then
      ollama pull llama3.2:3b || warn "Model pull failed; run 'ollama pull llama3.2:3b' later."
    else
      warn "ollama not on PATH yet. Open a new terminal and run: ollama pull llama3.2:3b"
    fi
  fi
fi

if ask_yn "Install LibreOffice (document export, ~300MB)?" y; then
  brew_install cask libreoffice "LibreOffice"
fi

if ask_yn "Install Docker Desktop (for n8n / Celestia)?" n; then
  brew_install cask docker "Docker Desktop"
  warn "Open Docker Desktop once to finish setup before using Celestia features."
fi

# ---------------------------------------------------------------------------
# 3. Launch
# ---------------------------------------------------------------------------
step "Launching JoyCreate..."
open "$DEST" || warn "Could not auto-launch. Open it from /Applications."

cat <<'DONE'

  =====================================================
    All done. Find JoyCreate in /Applications.
  =====================================================

DONE

if [ "$SILENT" != 1 ]; then
  printf "Press Enter to close this installer..."
  read -r _
fi
