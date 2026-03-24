import json
import sys

with open("/tmp/session-3070.json") as f:
    data = json.load(f)

print("=== Schema Version:", data.get("schemaVersion"))
print("=== Exported At:", data.get("exportedAt"))
print()

# Chat structure
chat = data.get("chat", {})
print("=== Chat keys:", list(chat.keys()) if isinstance(chat, dict) else type(chat).__name__)
if isinstance(chat, dict):
    for k, v in chat.items():
        if isinstance(v, list):
            print(f"  chat.{k}: list of {len(v)} items")
        elif isinstance(v, dict):
            print(f"  chat.{k}: dict with keys {list(v.keys())[:10]}")
        else:
            print(f"  chat.{k}: {repr(v)[:100]}")

# Logs
logs = data.get("logs", {})
print()
print("=== Logs keys:", list(logs.keys()) if isinstance(logs, dict) else type(logs).__name__)
if isinstance(logs, dict):
    for k, v in logs.items():
        if isinstance(v, list):
            print(f"  logs.{k}: list of {len(v)} items")
        elif isinstance(v, str):
            print(f"  logs.{k}: string of {len(v)} chars")
        else:
            print(f"  logs.{k}: {type(v).__name__}")
