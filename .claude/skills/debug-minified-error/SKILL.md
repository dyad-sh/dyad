---
name: dyad:debug-minified-error
description: Map a minified error stack trace from a production Dyad build back to original source locations using source maps.
---

# Debug Minified Error

Given a minified error stack trace from a production Dyad build (referencing `app.asar/.vite/renderer/main_window/assets/index-*.js`), map each frame back to the original TypeScript source file, line, and column.

## Arguments

- `$ARGUMENTS`: The full error message and stack trace from the minified production build. Should contain lines like:
  ```
  TypeError: Invalid URL
      at FOt (file:///usr/lib/dyad/resources/app.asar/.vite/renderer/main_window/assets/index-XXXX.js:1432:7223)
  ```

## Instructions

### 1. Determine the Dyad release version

You **must** know which Dyad release version this error occurred in. Check if the user provided it in `$ARGUMENTS` or in conversation context.

**If the version is not known, ASK THE USER.** Do not assume or guess the version.

### 2. Check out the matching release commit

Look up the GitHub release for that version to find the exact commit hash:

```bash
gh release view v<VERSION> --repo dyad-sh/dyad --json tagCommitish,targetCommitish
```

If the release tag doesn't resolve directly, find the commit from the tag:

```bash
git ls-remote --tags origin "v<VERSION>"
```

Then check out that commit:

```bash
git checkout <commit-hash>
```

### 3. Install dependencies and build

```bash
npm install
npm run package
```

This ensures the local build matches the exact code that produced the error's minified bundle.

### 4. Extract the app.asar

Find the built `app.asar` in the `out/` directory and extract it to a temp directory:

```bash
find out/ -name "app.asar" -print -quit
```

```bash
npx @electron/asar extract <path-to-app.asar> /tmp/dyad-asar-extracted
```

If `out/` doesn't exist or has no `app.asar`, the build may have failed — check the build output for errors.

### 5. Check for existing source maps

Look for `.js.map` files alongside the renderer bundle:

```bash
find /tmp/dyad-asar-extracted/.vite/renderer/main_window/assets -name "*.map" 2>/dev/null
```

### 6. Build with source maps if needed

If no source maps exist in the extracted asar (which is typical for production builds), do a renderer-only build with source maps:

```bash
npx vite build --config vite.renderer.config.mts --outDir /tmp/dyad-sourcemap-build --sourcemap
```

This produces an `index-*.js` and `index-*.js.map` in `/tmp/dyad-sourcemap-build/assets/`.

**Important:** The build hash will differ from the error stack trace's hash. That's fine — we match by **minified function names**, not by line/column from the error directly.

### 7. Find minified function names in the new build

For each function name in the error stack trace (e.g., `FOt`, `xO`, `PR`), find its position in the newly built bundle:

```js
// Search for each function name and record line:column positions
node -e "
const fs = require('fs');
const content = fs.readFileSync('/tmp/dyad-sourcemap-build/assets/<index-file>.js', 'utf8');
const lines = content.split('\n');
const names = ['FOt', 'xO', ...]; // from stack trace
for (const name of names) {
  for (let i = 0; i < lines.length; i++) {
    let col = lines[i].indexOf(name);
    while (col !== -1) {
      console.log(name + ' at Line ' + (i+1) + ', Col ' + col);
      col = lines[i].indexOf(name, col + 1);
    }
  }
}
"
```

**Disambiguation:** If a function name appears multiple times:

- The **definition** (e.g., `const FOt=` or `function FOt(`) is usually the one referenced in the stack trace.
- Cross-reference with the column offset from the error to pick the right occurrence.

### 8. Map positions to original source using source maps

Use the `source-map` package (available in node_modules) to resolve each position:

```js
node -e "
const fs = require('fs');
const { SourceMapConsumer } = require(require.resolve('source-map', {paths: [process.cwd()]}));

async function main() {
  const rawMap = JSON.parse(fs.readFileSync('/tmp/dyad-sourcemap-build/assets/<index-file>.js.map', 'utf8'));
  const consumer = await new SourceMapConsumer(rawMap);

  const positions = [
    {name: 'FOt', line: <line>, col: <col>},
    // ... one entry per stack frame
  ];

  for (const pos of positions) {
    const orig = consumer.originalPositionFor({line: pos.line, column: pos.col});
    console.log(pos.name + ':');
    console.log('  -> ' + orig.source + ':' + orig.line + ':' + orig.column + ' (name: ' + orig.name + ')');
  }
}
main().catch(console.error);
"
```

### 9. For the root cause frame, find all relevant expressions

The topmost non-React frame is usually the root cause. For that frame's line in the minified bundle, search for the specific expression that throws (e.g., all `new URL(` calls) and map each to the original source:

```js
// Find all occurrences of the throwing expression on the relevant minified line
// and map each to original source
```

This narrows down the exact expression within a large component.

### 10. Report the de-minified stack trace

Present the mapped stack trace in a clear format:

```
Original stack trace:
  1. ErrorBanner (src/components/preview_panel/PreviewIframe.tsx:1148:22)
  2. React internals (renderWithHooks, reconcileChildren, etc.)
  ...
```

**Distinguish between:**

- **Application frames** — these are actionable, show full source path and line
- **React/library internals** — label these as such, no need to map in detail
- **The root cause** — highlight which frame and expression actually threw the error

### 11. Show the offending source code

Read the original source file at the identified line and show the surrounding context (5-10 lines). Explain why the expression throws and suggest a fix if obvious.

## Tips

- React stack frames (reconciler functions like `renderWithHooks`, `beginWork`, `completeWork`, etc.) can be identified by their patterns — they bubble up from the actual throw site. Focus on the topmost non-React frame.
- If the error is `TypeError: Invalid URL`, look for unguarded `new URL()` calls in render paths.
- If the error is during React rendering, the topmost frame is the component whose render threw.
- The `source-map` package version 0.6.x uses `new SourceMapConsumer(rawMap)` which returns a Promise. Version 0.5.x is synchronous.
- Source paths in the map often have relative prefixes like `../../../` — strip these mentally or programmatically to get the repo-relative path.

## Cleanup

After reporting, restore the repo and clean up temp files:

```bash
git checkout -
npm install
rm -rf /tmp/dyad-asar-extracted /tmp/dyad-sourcemap-build
```
