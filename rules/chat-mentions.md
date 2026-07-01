# Chat Mentions

- When changing app mention syntax or parsing, keep all chat mention paths aligned: shared parsing in `src/shared/parse_mention_apps.ts`, referenced-app extraction in `src/ipc/utils/mention_apps.ts`, and Lexical external value sync in `src/components/chat/LexicalChatInput.tsx`. Saved values like `@app:foo.app.com` must render back as one mention node, not a shortened mention plus plain text.
