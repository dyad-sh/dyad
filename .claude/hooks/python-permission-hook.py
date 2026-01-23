#!/usr/bin/env python3
"""
Python Permission Hook

This hook enforces that python/python3 commands can only execute scripts
located inside the .claude directory.

ALLOWED:
- python .claude/script.py
- python3 .claude/hooks/test.py
- python "$CLAUDE_PROJECT_DIR/.claude/script.py"

BLOCKED:
- python script.py (outside .claude)
- python /usr/local/bin/script.py
- python ../malicious.py
"""
import json
import os
import re
import sys


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # Invalid input, allow normal permission flow
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input")

    # Validate types to prevent crashes on malformed input
    if not isinstance(tool_input, dict):
        sys.exit(0)

    command = tool_input.get("command")
    if not isinstance(command, str):
        sys.exit(0)

    # Only process Bash commands
    if tool_name != "Bash":
        sys.exit(0)

    # Check if this is a python/python3 command
    python_script = extract_python_script(command)
    if python_script is None:
        # Not a python command, let it through
        sys.exit(0)

    # Check if the script is inside .claude directory
    if is_inside_claude_dir(python_script):
        decision = make_allow_decision(
            f"Python script is inside .claude directory: {python_script}"
        )
        print(json.dumps(decision))
        sys.exit(0)
    else:
        decision = make_deny_decision(
            f"Python scripts can only be run from inside the .claude directory. "
            f"Attempted to run: {python_script}"
        )
        print(json.dumps(decision))
        sys.exit(0)


def extract_python_script(command: str) -> str | None:
    """
    Extract the Python script path from a command.
    Returns None if not a python command, or the script path if it is.
    """
    # Strip leading whitespace and handle common prefixes like env vars
    cmd = command.strip()

    # Remove common environment variable prefixes
    # e.g., "FOO=bar python script.py" -> "python script.py"
    while True:
        match = re.match(r'^[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+', cmd)
        if match:
            cmd = cmd[match.end():]
        else:
            break

    # Check if command starts with python or python3
    python_match = re.match(r'^(python3?|/usr/bin/python3?|/usr/local/bin/python3?)\s+', cmd)
    if not python_match:
        return None

    # Get the rest after "python" or "python3"
    rest = cmd[python_match.end():].strip()

    # Skip any flags (e.g., -u, -m, --version)
    # If -m is used, this is a module invocation, not a script
    if rest.startswith('-m ') or rest.startswith('-m\t'):
        # Module invocation - allow it for now (could be restricted later)
        return None

    # Skip other flags
    while rest.startswith('-'):
        # Find the end of this flag and its argument
        flag_match = re.match(r'^-[a-zA-Z]+\s*', rest)
        if flag_match:
            rest = rest[flag_match.end():].strip()
        else:
            break

    if not rest:
        # Just "python" with no script - allow interactive mode
        return None

    # Extract the script path (first argument)
    # Handle quoted paths
    if rest.startswith('"'):
        # Double-quoted path
        match = re.match(r'^"([^"]*)"', rest)
        if match:
            return match.group(1)
        return None
    elif rest.startswith("'"):
        # Single-quoted path
        match = re.match(r"^'([^']*)'", rest)
        if match:
            return match.group(1)
        return None
    else:
        # Unquoted path - ends at whitespace or shell metacharacter
        match = re.match(r'^([^\s;<>&|]+)', rest)
        if match:
            return match.group(1)
        return None


def is_inside_claude_dir(script_path: str) -> bool:
    """
    Check if the script path is inside the .claude directory.
    Handles both absolute and relative paths.
    """
    # Expand environment variables
    expanded_path = os.path.expandvars(script_path)

    # Get the project directory from environment or use current working directory
    project_dir = os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd())
    claude_dir = os.path.join(project_dir, '.claude')

    # Normalize the script path
    if os.path.isabs(expanded_path):
        abs_script_path = os.path.normpath(expanded_path)
    else:
        abs_script_path = os.path.normpath(os.path.join(project_dir, expanded_path))

    # Resolve any symlinks to get the real path
    try:
        real_script_path = os.path.realpath(abs_script_path)
        real_claude_dir = os.path.realpath(claude_dir)
    except OSError:
        # If we can't resolve paths, be conservative and deny
        return False

    # Check if the script is inside the .claude directory
    # Use os.path.commonpath to handle edge cases
    try:
        common = os.path.commonpath([real_script_path, real_claude_dir])
        return common == real_claude_dir
    except ValueError:
        # Different drives on Windows, etc.
        return False


def make_allow_decision(reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": reason
        }
    }


def make_deny_decision(reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason
        }
    }


if __name__ == "__main__":
    main()
