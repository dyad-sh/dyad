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

    def test_analyze_returns_none_when_no_cli(self, tmp_path, monkeypatch):
        """analyze_with_claude should return None when claude CLI is not found."""
        module = load_hook_module()

        # Mock get_claude_path to return None (simulating no CLI available)
        monkeypatch.setattr(module, "get_claude_path", lambda: None)

        assert module.analyze_with_claude("test transcript", str(tmp_path)) is None

    def test_no_claude_cli_allows_stop(self, tmp_path):
        """Without claude CLI, should allow stop (no AI analysis possible)."""
        # Create a minimal transcript
        transcript = tmp_path / "transcript.jsonl"
        transcript.write_text('{"type": "user", "message": {"content": "hello"}}\n')

        returncode, _ = run_hook({
            "session_id": "test",
            "transcript_path": str(transcript),
            "cwd": str(tmp_path),
            "stop_hook_active": False
        })
        assert returncode == 0
        # The hook should complete without error (output depends on CLI availability)


class TestAnalyzeWithClaude:
    """Test analyze_with_claude function with mocked subprocess."""

    def test_parses_valid_json_response(self, tmp_path, monkeypatch):
        """Should correctly parse a valid JSON response from CLI."""
        module = load_hook_module()
        monkeypatch.setattr(module, "get_claude_path", lambda: "/usr/bin/claude")

        mock_result = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='{"continue": true, "reason": "Tasks incomplete"}',
            stderr=""
        )
        monkeypatch.setattr(subprocess, "run", lambda *_args, **_kwargs: mock_result)

        result = module.analyze_with_claude("test transcript", str(tmp_path))
        assert result is not None
        assert result["continue"] is True
        assert result["reason"] == "Tasks incomplete"

    def test_parses_json_in_markdown_code_fence(self, tmp_path, monkeypatch):
        """Should extract JSON wrapped in markdown code fences."""
        module = load_hook_module()
        monkeypatch.setattr(module, "get_claude_path", lambda: "/usr/bin/claude")

        mock_result = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='```json\n{"continue": false}\n```',
            stderr=""
        )
        monkeypatch.setattr(subprocess, "run", lambda *_args, **_kwargs: mock_result)

        result = module.analyze_with_claude("test transcript", str(tmp_path))
        assert result is not None
        assert result["continue"] is False

    def test_returns_none_for_no_json(self, tmp_path, monkeypatch):
        """Should return None when response contains no JSON."""
        module = load_hook_module()
        monkeypatch.setattr(module, "get_claude_path", lambda: "/usr/bin/claude")

        mock_result = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="I think the tasks are complete.",
            stderr=""
        )
        monkeypatch.setattr(subprocess, "run", lambda *_args, **_kwargs: mock_result)

        result = module.analyze_with_claude("test transcript", str(tmp_path))
        assert result is None

    def test_returns_none_for_malformed_json(self, tmp_path, monkeypatch):
        """Should return None when JSON is malformed."""
        module = load_hook_module()
        monkeypatch.setattr(module, "get_claude_path", lambda: "/usr/bin/claude")

        mock_result = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='{"continue": true, reason: incomplete}',  # Missing quotes
            stderr=""
        )
        monkeypatch.setattr(subprocess, "run", lambda *_args, **_kwargs: mock_result)

        result = module.analyze_with_claude("test transcript", str(tmp_path))
        assert result is None

    def test_returns_none_on_nonzero_returncode(self, tmp_path, monkeypatch):
        """Should return None when subprocess returns non-zero exit code."""
        module = load_hook_module()
        monkeypatch.setattr(module, "get_claude_path", lambda: "/usr/bin/claude")

        mock_result = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout='{"continue": true}',
            stderr="Error: API rate limit"
        )
        monkeypatch.setattr(subprocess, "run", lambda *_args, **_kwargs: mock_result)

        result = module.analyze_with_claude("test transcript", str(tmp_path))
        assert result is None

    def test_returns_none_on_subprocess_error(self, tmp_path, monkeypatch):
        """Should return None when subprocess raises an error."""
        module = load_hook_module()
        monkeypatch.setattr(module, "get_claude_path", lambda: "/usr/bin/claude")

        def raise_error(*_args, **_kwargs):
            raise subprocess.TimeoutExpired(cmd="claude", timeout=25)

        monkeypatch.setattr(subprocess, "run", raise_error)

        result = module.analyze_with_claude("test transcript", str(tmp_path))
        assert result is None

    def test_returns_none_for_empty_transcript(self, tmp_path, monkeypatch):
        """Should return None when transcript is empty."""
        module = load_hook_module()
        monkeypatch.setattr(module, "get_claude_path", lambda: "/usr/bin/claude")

        result = module.analyze_with_claude("", str(tmp_path))
        assert result is None


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


def load_hook_module():
    """Load the stop hook module for testing."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("stop_hook", HOOK_PATH)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class TestTaskStateExtraction:
    """Test task state extraction from transcripts."""

    def test_extracts_incomplete_tasks(self):
        """Should correctly identify remaining tasks from incomplete_tasks fixture.

        The fixture has:
        - 5 tasks created
        - Tasks 1, 2, 3 completed
        - Task 4 in_progress (not completed)
        - Task 5 pending (never started)
        => 2 tasks remaining
        """
        module = load_hook_module()
        fixture_path = Path(__file__).parent / "fixtures" / "incomplete_tasks.jsonl"
        result = module.extract_task_state(str(fixture_path))

        assert result["total"] == 5
        assert len(result["remaining"]) == 2

        # Check the specific remaining tasks
        remaining_ids = [task_id for task_id, _, _ in result["remaining"]]
        assert "4" in remaining_ids
        assert "5" in remaining_ids

        # Task 4 should be in_progress
        task4 = [(tid, subj, status) for tid, subj, status in result["remaining"] if tid == "4"][0]
        assert task4[2] == "in_progress"
        assert "Verify" in task4[1] or "commit" in task4[1] or "push" in task4[1]

        # Task 5 should be pending
        task5 = [(tid, subj, status) for tid, subj, status in result["remaining"] if tid == "5"][0]
        assert task5[2] == "pending"
        assert "summary" in task5[1].lower()

    def test_extracts_completed_tasks(self):
        """Should correctly identify all tasks completed from completed_tasks fixture."""
        module = load_hook_module()
        fixture_path = Path(__file__).parent / "fixtures" / "completed_tasks.jsonl"
        result = module.extract_task_state(str(fixture_path))

        assert result["total"] == 3
        assert len(result["remaining"]) == 0

    def test_handles_nonexistent_file(self):
        """Should handle nonexistent transcript gracefully."""
        module = load_hook_module()
        result = module.extract_task_state("/nonexistent/path.jsonl")

        assert result["total"] == 0
        assert len(result["remaining"]) == 0

    def test_handles_no_tasks(self, tmp_path):
        """Should handle transcript with no tasks."""
        module = load_hook_module()
        transcript = tmp_path / "no_tasks.jsonl"
        transcript.write_text('{"type": "user", "message": {"content": "hello"}}\n')

        result = module.extract_task_state(str(transcript))

        assert result["total"] == 0
        assert len(result["remaining"]) == 0


class TestRemainingTasksBlocking:
    """Test that hook blocks when tasks are remaining."""

    def test_blocks_with_remaining_tasks(self):
        """Hook should block and list remaining tasks when incomplete."""
        fixture_path = Path(__file__).parent / "fixtures" / "incomplete_tasks.jsonl"

        returncode, stdout = run_hook({
            "session_id": "test",
            "transcript_path": str(fixture_path),
            "cwd": "/tmp",
            "stop_hook_active": False
        })

        assert returncode == 0
        response = parse_response(stdout)
        assert response is not None
        assert response["decision"] == "block"

        # Reason should mention the count
        assert "2 of 5 tasks remaining" in response["reason"]

        # Reason should list the specific tasks
        assert "Task 4" in response["reason"]
        assert "Task 5" in response["reason"]
        assert "in_progress" in response["reason"]
        assert "pending" in response["reason"]

    def test_allows_stop_with_all_tasks_completed(self, monkeypatch):
        """Hook should allow stop (via AI check) when all tasks are completed."""
        fixture_path = Path(__file__).parent / "fixtures" / "completed_tasks.jsonl"

        # Remove claude from PATH so AI check is skipped
        monkeypatch.setenv("PATH", "/nonexistent")

        returncode, stdout = run_hook({
            "session_id": "test",
            "transcript_path": str(fixture_path),
            "cwd": "/tmp",
            "stop_hook_active": False
        })

        assert returncode == 0
        # No remaining tasks, and no AI available, so should allow stop
        assert parse_response(stdout) is None


class TestTranscriptReading:
    """Test transcript reading functionality."""

    def test_reads_incomplete_tasks_fixture(self):
        """Should correctly parse the incomplete_tasks fixture.

        This fixture represents a real scenario where:
        - 5 tasks were created
        - Tasks 1, 2, 3 were completed
        - Task 4 is in_progress (never completed)
        - Task 5 is pending (never started)
        => 2 tasks remaining
        """
        module = load_hook_module()
        fixture_path = Path(__file__).parent / "fixtures" / "incomplete_tasks.jsonl"
        result = module.read_transcript(str(fixture_path))

        # Should contain the user request
        assert "USER:" in result
        assert "Fix all the PR review comments" in result

        # Should show task creation
        assert "TaskCreate" in result

        # Should show the incomplete state - last message is about lint checks
        assert "lint checks" in result

        # Should NOT have a completion summary
        assert "All tasks are complete" not in result
        assert "summary" not in result.lower() or "Providing summary" not in result

    def test_reads_completed_tasks_fixture(self):
        """Should correctly parse the completed_tasks fixture.

        This fixture represents a scenario where all tasks completed successfully.
        """
        module = load_hook_module()
        fixture_path = Path(__file__).parent / "fixtures" / "completed_tasks.jsonl"
        result = module.read_transcript(str(fixture_path))

        # Should contain the user request
        assert "USER:" in result
        assert "Fix all the PR review comments" in result

        # Should have a completion summary at the end
        assert "completed all the PR review comments" in result
        assert "All tasks are complete" in result

    def test_reads_user_messages(self, tmp_path):
        """Should be able to read user messages from transcript."""
        module = load_hook_module()
        transcript = tmp_path / "transcript.jsonl"
        transcript.write_text(
            '{"type": "user", "message": {"content": "test message"}}\n'
        )

        result = module.read_transcript(str(transcript))
        assert "USER:" in result
        assert "test message" in result

    def test_reads_assistant_messages(self, tmp_path):
        """Should be able to read assistant messages from transcript."""
        module = load_hook_module()
        transcript = tmp_path / "transcript.jsonl"
        transcript.write_text(
            '{"type": "assistant", "message": {"content": [{"type": "text", "text": "response text"}]}}\n'
        )

        result = module.read_transcript(str(transcript))
        assert "ASSISTANT:" in result
        assert "response text" in result

    def test_truncates_large_transcripts(self, tmp_path):
        """Should truncate large transcripts from the middle, keeping beginning and end."""
        module = load_hook_module()
        transcript = tmp_path / "transcript.jsonl"
        # Create a large transcript with many messages
        lines = []
        for i in range(100):
            lines.append(f'{{"type": "user", "message": {{"content": "message {i} with some extra content to make it longer"}}}}')
        transcript.write_text("\n".join(lines))

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
