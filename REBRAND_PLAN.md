# JoyCreate Rebranding Plan - Removing Dyad References

## OAuth & API Endpoints (Critical)

### Current Dyad Infrastructure
These URLs need to be updated to JoyCreate infrastructure:

1. **Update Service**: `https://api.dyad.sh/v1/update/`
2. **Supabase OAuth**: `https://supabase-oauth.dyad.sh/api/connect-supabase/`
3. **Neon OAuth**: `https://oauth.dyad.sh/api/integrations/neon/`
4. **Engine**: `https://engine.dyad.sh/v1`
5. **Templates**: `https://api.dyad.sh/v1/templates`
6. **Help Chat**: `https://helpchat.dyad.sh/v1`
7. **User Info**: `https://api.dyad.sh/v1/user/info`
8. **Documentation**: `https://dyad.sh/docs/` or `https://www.dyad.sh/docs/`

### Recommended JoyCreate URLs
Replace with:
- `https://api.joycreate.app/v1/`
- `https://oauth.joycreate.app/api/supabase/`
- `https://oauth.joycreate.app/api/neon/`
- `https://engine.joycreate.app/v1`
- `https://api.joycreate.app/v1/templates`
- `https://help.joycreate.app/v1`
- `https://api.joycreate.app/v1/user/info`
- `https://docs.joycreate.app/` or `https://joycreate.app/docs/`

## Settings & Schema Fields

### Current Dyad Fields
- `enableDyadPro` → Already returns `true`, but rename to `enableJoyPro`
- `dyadProBudget` → Deprecated, can be removed or renamed `joyBudget`
- `isDyadProEnabled()` → Rename to `isJoyProEnabled()` (though it always returns true)
- `hasDyadProKey()` → Rename to `hasJoyProKey()` (returns true always)

## Code Tags & Markers

### XML-style Tags
These are used in AI-generated code streaming:
- `<dyad-write>` → `<joy-write>`
- `<dyad-delete>` → `<joy-delete>`
- `<dyad-rename>` → `<joy-rename>`
- `<dyad-add-dependency>` → `<joy-add-dependency>`

### DOM Attributes  
These are used for component selection in visual editor:
- `data-dyad-id` → `data-joy-id`
- `data-dyad-name` → `data-joy-name`
- `data-dyad-runtime-id` → `data-joy-runtime-id`

### Client Scripts
- `dyad-shim.js` → `joy-shim.js`
- `dyad-component-selector-client.js` → `joy-component-selector-client.js`
- `dyad-screenshot-client.js` → `joy-screenshot-client.js`
- `dyad-visual-editor-client.js` → `joy-visual-editor-client.js`
- `dyad_logs.js` → `joy_logs.js`
- `dyad-sw.js` → `joy-sw.js`
- `dyad-sw-register.js` → `joy-sw-register.js`

### Event Types
- `dyad-component-styles` → `joy-component-styles`
- `dyad-component-coordinates-updated` → `joy-component-coordinates-updated`
- `dyad-text-updated` → `joy-text-updated`
- `dyad-text-finalized` → `joy-text-finalized`
- `dyad-component-selected` → `joy-component-selected`
- `dyad-component-deselected` → `joy-component-deselected`
- `dyad-screenshot-response` → `joy-screenshot-response`
- `dyad-pro-mode` → `joy-pro-mode`
- `activate-dyad-component-selector` → `activate-joy-component-selector`
- And many more...

## File Paths to Update

1. `/src/main.ts` - Update service URLs
2. `/src/lib/schemas.ts` - Rename Pro-related functions
3. `/src/supabase_admin/supabase_management_client.ts` - OAuth URLs
4. `/src/neon_admin/neon_management_client.ts` - OAuth URLs
5. `/src/ipc/utils/get_model_client.ts` - Engine URL
6. `/src/ipc/utils/template_utils.ts` - Templates URL
7. `/src/ipc/utils/dyad_tag_parser.ts` - Rename file and all tag parsers
8. `/src/ipc/handlers/*` - Various dyad references
9. `/src/components/*` - UI text and documentation links
10. `/worker/*` - All client scripts and proxy server logic

## Strategy

### Phase 1: Infrastructure (Keep Working)
- Create environment variables for API endpoints
- Support BOTH old dyad.sh URLs AND new joycreate.app URLs during transition
- Fallback to old URLs if new ones aren't available yet

### Phase 2: Code Rebranding  
- Rename all code tags, attributes, and event types
- Update worker scripts
- Update tag parsers
- Maintain backward compatibility with old tags for existing apps

### Phase 3: Settings Migration
- Rename settings fields
- Auto-migrate user data from old field names to new ones
- Keep old fields as aliases temporarily

### Phase 4: Final Cleanup
- Remove all dyad.sh URL references
- Remove backward compatibility code
- Update all documentation

## Priority Actions

1. ✅ **DONE**: All Pro features enabled for free
2. 🔄 **IN PROGRESS**: Document all Dyad references
3. ⏳ **NEXT**: Create environment config for API endpoints
4. ⏳ **NEXT**: Update tag parsers to support both dyad/joy tags
5. ⏳ **NEXT**: Update worker scripts with JoyCreate branding
6. ⏳ **NEXT**: Update all UI text and links
7. ⏳ **NEXT**: Setup joycreate.app infrastructure

## Notes

- Must maintain backward compatibility during transition
- Existing user apps may have old dyad tags - need to support both
- OAuth flows are critical - test thoroughly after changes
- Consider keeping dyad.sh as fallback until joycreate.app is fully deployed
