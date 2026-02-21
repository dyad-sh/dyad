# TypeScript Strict Mode (tsgo)

The pre-commit hook runs `tsgo` (via `npm run ts`), which is stricter than `tsc --noEmit`. For example, passing a `number` to a function typed `(str: string | null | undefined)` may pass `tsc` but fail `tsgo` with `TS2345: Argument of type 'number' is not assignable to parameter of type 'string'`. Always wrap with `String()` when converting numbers to string parameters.

## tsgo installation requirement

`tsgo` is a Go binary, **not** an npm package — running `npx tsgo` fails with `npm error 404 Not Found - GET https://registry.npmjs.org/tsgo` because it is not in the npm registry. It is installed by the project's `npm install` step via a local package. If node_modules is missing or `npm install` fails (e.g., because the environment runs Node.js < 24, which the project requires), skip the `npm run ts` check and note that CI will verify types instead.

## ES2020 target limitations

The project's `tsconfig.app.json` targets ES2020 with `lib: ["ES2020"]`. Methods introduced in ES2021+ (like `String.prototype.replaceAll`) are not available on the `string` type. If code uses `replaceAll`, it needs an `as any` cast to avoid `TS2550: Property 'replaceAll' does not exist on type 'string'`. Do not remove these casts without updating the tsconfig target.
