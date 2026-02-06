# TypeScript Strict Mode (tsgo)

The pre-commit hook runs `tsgo` (via `npm run ts`), which is stricter than `tsc --noEmit`. For example, passing a `number` to a function typed `(str: string | null | undefined)` may pass `tsc` but fail `tsgo` with `TS2345: Argument of type 'number' is not assignable to parameter of type 'string'`. Always wrap with `String()` when converting numbers to string parameters.
