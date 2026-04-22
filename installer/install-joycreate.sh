#!/usr/bin/env bash
# JoyCreate one-click installer for Linux.
#
# Ships inside JoyCreate-Installer-Linux.zip alongside the .deb and/or .rpm
# artifacts produced by `npm run make` (Electron Forge MakerDeb / MakerRpm).
#
# What it does:
#   1. Detects the package manager (apt / dnf / yum / pacman / zypper) and
#      installs the matching JoyCreate package.
#   2. Offers to install optional companions:
#        - Ollama         (via the official install.sh)
#        - LibreOffice    (via the system package manager)
#        - Docker         (link to docs; varies by distro)
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
Usage: ./install-joycreate.sh [--full|--no-companions|--silent] [--skip-model]
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

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
fi

# ---------------------------------------------------------------------------
# Detect package manager
# ---------------------------------------------------------------------------
PM=""
if   command -v apt-get >/dev/null 2>&1; then PM="apt"
elif command -v dnf     >/dev/null 2>&1; then PM="dnf"
elif command -v yum     >/dev/null 2>&1; then PM="yum"
elif command -v zypper  >/dev/null 2>&1; then PM="zypper"
elif command -v pacman  >/dev/null 2>&1; then PM="pacman"
fi

clear
cat <<'BANNER'

  =====================================================
        JoyCreate - One Click Installer (Linux)
  =====================================================

  This will install:
    - JoyCreate desktop app  (required)
    - Ollama                 (optional, local AI models)
    - LibreOffice            (optional, document export)
    - Docker                 (optional, for n8n / Celestia)

BANNER

if [ -z "$PM" ]; then
  fail "Could not detect a supported package manager (apt/dnf/yum/zypper/pacman)."
  echo "   Install the .deb or .rpm in this folder manually."
  exit 1
fi
echo "    Detected package manager: $PM"

# ---------------------------------------------------------------------------
# 1. Install JoyCreate package
# ---------------------------------------------------------------------------
step "Installing JoyCreate..."

DEB_PKG=$(ls "$SCRIPT_DIR"/joycreate*.deb 2>/dev/null | head -n1 || true)
RPM_PKG=$(ls "$SCRIPT_DIR"/joycreate*.rpm 2>/dev/null | head -n1 || true)

case "$PM" in
  apt)
    [ -z "$DEB_PKG" ] && { fail "No joycreate*.deb found next to this script."; exit 1; }
    $SUDO apt-get update -qq || true
    $SUDO apt-get install -y "$DEB_PKG"
    ;;
  dnf)
    [ -z "$RPM_PKG" ] && { fail "No joycreate*.rpm found next to this script."; exit 1; }
    $SUDO dnf install -y "$RPM_PKG"
    ;;
  yum)
    [ -z "$RPM_PKG" ] && { fail "No joycreate*.rpm found next to this script."; exit 1; }
    $SUDO yum install -y "$RPM_PKG"
    ;;
  zypper)
    [ -z "$RPM_PKG" ] && { fail "No joycreate*.rpm found next to this script."; exit 1; }
    $SUDO zypper --non-interactive install --allow-unsigned-rpm "$RPM_PKG"
    ;;
  pacman)
    if [ -n "$DEB_PKG" ] || [ -n "$RPM_PKG" ]; then
      warn "Arch/pacman detected. Convert the .deb/.rpm with 'debtap' or 'rpmextract' or build an AUR package."
    fi
    fail "No native Arch package shipped. Aborting."
    exit 1
    ;;
esac
ok "JoyCreate installed."

# ---------------------------------------------------------------------------
# 2. Optional companions
# ---------------------------------------------------------------------------
pm_install() {
  local pkg="$1" friendly="$2"
  step "Installing $friendly..."
  case "$PM" in
    apt)    $SUDO apt-get install -y "$pkg" ;;
    dnf)    $SUDO dnf install -y "$pkg" ;;
    yum)    $SUDO yum install -y "$pkg" ;;
    zypper) $SUDO zypper --non-interactive install "$pkg" ;;
    pacman) $SUDO pacman -S --noconfirm "$pkg" ;;
  esac
  ok "$friendly install step done."
}

if ask_yn "Install Ollama (local AI models, ~500MB)?" y; then
  step "Installing Ollama (official installer)..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://ollama.com/install.sh | sh || warn "Ollama install script failed."
  else
    warn "curl not installed; cannot fetch Ollama installer."
  fi
  if [ "$SKIP_MODEL" != 1 ] && ask_yn "Pull starter model 'llama3.2:3b' (~2GB)?" y; then
    step "Pulling llama3.2:3b..."
    if command -v ollama >/dev/null 2>&1; then
      ollama pull llama3.2:3b || warn "Model pull failed; run 'ollama pull llama3.2:3b' later."
    else
      warn "ollama not on PATH yet. Open a new shell and run: ollama pull llama3.2:3b"
    fi
  fi
fi

if ask_yn "Install LibreOffice (document export, ~300MB)?" y; then
  pm_install libreoffice "LibreOffice" || warn "LibreOffice install failed."
fi

if ask_yn "Install Docker (for n8n / Celestia)?" n; then
  step "Installing Docker..."
  case "$PM" in
    apt)    pm_install docker.io "Docker" ;;
    dnf|yum)pm_install docker    "Docker" ;;
    zypper) pm_install docker    "Docker" ;;
    pacman) pm_install docker    "Docker" ;;
  esac
  $SUDO systemctl enable --now docker 2>/dev/null || true
  $SUDO usermod -aG docker "$USER" 2>/dev/null || true
  warn "You may need to log out and back in for Docker group membership to apply."
fi

# ---------------------------------------------------------------------------
# 3. Launch
# ---------------------------------------------------------------------------
step "Launching JoyCreate..."
if command -v joycreate >/dev/null 2>&1; then
  (joycreate >/dev/null 2>&1 &) || true
elif command -v JoyCreate >/dev/null 2>&1; then
  (JoyCreate >/dev/null 2>&1 &) || true
else
  warn "joycreate binary not on PATH. Find it in your applications menu."
fi

cat <<'DONE'

  =====================================================
    All done. Look for JoyCreate in your apps menu.
  =====================================================

DONE

if [ "$SILENT" != 1 ]; then
  printf "Press Enter to close this installer..."
  read -r _
fi
