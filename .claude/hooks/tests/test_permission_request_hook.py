#!/usr/bin/env python3
"""
Tests for the AI-powered PermissionRequest hook.

This is a PermissionRequest hook (not PreToolUse) that runs when the user
would see a permission dialog. It can auto-approve or auto-deny.

Response format: { "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" | "deny" } } }
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

# Get the hook path
HOOK_PATH = Path(__file__).parent.parent / "permission-request-hook.py"


def run_hook(tool_name: str, tool_input: dict) -> tuple[int, str]:
    """Run the hook with the given input and return (returncode, stdout)."""
    input_data = json.dumps({"tool_name": tool_name, "tool_input": tool_input})

    result = subprocess.run(
        [sys.executable, str(HOOK_PATH)],
        input=input_data,
        capture_output=True,
        text=True,
    )

    return result.returncode, result.stdout


def parse_response(stdout: str) -> dict | None:
    """Parse the hook response, return None if empty/invalid."""
    if not stdout.strip():
        return None
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return None


class TestHookBasics:
    """Test basic hook behavior without AI."""

    def test_invalid_json_passthrough(self):
        """Invalid JSON should pass through (exit 0, no output)."""
        result = subprocess.run(
            [sys.executable, str(HOOK_PATH)],
            input="not valid json",
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert result.stdout == ""

    def test_non_dict_tool_input_passthrough(self):
        """Non-dict tool_input should pass through."""
        returncode, stdout = run_hook("Bash", "not a dict")  # type: ignore
        assert returncode == 0
        assert stdout == ""

    def test_all_tools_analyzed(self):
        """All tools should be analyzed (matcher is *)."""
        # Without claude CLI available, all tools pass through
        # but the hook should attempt to analyze them
        returncode, _stdout = run_hook("Read", {"file_path": "/etc/passwd"})
        assert returncode == 0
        # Passes through because claude CLI analysis returns None

    def test_bash_commands_analyzed(self):
        """Bash commands should be analyzed including gh and python."""
        returncode, _stdout = run_hook("Bash", {"command": "gh pr view 123"})
        assert returncode == 0
        # All commands go through AI analysis now


class TestNoCLI:
    """Test behavior when claude CLI is not available."""

    def test_no_claude_cli_passthrough(self, monkeypatch):
        """Without claude CLI in PATH, should pass through (user decides)."""
        # Remove claude from PATH by setting empty PATH
        monkeypatch.setenv("PATH", "/nonexistent")
        returncode, stdout = run_hook("Bash", {"command": "ls -la"})
        assert returncode == 0
        # Without claude CLI, passes through to normal permission flow
        assert parse_response(stdout) is None  # No decision = user decides


class TestResponseFormat:
    """Test that responses follow PermissionRequest format."""

    def test_response_format_documented(self):
        """Response format should be documented in the hook."""
        hook_content = HOOK_PATH.read_text()
        assert '"behavior"' in hook_content
        assert '"allow"' in hook_content
        assert '"deny"' in hook_content


class TestPolicyGuidelines:
    """Test that policy guidelines cover expected cases."""

    # Policy is now in a separate markdown file
    POLICY_PATH = HOOK_PATH.parent / "permission-policy.md"

    def test_policy_file_exists(self):
        """Policy file should exist."""
        assert self.POLICY_PATH.exists()

    def test_policy_has_green_section(self):
        """Policy should have GREEN section."""
        policy_content = self.POLICY_PATH.read_text()
        assert "### GREEN" in policy_content
        assert "Safe - Auto-approve" in policy_content

    def test_policy_has_yellow_section(self):
        """Policy should have YELLOW section."""
        policy_content = self.POLICY_PATH.read_text()
        assert "### YELLOW" in policy_content
        assert "Uncertain - User decides" in policy_content

    def test_policy_has_red_section(self):
        """Policy should have RED section."""
        policy_content = self.POLICY_PATH.read_text()
        assert "### RED" in policy_content
        assert "Dangerous - Block" in policy_content

    def test_policy_covers_rm_rf(self):
        """Policy should mention rm -rf as dangerous."""
        policy_content = self.POLICY_PATH.read_text()
        assert "rm -rf" in policy_content

    def test_policy_covers_git_force_push(self):
        """Policy should mention git push --force as dangerous."""
        policy_content = self.POLICY_PATH.read_text()
        assert "git push --force" in policy_content

    def test_policy_covers_shell_patterns(self):
        """Policy should mention shell patterns requiring inspection."""
        policy_content = self.POLICY_PATH.read_text()
        assert "Shell patterns requiring inspection" in policy_content
        assert "Command chaining" in policy_content

    def test_policy_covers_curl_pipe_sh(self):
        """Policy should mention curl | sh as dangerous."""
        policy_content = self.POLICY_PATH.read_text()
        assert "curl | sh" in policy_content or "curl | bash" in policy_content

    def test_policy_covers_safe_commands(self):
        """Policy should list safe commands."""
        policy_content = self.POLICY_PATH.read_text()
        assert "ls" in policy_content
        assert "cat" in policy_content
        assert "grep" in policy_content
        assert "git status" in policy_content


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
