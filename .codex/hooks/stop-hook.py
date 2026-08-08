#!/usr/bin/env python3
"""
AI-Powered Stop Hook

This is a Stop hook that runs when Claude is about to stop working.
It uses Claude Sonnet to analyze the transcript and determine whether
Claude should continue working or is allowed to stop.

The hook collects all Task* tool calls (TaskCreate, TaskUpdate, etc.) and
sends them inline with the conversation context to the LLM for analysis,
rather than parsing task state deterministically.

Usage:
    Receives JSON on stdin with session info including transcript_path
    Outputs JSON with decision="block" and reason to continue, or no output to allow stop
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Allow disabling this hook via environment variable
if os.environ.get("DYAD_DISABLE_CLAUDE_CODE_HOOKS", "").lower() in ("true", "1", "yes"):
    sys.exit(0)


def extract_task_tool_calls(transcript_path: str) -> list[dict]:
    """Extract all Task* tool calls from the transcript.

    Returns a list of dicts with:
        - tool_name: name of the tool (TaskCreate, TaskUpdate, etc.)
        - input: the tool input parameters
    """
    task_calls: list[dict] = []

    try:
        path = Path(transcript_path).expanduser()
        if not path.exists():
            return []

        lines = path.read_text().strip().split("\n")

        for line in lines:
            try:
                entry = json.loads(line)
                if entry.get("type") != "assistant":
                    continue

                content = entry.get("message", {}).get("content", [])
                for part in content:
                    if part.get("type") != "tool_use":
                        continue

                    tool_name = part.get("name", "")
                    if tool_name.startswith("Task"):
                        task_calls.append({
                            "tool_name": tool_name,
                            "input": part.get("input", {})
                        })

            except json.JSONDecodeError:
                continue

    except Exception:
        return []

    return task_calls


def get_claude_path() -> str | None:
    """Find the claude CLI path."""
    claude_path = shutil.which("claude")
    if claude_path:
        return claude_path

    home = Path.home()
    default_path = home / ".claude" / "local" / "claude"
    if default_path.exists() and os.access(default_path, os.X_OK):
        return str(default_path)

    return None


def read_transcript(transcript_path: str, max_chars: int = 32000) -> str:
    """Read and format the transcript for analysis.

    Includes content from the beginning and end of the transcript,
    truncating from the middle if needed to stay within limits.

    Args:
        transcript_path: Path to the JSONL transcript file
        max_chars: Maximum characters for the output (default 32000, ~8000 tokens)
    """
    try:
        path = Path(transcript_path).expanduser()
        if not path.exists():
            return ""

        lines = path.read_text().strip().split("\n")

        formatted = []
        for line in lines:
            try:
                entry = json.loads(line)
                msg_type = entry.get("type", "unknown")

                if msg_type == "user":
                    content = entry.get("message", {}).get("content", "")
                    if isinstance(content, list):
                        text_parts = [
                            p.get("text", "") for p in content if p.get("type") == "text"
                        ]
                        content = " ".join(text_parts)
                    formatted.append(f"USER: {content[:500]}")

                elif msg_type == "assistant":
                    content = entry.get("message", {}).get("content", [])
                    text_parts = []
                    tool_uses = []
                    for part in content:
                        if part.get("type") == "text":
                            text_parts.append(part.get("text", "")[:300])
                        elif part.get("type") == "tool_use":
                            tool_uses.append(part.get("name", "unknown"))
                    if text_parts:
                        formatted.append(f"ASSISTANT: {' '.join(text_parts)}")
                    if tool_uses:
                        formatted.append(f"ASSISTANT TOOLS: {', '.join(tool_uses)}")

                elif msg_type == "tool_result":
                    # Just note that a tool result came back
                    formatted.append("TOOL_RESULT: (received)")

            except json.JSONDecodeError:
                continue

        result = "\n".join(formatted)
        if len(result) > max_chars:
            # Keep beginning and end, truncate from middle
            # Reserve ~40% for beginning, ~60% for end (end is more important)
            begin_budget = int(max_chars * 0.4)
            end_budget = max_chars - begin_budget - 50  # 50 chars for truncation marker

            begin_part = result[:begin_budget]
            end_part = result[-end_budget:]

            result = begin_part + "\n\n...(middle truncated)...\n\n" + end_part
        return result

    except OSError:
        return ""


def analyze_with_claude(transcript: str, task_calls: list[dict], cwd: str) -> dict | None:
    """
    Use Claude CLI to analyze whether Claude should continue working.
    Returns dict with 'continue' (bool) and 'reason' (str) or None on failure.
    """
    claude_path = get_claude_path()
    if not claude_path:
        return None

    if not transcript:
        return None

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", cwd)

    # Format task tool calls section
    task_section = ""
    if task_calls:
        task_lines = []
        for call in task_calls:
            tool_name = call["tool_name"]
            tool_input = json.dumps(call["input"], indent=2)
            task_lines.append(f"### {tool_name}\n```json\n{tool_input}\n```")
        task_section = f"""
## Task Tool Calls
The following Task* tool calls were made during this session:

{chr(10).join(task_lines)}
"""

    prompt = f"""You are evaluating whether Claude Code should stop working or continue.

## Recent Conversation
{transcript}
{task_section}
## Analysis Instructions

Analyze the conversation above and determine if Claude should CONTINUE working or is allowed to STOP.

CONTINUE (block stopping) if ANY of these are true:
- Tasks the user requested are not fully completed
- Errors occurred that weren't resolved
- Claude said it would do something but didn't actually do it
- There are obvious next steps that should be done
- Work quality appears partial or incomplete
- There are failing tests or unresolved issues
- Task tool calls show tasks that were created but not marked as completed

ALLOW STOP if ALL of these are true:
- All requested tasks are genuinely, fully complete
- No unresolved errors exist
- No obvious follow-up work remains
- Claude has provided a clear summary or completion message
- All tasks created via TaskCreate have been marked completed via TaskUpdate (if any were created)

ALSO ALLOW STOP if Claude is in plan mode and:
- Has presented a plan or questions to the user
- Is waiting for user approval, feedback, or decisions
- Has used ExitPlanMode or AskUserQuestion to request user input
(In plan mode, stopping to get user input is correct behavior, not premature stopping)

Respond with ONLY a JSON object:
{{"continue": true, "reason": "specific explanation of what still needs to be done"}}
OR
{{"continue": false}}

JSON response:"""

    try:
        # Use stdin for prompt to avoid command-line length limits with large transcripts
        # Timeout is 25s (5s margin under the 30s hook timeout in settings.json)
        result = subprocess.run(
            [
                claude_path,
                "--print",
                "--output-format", "text",
                "--model", "sonnet",
                "--no-session-persistence",
                "-p", "-"
            ],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=25,
            cwd=project_dir,
        )

        if result.returncode != 0:
            return None

        response_text = result.stdout.strip()

        # Try direct JSON parse
        try:
            parsed = json.loads(response_text)
            if "continue" in parsed:
                return parsed
        except json.JSONDecodeError:
            pass

        # Extract JSON from response (handle markdown code fences, etc.)
        start_indices = [i for i, c in enumerate(response_text) if c == '{']
        for start in start_indices:
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
                                if "continue" in parsed:
                                    return parsed
                            except json.JSONDecodeError:
                                pass
                            break

        return None

    except (subprocess.SubprocessError, OSError):
        return None


def make_block_decision(reason: str) -> dict:
    """Block Claude from stopping - force continuation."""
    return {
        "decision": "block",
        "reason": reason
    }


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # Can't parse input, allow stop
        sys.exit(0)

    # Check for infinite loop prevention
    if input_data.get("stop_hook_active", False):
        # Already continuing due to stop hook, allow stop to prevent infinite loop
        sys.exit(0)

    transcript_path = input_data.get("transcript_path", "")
    cwd = input_data.get("cwd", os.getcwd())

    # Read transcript and extract task tool calls
    transcript = read_transcript(transcript_path)
    if not transcript:
        # No transcript to analyze, allow stop
        sys.exit(0)

    task_calls = extract_task_tool_calls(transcript_path) if transcript_path else []

    # Send transcript and task calls to AI for analysis
    result = analyze_with_claude(transcript, task_calls, cwd)

    if result is None:
        # Analysis failed, allow stop
        sys.exit(0)

    should_continue = result.get("continue", False)
    reason = result.get("reason", "Tasks may be incomplete")

    if should_continue:
        print(json.dumps(make_block_decision(reason)))

    # If not continuing, no output = allow stop
    sys.exit(0)


if __name__ == "__main__":
    main()
