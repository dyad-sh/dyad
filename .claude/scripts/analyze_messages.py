import json

with open("/tmp/session-3070.json") as f:
    data = json.load(f)

messages = data["chat"]["messages"]
print(f"Total messages: {len(messages)}")
print()

for i, msg in enumerate(messages):
    role = msg.get("role", "unknown")
    content = msg.get("content", "")

    # Check content type
    if isinstance(content, str):
        print(f"Message {i}: role={role}, content=string({len(content)} chars)")
        if len(content) < 200:
            print(f"  Text: {content[:200]}")
    elif isinstance(content, list):
        print(f"Message {i}: role={role}, content=list of {len(content)} blocks")
        for j, block in enumerate(content):
            if isinstance(block, dict):
                btype = block.get("type", "unknown")
                if btype == "tool_use":
                    print(f"  Block {j}: tool_use id={block.get('id', 'N/A')} name={block.get('name', 'N/A')}")
                elif btype == "tool_result":
                    print(f"  Block {j}: tool_result tool_use_id={block.get('tool_use_id', 'N/A')}")
                elif btype == "text":
                    text = block.get("text", "")
                    print(f"  Block {j}: text ({len(text)} chars): {text[:100]}...")
                else:
                    print(f"  Block {j}: type={btype}")
            else:
                print(f"  Block {j}: {type(block).__name__}")
    else:
        print(f"Message {i}: role={role}, content type={type(content).__name__}")

    # Check for error fields
    for key in ["error", "errorMessage", "status", "finishReason", "stop_reason"]:
        if key in msg:
            print(f"  {key}: {repr(msg[key])[:200]}")

    print()
