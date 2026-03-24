import json

with open("/tmp/session-3070.json") as f:
    data = json.load(f)

messages = data["chat"]["messages"]

# Look at all message keys and check for tool-related content
for i, msg in enumerate(messages):
    role = msg.get("role", "unknown")
    keys = list(msg.keys())
    print(f"Message {i}: role={role}, keys={keys}")

    # Check for tool calls in different formats
    if "toolCalls" in msg or "tool_calls" in msg or "toolInvocations" in msg:
        tc = msg.get("toolCalls") or msg.get("tool_calls") or msg.get("toolInvocations")
        print(f"  Tool calls: {len(tc) if isinstance(tc, list) else tc}")
        if isinstance(tc, list):
            for t in tc:
                if isinstance(t, dict):
                    print(f"    id={t.get('id','?')} name={t.get('name','?')} state={t.get('state','?')}")

    # Check for parts/blocks
    if "parts" in msg:
        parts = msg["parts"]
        print(f"  Parts: {len(parts) if isinstance(parts, list) else type(parts).__name__}")
        if isinstance(parts, list):
            for j, p in enumerate(parts[:5]):
                if isinstance(p, dict):
                    print(f"    Part {j}: type={p.get('type','?')} keys={list(p.keys())[:6]}")

    # Check content for tool_use patterns if string
    content = msg.get("content", "")
    if isinstance(content, str) and "tool_use" in content:
        print(f"  Content mentions 'tool_use'")
    if isinstance(content, str) and "toolu_" in content:
        # Find the tool use ids
        import re
        ids = re.findall(r'toolu_\w+', content)
        print(f"  Contains tool IDs: {ids[:5]}")

print()

# Check for the specific tool ID from the error
error_tool_id = "toolu_01SXeki1uX2AGU9TSaYsLZQn"
full_json = json.dumps(data["chat"]["messages"])
if error_tool_id in full_json:
    print(f"Found error tool ID {error_tool_id} in messages!")
    # Find which message
    for i, msg in enumerate(messages):
        if error_tool_id in json.dumps(msg):
            print(f"  In message {i} (role={msg.get('role')})")
else:
    print(f"Error tool ID {error_tool_id} NOT found in messages")

# Also look at logs
logs = data.get("logs", "")
if isinstance(logs, str) and len(logs) > 0:
    print(f"\nLogs: string of {len(logs)} chars")
    # Find error-related log entries
    lines = logs.split("\n")
    print(f"Total log lines: {len(lines)}")
    for line in lines:
        if any(kw in line.lower() for kw in ["error", "fail", "tool_use", "tool_result", "400", "invalid"]):
            print(f"  {line[:200]}")
elif isinstance(logs, dict):
    print(f"\nLogs: dict with keys {list(logs.keys())}")
