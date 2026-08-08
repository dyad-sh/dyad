# Coder Agent

A focused AI coding agent built with Next.js, AI SDK, Vercel AI Gateway, and Vercel Sandbox. The app provides chat-driven code generation, live preview, file browsing, command logs, and automatic error feedback.

## Features

- GPT-5.3 Codex through Vercel AI Gateway
- Secure code execution with Vercel Sandbox
- Live preview for generated apps
- File explorer for sandbox files
- Command logs and error monitoring

## Setup

Create `.env.local`:

```env
AI_GATEWAY_API_KEY=
```

Install and run:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000/agent](http://localhost:3000/agent).

## Scripts

```bash
pnpm dev
pnpm build
pnpm type-check
```
