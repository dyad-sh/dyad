#!/usr/bin/env python3
"""
Unit tests for gh-permission-hook.py

This test loads commands from good_commands.txt and bad_commands.txt
and verifies that the hook correctly allows/denies them.

Run with: python .claude/hooks/tests/test_gh_permission_hook.py
"""
import json
import subprocess
import sys
from pathlib import Path


def load_commands(filename: str) -> list[str]:
    """Load commands from a file, ignoring comments and empty lines."""
    filepath = Path(__file__).parent / filename
    commands = []
    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            # Skip empty lines and comments
            if line and not line.startswith("#"):
                commands.append(line)
    return commands


def run_hook(command: str) -> dict:
    """
    Run the permission hook with the given command and return the result.

    Returns a dict with:
    - 'decision': 'allow', 'deny', or 'none' (no decision/passthrough)
    - 'reason': the reason string if a decision was made
    """
    hook_path = Path(__file__).parent.parent / "gh-permission-hook.py"

    input_data = json.dumps({
        "tool_name": "Bash",
        "tool_input": {
            "command": command
        }
    })

    result = subprocess.run(
        [sys.executable, str(hook_path)],
        input=input_data,
        capture_output=True,
        text=True
    )

    if result.stdout.strip():
        try:
            output = json.loads(result.stdout.strip())
            hook_output = output.get("hookSpecificOutput", {})
            return {
                "decision": hook_output.get("permissionDecision", "none"),
                "reason": hook_output.get("permissionDecisionReason", "")
            }
        except json.JSONDecodeError:
            return {"decision": "none", "reason": f"Invalid JSON output: {result.stdout}"}

    return {"decision": "none", "reason": "No output (passthrough)"}


def test_good_commands() -> tuple[int, int, list[str]]:
    """Test that good commands are allowed or passed through."""
    commands = load_commands("good_commands.txt")
    passed = 0
    failed = 0
    failures = []

    for cmd in commands:
        result = run_hook(cmd)
        # Good commands should be 'allow' or 'none' (passthrough for manual approval)
        # They should NOT be 'deny'
        if result["decision"] == "deny":
            failed += 1
            failures.append(f"  FAIL (blocked): {cmd}\n    Reason: {result['reason']}")
        else:
            passed += 1

    return passed, failed, failures


def test_bad_commands() -> tuple[int, int, list[str]]:
    """Test that bad commands are denied or require user confirmation."""
    commands = load_commands("bad_commands.txt")
    passed = 0
    failed = 0
    failures = []

    for cmd in commands:
        result = run_hook(cmd)
        # Bad commands should be 'deny' or 'ask' (require user confirmation)
        # 'allow' is definitely wrong, 'none' means it wasn't caught
        if result["decision"] not in ("deny", "ask"):
            failed += 1
            failures.append(f"  FAIL (not blocked): {cmd}\n    Decision: {result['decision']}, Reason: {result['reason']}")
        else:
            passed += 1

    return passed, failed, failures


def main():
    print("=" * 60)
    print("Testing gh-permission-hook.py")
    print("=" * 60)
    print()

    # Test good commands
    print("Testing GOOD commands (should be allowed)...")
    good_passed, good_failed, good_failures = test_good_commands()
    print(f"  Passed: {good_passed}, Failed: {good_failed}")
    if good_failures:
        print("\n  Failures:")
        for failure in good_failures:
            print(failure)
    print()

    # Test bad commands
    print("Testing BAD commands (should be blocked)...")
    bad_passed, bad_failed, bad_failures = test_bad_commands()
    print(f"  Passed: {bad_passed}, Failed: {bad_failed}")
    if bad_failures:
        print("\n  Failures:")
        for failure in bad_failures:
            print(failure)
    print()

    # Summary
    print("=" * 60)
    total_passed = good_passed + bad_passed
    total_failed = good_failed + bad_failed
    print(f"TOTAL: {total_passed} passed, {total_failed} failed")
    print("=" * 60)

    if total_failed > 0:
        sys.exit(1)
    else:
        print("\nAll tests passed!")
        sys.exit(0)


if __name__ == "__main__":
    main()
