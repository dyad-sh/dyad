# Test Documentation

Prefer co-locating new unit tests next to the implementation file they cover
instead of adding them to this directory.

This directory is reserved for tests that do not currently have a runnable
co-located home under the root Vitest include pattern (`src/**/*.{test,spec}.{ts,tsx}`)
and for eval assets under `evals/`.

## Testing Setup

We use [Vitest](https://vitest.dev/) as our testing framework, which is designed to work well with Vite and modern JavaScript.

### Test Commands

Add these commands to your `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- `npm run test` - Run tests once
- `npm run test:watch` - Run tests in watch mode (rerun when files change)
- `npm run test:ui` - Run tests with UI reporter

## Mocking Guidelines

### Mocking fs module

When mocking the `node:fs` module, use a default export in the mock:

```typescript
vi.mock("node:fs", async () => {
  return {
    default: {
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      // Add other fs methods as needed
    },
  };
});
```

### Testing IPC Handlers

When testing IPC handlers, mock the Electron IPC system:

```typescript
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}));
```

## Adding New Tests

1. Create a new file with the `.test.ts` or `.spec.ts` extension next to the implementation when possible
2. Import the functions you want to test
3. Mock any dependencies using `vi.mock()`
4. Write your test cases using `describe()` and `it()`

## Example

See `chat_stream_handlers.test.ts` for an example of testing IPC handlers with proper mocking.
