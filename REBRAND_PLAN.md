# JoyCreate Rebranding — Completed ✅

This document tracked the rebranding from Dyad to JoyCreate. **All phases are now complete.**

## Summary of Changes

### API & OAuth Endpoints (✅ Done)
All endpoints now point to `joycreate.app` infrastructure:
- Update Service: `https://api.joycreate.app/v1/update/`
- Supabase OAuth: `https://oauth.joycreate.app/api/supabase/`
- Neon OAuth: `https://oauth.joycreate.app/api/integrations/neon/`
- Engine: `https://engine.joycreate.app/v1`
- Templates: `https://api.joycreate.app/v1/templates`
- Help Chat: `https://help.joycreate.app/v1`
- User Info: `https://api.joycreate.app/v1/user/info`
- Documentation: `https://docs.joycreate.app/`

Central config: `src/config/api_config.ts`

### Code Tags (✅ Done)
New output uses `joy-` prefix (`<joy-write>`, `<joy-read>`, etc.).
Parser still accepts both `joy-` and `dyad-` prefixes for backward compatibility with existing user apps.
Config: `SUPPORTED_TAG_PREFIXES = ["joy", "dyad"]` in `api_config.ts`.

### DOM Attributes (✅ Done)
Component tagger now emits `data-joy-id` / `data-joy-name`.
Checks for both old (`data-dyad-*`) and new attributes to avoid double-tagging.

### GitHub (✅ Done)
All issue URLs, repo references → `DisciplesofLove/JoyCreate`.

### Environment Variables (✅ Done)
- `DYAD_ENGINE_URL` → `JOY_ENGINE_URL`
- `DYAD_GATEWAY_URL` → `JOY_GATEWAY_URL`

### npm Packages (Kept as-is)
These are published npm package names and cannot be renamed without republishing:
- `@dyad-sh/react-vite-component-tagger`
- `@dyad-sh/nextjs-webpack-component-tagger`
- `@dyad-sh/supabase-management-js`

## Backward Compatibility
- Tag parser accepts both `dyad-` and `joy-` prefixes
- Component tagger checks for both old and new data attributes
- Existing user apps with old tags continue to work
