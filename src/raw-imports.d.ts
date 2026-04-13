// Tells TypeScript that Vite's `?raw` imports of .md files resolve to a string.
// Without this, TS would error on `import content from './foo.md?raw'`.
declare module "*.md?raw" {
  const content: string;
  export default content;
}
