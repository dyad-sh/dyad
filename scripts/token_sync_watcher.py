"""
token_sync_watcher.py — JoyCreate API Token Sync Watcher

Watches ~/.openclaw/joycreate-api-token for changes and pushes the new
token to the ClawElite bridge so the remote server always has the
current bearer token.

Three layers of protection:
  1. Instant push via /bridge/update-token on file change
  2. Server-side file poll every 30s (fallback)
  3. Startup load when the bridge process restarts

Usage:
  python token_sync_watcher.py [--interval 5] [--bridge-url URL] [--api-key KEY]

Environment variables (override CLI args):
  BRIDGE_URL            — Bridge endpoint
  BRIDGE_API_KEY        — API key for bridge authentication
  TOKEN_POLL_INTERVAL   — Poll interval in seconds
  JOYCREATE_MACHINE_ID  — Machine identifier (default: hostname)
"""

import argparse
import hashlib
import os
import platform
import sys
import time
from pathlib import Path
from urllib import request, error as urllib_error
import json
import logging

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BRIDGE_URL = "https://api.clawelite.io/bridge/update-token"
TOKEN_PATH = Path.home() / ".openclaw" / "joycreate-api-token"
POLL_INTERVAL = 5  # seconds between file checks
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds between retries
MACHINE_ID = os.environ.get("JOYCREATE_MACHINE_ID", platform.node())

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [TokenSync] %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("token_sync")


def read_token() -> str | None:
    """Read the current token from disk, return None if missing."""
    try:
        return TOKEN_PATH.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None
    except OSError as exc:
        log.warning("Could not read token file: %s", exc)
        return None


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def push_token(token: str, bridge_url: str, api_key: str | None = None) -> bool:
    """POST the token to the bridge. Returns True on success."""
    payload = json.dumps({
        "token": token,
        "machineId": MACHINE_ID,
        "source": "joycreate-nuc",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }).encode("utf-8")

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = request.Request(
                bridge_url,
                data=payload,
                headers=headers,
                method="POST",
            )
            with request.urlopen(req, timeout=10) as resp:
                if resp.status in (200, 201, 204):
                    log.info(
                        "Token pushed to bridge (attempt %d) — %s…",
                        attempt,
                        token[:8],
                    )
                    return True
                log.warning("Bridge returned HTTP %d on attempt %d", resp.status, attempt)
        except urllib_error.HTTPError as exc:
            log.warning("HTTP %d from bridge (attempt %d): %s", exc.code, attempt, exc.reason)
        except urllib_error.URLError as exc:
            log.warning("Network error (attempt %d): %s", attempt, exc.reason)
        except OSError as exc:
            log.warning("OS error (attempt %d): %s", attempt, exc)

        if attempt < MAX_RETRIES:
            time.sleep(RETRY_DELAY)

    log.error("Failed to push token after %d attempts", MAX_RETRIES)
    return False


def watch(bridge_url: str, interval: float, api_key: str | None = None) -> None:
    """Poll the token file and push changes to the bridge."""
    last_hash: str | None = None

    log.info("Watching %s (poll every %ss)", TOKEN_PATH, interval)
    log.info("Bridge endpoint: %s", bridge_url)
    log.info("Machine ID: %s", MACHINE_ID)

    # --- initial push on startup ---
    token = read_token()
    if token:
        last_hash = sha256(token)
        log.info("Initial token found (%s…), pushing now", token[:8])
        push_token(token, bridge_url, api_key)
    else:
        log.info("No token file yet — waiting for JoyCreate to start")

    # --- poll loop ---
    while True:
        time.sleep(interval)

        token = read_token()
        if token is None:
            continue

        current_hash = sha256(token)
        if current_hash != last_hash:
            log.info("Token change detected (%s…)", token[:8])
            if push_token(token, bridge_url, api_key):
                last_hash = current_hash
        # else: no change, keep waiting


def main() -> None:
    parser = argparse.ArgumentParser(description="JoyCreate API token sync watcher")
    parser.add_argument(
        "--bridge-url",
        default=os.environ.get("BRIDGE_URL", BRIDGE_URL),
        help=f"Bridge update-token endpoint (default: {BRIDGE_URL})",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=float(os.environ.get("TOKEN_POLL_INTERVAL", POLL_INTERVAL)),
        help=f"Poll interval in seconds (default: {POLL_INTERVAL})",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("BRIDGE_API_KEY", ""),
        help="API key for bridge authentication (or set BRIDGE_API_KEY env var)",
    )
    args = parser.parse_args()

    log.info("=== JoyCreate Token Sync Watcher ===")
    try:
        watch(bridge_url=args.bridge_url, interval=args.interval, api_key=args.api_key or None)
    except KeyboardInterrupt:
        log.info("Stopped by user")
        sys.exit(0)


if __name__ == "__main__":
    main()
