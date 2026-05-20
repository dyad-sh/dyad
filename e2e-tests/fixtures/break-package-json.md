I will break the dev script in package.json.

<dyad-write path="package.json" description="remove the dev script so npm run dev fails">
{
  "name": "vite_react_shadcn_ts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build"
  }
}
</dyad-write>
