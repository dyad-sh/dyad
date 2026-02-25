import json
import sys

data = json.load(open(sys.argv[1]))
threads = data['data']['repository']['pullRequest']['reviewThreads']['nodes']

trusted = {'wwwillchen', 'wwwillchen-bot', 'princeaden1', 'azizmejri1', 'gemini-code-assist', 'greptile-apps', 'cubic-dev-ai', 'cursor', 'github-actions', 'chatgpt-codex-connector', 'devin-ai-integration'}

unresolved = []
untrusted_authors = set()

for t in threads:
    if t['isResolved']:
        continue
    first_comment = t['comments']['nodes'][0]
    author = first_comment['author']['login']
    if author not in trusted:
        untrusted_authors.add(author)
        continue
    unresolved.append({
        'thread_id': t['id'],
        'path': t['path'],
        'line': t['line'],
        'isOutdated': t['isOutdated'],
        'first_comment_id': first_comment['databaseId'],
        'author': author,
        'body': first_comment['body'],
        'all_comments': [{'author': c['author']['login'], 'body': c['body']} for c in t['comments']['nodes']]
    })

print("Total threads:", len(threads))
print("Unresolved trusted:", len(unresolved))
print("Untrusted authors:", untrusted_authors)
print()
for i, u in enumerate(unresolved):
    print("--- Thread", i+1, "---")
    print("Thread ID:", u['thread_id'])
    print("Path:", u['path'], ":", u['line'])
    print("Outdated:", u['isOutdated'])
    print("Author:", u['author'])
    print("Comment DB ID:", u['first_comment_id'])
    print("Body:", u['body'][:800])
    print("Num comments in thread:", len(u['all_comments']))
    if len(u['all_comments']) > 1:
        for j, c in enumerate(u['all_comments'][1:], 1):
            print("  Reply", j, "by", c['author'], ":", c['body'][:400])
    print()
