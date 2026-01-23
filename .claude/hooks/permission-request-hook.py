#!/usr/bin/env python3
"""
AI-Powered Permission Request Hook

This is a PermissionRequest hook that runs when the user would see a permission dialog.
It uses Claude to analyze the request and determine whether to auto-approve or auto-deny.

Safety levels:
- GREEN: Safe operation, auto-approve (user won't see dialog)
- YELLOW: Uncertain, pass to normal flow (user sees dialog and decides)
- RED: Dangerous operation, auto-deny (user won't see dialog, request blocked)

The hook is designed to catch requests that slip through explicit rule-based hooks.
It provides an additional layer of security through semantic understanding.

Usage:
    Receives JSON on stdin with tool_name and tool_input
    Outputs hookSpecificOutput JSON for allow/deny, or nothing for passthrough
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional


def load_policy_guidelines() -> str:
    """Load policy guidelines from the markdown file."""
    policy_path = Path(__file__).parent / "permission-policy.md"
    try:
        return policy_path.read_text()
    except FileNotFoundError:
        return ""


def analyze_with_claude(tool_name: str, tool_input: dict) -> Optional[dict]:
    """
    Use Claude Code CLI to analyze the tool request and determine safety level.
    Returns None if analysis fails or is unavailable.
    """
    claude_path = shutil.which("claude")
    if not claude_path:
        home = Path.home()
        default_path = home / ".claude" / "local" / "claude"
        if default_path.exists():
            claude_path = str(default_path)
        else:
            return None

    if tool_name == "Bash":
        command = tool_input.get("command", "")
        request_description = f"Bash command: {command}"
    elif tool_name in ("Edit", "Write"):
        file_path = tool_input.get("file_path", "")
        request_description = f"{tool_name} to file: {file_path}"
    else:
        request_description = f"{tool_name}: {json.dumps(tool_input)}"

    cwd = os.getcwd()
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", cwd)

    policy = load_policy_guidelines()
    if not policy:
        return None

    prompt = f"""{policy}

## Current Request

Working directory: {cwd}
Project directory: {project_dir}

Request to analyze:
{request_description}

Analyze this request and provide your safety assessment. Respond with ONLY a JSON object, no other text."""

    try:
        result = subprocess.run(
            [
                claude_path,
                "--print",
                "--output-format", "text",
                "--model", "sonnet",
                prompt
            ],
            capture_output=True,
            text=True,
            timeout=25,
            cwd=project_dir,
        )

        if result.returncode != 0:
            return None

        response_text = result.stdout.strip()

        try:
            parsed = json.loads(response_text)
            if "score" in parsed and parsed["score"] in ("GREEN", "YELLOW", "RED"):
                return parsed
        except json.JSONDecodeError:
            # Extract JSON from markdown code fences if present
            json_match = re.search(
                r'\{[^{}]*"score"\s*:\s*"(?:GREEN|YELLOW|RED)"[^{}]*\}',
                response_text,
                re.DOTALL
            )
            if json_match:
                try:
                    parsed = json.loads(json_match.group())
                    if "score" in parsed and parsed["score"] in ("GREEN", "YELLOW", "RED"):
                        return parsed
                except json.JSONDecodeError:
                    pass

        return None

    except (subprocess.TimeoutExpired, Exception):
        return None


def make_allow_decision() -> dict:
    """Auto-approve the permission request."""
    return {
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {"behavior": "allow"}
        }
    }


def make_deny_decision(reason: str) -> dict:
    """Auto-deny the permission request."""
    return {
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {
                "behavior": "deny",
                "message": f"[AI-RED] {reason}"
            }
        }
    }


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input")

    if not isinstance(tool_input, dict):
        sys.exit(0)

    result = analyze_with_claude(tool_name, tool_input)

    if result is None:
        sys.exit(0)

    score = result.get("score")
    reason = result.get("reason", "No reason provided")

    if score == "GREEN":
        print(json.dumps(make_allow_decision()))
    elif score == "RED":
        print(json.dumps(make_deny_decision(reason)))
    # YELLOW: no output, fall through to normal permission flow

    sys.exit(0)


if __name__ == "__main__":
    main()
