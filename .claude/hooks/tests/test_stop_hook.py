#!/usr/bin/env python3
"""
Tests for the stop-hook.py
"""
import json
import subprocess
import sys
from pathlib import Path

# Path to the hook script
HOOK_PATH = Path(__file__).parent.parent / "stop-hook.py"


def run_hook(input_data: dict) -> dict | None:
    """Run the hook with the given input and return the parsed output."""
    result = subprocess.run(
        [sys.executable, str(HOOK_PATH)],
        input=json.dumps(input_data),
        capture_output=True,
        text=True,
    )
    if result.stdout.strip():
        return json.loads(result.stdout)
    return None


def test_no_tasks_allows_stop():
    """With no tasks, stopping should be allowed."""
    result = run_hook({"task_list": []})
    assert result is None, "Should allow stop when no tasks"
    print("PASS: No tasks allows stop")


def test_all_tasks_completed_allows_stop():
    """With all tasks completed, stopping should be allowed."""
    result = run_hook({
        "task_list": [
            {"id": "1", "status": "completed", "subject": "Task 1"},
            {"id": "2", "status": "completed", "subject": "Task 2"},
        ]
    })
    assert result is None, "Should allow stop when all tasks completed"
    print("PASS: All completed tasks allows stop")


def test_pending_task_blocks_stop():
    """With pending tasks, stopping should be blocked."""
    result = run_hook({
        "task_list": [
            {"id": "1", "status": "completed", "subject": "Done task"},
            {"id": "2", "status": "pending", "subject": "Pending task"},
        ]
    })
    assert result is not None, "Should block stop with pending tasks"
    output = result.get("hookSpecificOutput", {})
    assert output.get("decision") == "block", "Decision should be block"
    assert "Pending task" in output.get("reason", ""), "Reason should mention the task"
    print("PASS: Pending task blocks stop")


def test_in_progress_task_blocks_stop():
    """With in_progress tasks, stopping should be blocked."""
    result = run_hook({
        "task_list": [
            {"id": "1", "status": "completed", "subject": "Done task"},
            {"id": "2", "status": "in_progress", "subject": "Working on it"},
        ]
    })
    assert result is not None, "Should block stop with in_progress tasks"
    output = result.get("hookSpecificOutput", {})
    assert output.get("decision") == "block", "Decision should be block"
    assert "Working on it" in output.get("reason", ""), "Reason should mention the task"
    print("PASS: In-progress task blocks stop")


def test_multiple_incomplete_tasks_blocks_stop():
    """With multiple incomplete tasks, all should be listed."""
    result = run_hook({
        "task_list": [
            {"id": "1", "status": "completed", "subject": "Done"},
            {"id": "2", "status": "pending", "subject": "Todo 1"},
            {"id": "3", "status": "in_progress", "subject": "Todo 2"},
            {"id": "4", "status": "pending", "subject": "Todo 3"},
        ]
    })
    assert result is not None, "Should block stop"
    output = result.get("hookSpecificOutput", {})
    reason = output.get("reason", "")
    assert "3 incomplete task" in reason, "Should mention count"
    assert "Todo 1" in reason, "Should list Todo 1"
    assert "Todo 2" in reason, "Should list Todo 2"
    assert "Todo 3" in reason, "Should list Todo 3"
    print("PASS: Multiple incomplete tasks blocks stop")


def test_empty_input_allows_stop():
    """With empty/invalid input, stopping should be allowed."""
    result = run_hook({})
    assert result is None, "Should allow stop with empty input"
    print("PASS: Empty input allows stop")


def test_missing_task_list_allows_stop():
    """With missing task_list key, stopping should be allowed."""
    result = run_hook({"other_field": "value"})
    assert result is None, "Should allow stop without task_list"
    print("PASS: Missing task_list allows stop")


def main():
    """Run all tests."""
    print(f"Testing {HOOK_PATH}\n")

    test_no_tasks_allows_stop()
    test_all_tasks_completed_allows_stop()
    test_pending_task_blocks_stop()
    test_in_progress_task_blocks_stop()
    test_multiple_incomplete_tasks_blocks_stop()
    test_empty_input_allows_stop()
    test_missing_task_list_allows_stop()

    print("\nAll tests passed!")


if __name__ == "__main__":
    main()
