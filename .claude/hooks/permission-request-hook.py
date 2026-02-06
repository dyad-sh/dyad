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
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

# Allow disabling this hook via environment variable
if os.environ.get("DYAD_DISABLE_CLAUDE_CODE_HOOKS", "").lower() in ("true", "1", "yes"):
    sys.exit(0)


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
                "--model", "haiku",
                "--no-session-persistence",
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
            # Use a more robust approach that handles braces in string values
            # by finding all potential JSON objects and trying to parse each
            start_indices = [i for i, c in enumerate(response_text) if c == '{']
            for start in start_indices:
                # Find matching closing brace by counting brace depth
                depth = 0
                in_string = False
                escape_next = False
                for i, c in enumerate(response_text[start:], start):
                    if escape_next:
                        escape_next = False
                        continue
                    if c == '\\' and in_string:
                        escape_next = True
                        continue
                    if c == '"' and not escape_next:
                        in_string = not in_string
                        continue
                    if not in_string:
                        if c == '{':
                            depth += 1
                        elif c == '}':
                            depth -= 1
                            if depth == 0:
                                candidate = response_text[start:i + 1]
                                try:
                                    parsed = json.loads(candidate)
                                    if "score" in parsed and parsed["score"] in ("GREEN", "YELLOW", "RED"):
                                        return parsed
                                except json.JSONDecodeError:
                                    pass
                                break

        return None

    except subprocess.SubprocessError:
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
