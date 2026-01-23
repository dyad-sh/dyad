#!/usr/bin/env python3
"""
Tests for the AI-powered Stop hook.

This is a Stop hook that runs when Claude is about to stop working.
It can block stopping to force continuation if tasks are incomplete.

Response format: { "decision": "block", "reason": "..." } or no output to allow stop
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

# Get the hook path
HOOK_PATH = Path(__file__).parent.parent / "stop-hook.py"


def run_hook(input_data: dict) -> tuple[int, str]:
    """Run the hook with the given input and return (returncode, stdout)."""
    input_json = json.dumps(input_data)

    result = subprocess.run(
        [sys.executable, str(HOOK_PATH)],
        input=input_json,
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

    def test_invalid_json_allows_stop(self):
        """Invalid JSON should allow stop (exit 0, no output)."""
        result = subprocess.run(
            [sys.executable, str(HOOK_PATH)],
            input="not valid json",
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert result.stdout == ""

    def test_stop_hook_active_allows_stop(self):
        """When stop_hook_active is true, should allow stop to prevent infinite loop."""
        returncode, stdout = run_hook({
            "session_id": "test",
            "transcript_path": "/nonexistent/path",
            "cwd": "/tmp",
            "stop_hook_active": True
        })
        assert returncode == 0
        assert stdout == ""

    def test_missing_transcript_allows_stop(self):
        """Missing transcript should allow stop."""
        returncode, stdout = run_hook({
            "session_id": "test",
            "cwd": "/tmp",
            "stop_hook_active": False
        })
        assert returncode == 0
        assert stdout == ""

    def test_nonexistent_transcript_allows_stop(self):
        """Nonexistent transcript path should allow stop."""
        returncode, stdout = run_hook({
            "session_id": "test",
            "transcript_path": "/nonexistent/path/to/transcript.jsonl",
            "cwd": "/tmp",
            "stop_hook_active": False
        })
        assert returncode == 0
        assert stdout == ""


class TestNoCLI:
    """Test behavior when claude CLI is not available."""

    def test_no_claude_cli_allows_stop(self, monkeypatch, tmp_path):
        """Without claude CLI, should allow stop (no AI analysis possible)."""
        # Create a minimal transcript
        transcript = tmp_path / "transcript.jsonl"
        transcript.write_text('{"type": "user", "message": {"content": "hello"}}\n')

        # Remove claude from PATH
        monkeypatch.setenv("PATH", "/nonexistent")

        returncode, stdout = run_hook({
            "session_id": "test",
            "transcript_path": str(transcript),
            "cwd": str(tmp_path),
            "stop_hook_active": False
        })
        assert returncode == 0
        # Without claude CLI, allows stop
        assert parse_response(stdout) is None


class TestResponseFormat:
    """Test that responses follow Stop hook format."""

    def test_response_format_documented(self):
        """Response format should be documented in the hook."""
        hook_content = HOOK_PATH.read_text()
        assert '"decision"' in hook_content
        assert '"block"' in hook_content
        assert '"reason"' in hook_content

    def test_hook_checks_stop_hook_active(self):
        """Hook should check stop_hook_active to prevent infinite loops."""
        hook_content = HOOK_PATH.read_text()
        assert "stop_hook_active" in hook_content


class TestTranscriptReading:
    """Test transcript reading functionality."""

    def test_reads_user_messages(self, tmp_path):
        """Should be able to read user messages from transcript."""
        transcript = tmp_path / "transcript.jsonl"
        transcript.write_text(
            '{"type": "user", "message": {"content": "test message"}}\n'
        )

        # Import the function directly for unit testing
        import importlib.util
        spec = importlib.util.spec_from_file_location("stop_hook", HOOK_PATH)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        result = module.read_transcript(str(transcript))
        assert "USER:" in result
        assert "test message" in result

    def test_reads_assistant_messages(self, tmp_path):
        """Should be able to read assistant messages from transcript."""
        transcript = tmp_path / "transcript.jsonl"
        transcript.write_text(
            '{"type": "assistant", "message": {"content": [{"type": "text", "text": "response text"}]}}\n'
        )

        import importlib.util
        spec = importlib.util.spec_from_file_location("stop_hook", HOOK_PATH)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        result = module.read_transcript(str(transcript))
        assert "ASSISTANT:" in result
        assert "response text" in result

    def test_truncates_large_transcripts(self, tmp_path):
        """Should truncate large transcripts from the middle, keeping beginning and end."""
        transcript = tmp_path / "transcript.jsonl"
        # Create a large transcript with many messages
        lines = []
        for i in range(100):
            lines.append(f'{{"type": "user", "message": {{"content": "message {i} with some extra content to make it longer"}}}}')
        transcript.write_text("\n".join(lines))

        import importlib.util
        spec = importlib.util.spec_from_file_location("stop_hook", HOOK_PATH)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        # With a small max_chars, should truncate from the middle
        result = module.read_transcript(str(transcript), max_chars=500)
        assert len(result) <= 600  # Allow buffer for truncation marker
        assert "...(middle truncated)..." in result
        # Should keep beginning messages (lower numbers)
        assert "message 0" in result or "message 1" in result
        # Should keep end messages (higher numbers)
        assert "message 99" in result or "message 98" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
