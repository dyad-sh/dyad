# TypeScript Strict Mode (tsgo)

The pre-commit hook runs `tsgo` (via `npm run ts`), which is stricter than `tsc --noEmit`. For example, passing a `number` to a function typed `(str: string | null | undefined)` may pass `tsc` but fail `tsgo` with `TS2345: Argument of type 'number' is not assignable to parameter of type 'string'`. Always wrap with `String()` when converting numbers to string parameters.

## tsgo installation requirement

`tsgo` is a Go binary, **not** an npm package — running `npx tsgo` fails with `npm error 404 Not Found - GET https://registry.npmjs.org/tsgo` because it is not in the npm registry. It is installed by the project's `npm install` step via a local package. If node_modules is missing or `npm install` fails (e.g., because the environment runs Node.js < 24, which the project requires), skip the `npm run ts` check and note that CI will verify types instead.

If `npm run ts` fails because installed dependency types are missing APIs the repo already uses (for example `@neondatabase/api-client` missing `getNeonAuth` or `BetterAuth`), run `npm install` before editing source. Stale `node_modules` can lag behind the lockfile even when `package.json` is unchanged.

If `npm run ts` crashes with a Go `SIGSEGV`/segmentation fault inside `tsgo` instead of reporting TypeScript diagnostics, remove the stale incremental build cache and retry: `rm -f node_modules/.tmp/tsconfig.app.tsbuildinfo && npm run ts`. This can happen after package/alias changes and is not necessarily a source type error.

## `import.meta.env` is not typed in renderer source

`import.meta.env?.DEV` in `src/` fails `npm run ts` with `TS2339: Property 'env' does not exist on type 'ImportMeta'` (tsconfig.app.json does not load Vite client types; `renderer.tsx` uses `// @ts-ignore` for its one access). For dev/prod branching use `process.env.NODE_ENV !== "production"` instead — Vite statically replaces it in renderer builds and it works in vitest. Also note `npx tsc --noEmit -p tsconfig.json` can pass while `npm run ts` fails; only `npm run ts` is authoritative.

## `useRef` requires an explicit initial value

`useRef<number>()` with no argument fails `npm run ts` with `TS2554: Expected 1 arguments, but got 0` (the React types in this repo have no argless overload). Write `useRef<number | undefined>(undefined)` instead.

## ES2020 target limitations

The project's `tsconfig.app.json` targets ES2020 with `lib: ["ES2020"]`. Methods introduced in ES2021+ (like `String.prototype.replaceAll`) are not available on the `string` type. If code uses `replaceAll`, it needs an `as any` cast to avoid `TS2550: Property 'replaceAll' does not exist on type 'string'`. Do not remove these casts without updating the tsconfig target.

## `response.json()` returns `unknown`

In IPC handlers that use `node-fetch`, `await response.json()` is treated as `unknown` by `tsgo`. If you access fields directly (for example `data.message` or `data.access_token`), add an explicit cast or narrow first (for example `const data = (await response.json()) as { message?: string }`) to avoid `TS18046`.

## i18next `t()` keys are a literal union, not `string`

`useTranslation` returns a `t()` typed against a union of every key in the namespace. Passing a variable whose type widens to `string` (e.g., a `labelKey` field collected into an array) fails with `TS2345: Argument of type '[string]' is not assignable to parameter of type '[key: "added" | "..."]'`. Resolve the label at the call site (`{ label: t("groupToday") }`) instead of storing the key for later lookup (`{ labelKey: "groupToday" }` then `t(group.labelKey)`). If you really need late binding, narrow with `as const` so the literal type survives.
