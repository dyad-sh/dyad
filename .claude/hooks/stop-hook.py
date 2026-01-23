#!/usr/bin/env python3
"""
Stop Hook - Prevent Early Stopping

This hook runs when Claude is about to stop and checks if there are incomplete
tasks in the task list. If tasks remain, it returns a message prompting Claude
to continue working.

Input (stdin - JSON):
{
    "stop_hook_active": true,
    "transcript_messages": [...],  # Recent conversation context
    "task_list": [                 # Current tasks (if available)
        {"id": "1", "status": "completed", "subject": "..."},
        {"id": "2", "status": "in_progress", "subject": "..."},
        {"id": "3", "status": "pending", "subject": "..."}
    ]
}

Output (stdout - JSON):
{
    "hookSpecificOutput": {
        "hookEventName": "Stop",
        "decision": "block" | "allow",
        "reason": "Message to show Claude if blocked"
    }
}
"""
import json
import sys


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # Invalid input, allow stop
        sys.exit(0)

    # Check if we have task list information
    task_list = input_data.get("task_list", [])

    # If no task list, allow stopping (no tasks to check)
    if not task_list:
        sys.exit(0)

    # Check for incomplete tasks
    incomplete_tasks = []
    for task in task_list:
        status = task.get("status", "")
        if status in ("pending", "in_progress"):
            incomplete_tasks.append({
                "id": task.get("id", "?"),
                "subject": task.get("subject", "Unknown task"),
                "status": status
            })

    # If all tasks are done, allow stopping
    if not incomplete_tasks:
        sys.exit(0)

    # Build message about remaining tasks
    task_summaries = []
    for t in incomplete_tasks:
        task_summaries.append(f"  - [{t['status']}] {t['subject']} (id: {t['id']})")

    remaining_tasks_msg = "\n".join(task_summaries)

    decision = {
        "hookSpecificOutput": {
            "hookEventName": "Stop",
            "decision": "block",
            "reason": f"STOP! You still have {len(incomplete_tasks)} incomplete task(s):\n{remaining_tasks_msg}\n\nPlease continue working on your tasks. Use TaskList to see current tasks and TaskUpdate to mark them complete when done."
        }
    }

    print(json.dumps(decision))
    sys.exit(0)


if __name__ == "__main__":
    main()
